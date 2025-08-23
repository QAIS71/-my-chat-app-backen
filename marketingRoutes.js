// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push');

// نسبة العمولة
const COMMISSION_RATE = 0.02; // 2%

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // ==== دالة لتجهيز قاعدة البيانات بالميزات الجديدة ====
    async function prepareMarketingDatabase(pool) {
        try {
            // تحديث جدول الإعلانات
            await pool.query(`
                ALTER TABLE marketing_ads
                ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS expiry_timestamp BIGINT;
            `);
            // إزالة الأعمدة القديمة إذا كانت موجودة
            await pool.query(`
                ALTER TABLE marketing_ads
                DROP COLUMN IF EXISTS pin_expiry,
                DROP COLUMN IF EXISTS is_deal,
                DROP COLUMN IF EXISTS deal_expiry;
            `);
            console.log('تم تحديث جدول marketing_ads.');

            // إنشاء جدول محافظ البائعين
            await pool.query(`
                CREATE TABLE IF NOT EXISTS seller_wallets (
                    seller_id VARCHAR(255) PRIMARY KEY,
                    available_balance NUMERIC(10, 2) DEFAULT 0.00,
                    pending_balance NUMERIC(10, 2) DEFAULT 0.00,
                    last_updated BIGINT
                );
            `);
            console.log('تم التأكد من وجود جدول seller_wallets.');

            // إنشاء جدول الطلبات
            await pool.query(`
                CREATE TABLE IF NOT EXISTS product_orders (
                    order_id VARCHAR(255) PRIMARY KEY,
                    ad_id VARCHAR(255) NOT NULL,
                    ad_title VARCHAR(255),
                    buyer_id VARCHAR(255) NOT NULL,
                    seller_id VARCHAR(255) NOT NULL,
                    price NUMERIC(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending_delivery', -- pending_delivery, completed, cancelled
                    order_timestamp BIGINT
                );
            `);
            console.log('تم التأكد من وجود جدول product_orders.');

        } catch (error) {
            console.error("خطأ في تجهيز قاعدة بيانات التسويق:", error);
        }
    }
    
    // --- مهمة دورية لحذف الإعلانات منتهية الصلاحية ---
    setInterval(async () => {
        const now = Date.now();
        console.log('Running scheduled job to delete expired ads...');
        for (const projectId in projectDbPools) {
            try {
                const pool = projectDbPools[projectId];
                const result = await pool.query('DELETE FROM marketing_ads WHERE expiry_timestamp IS NOT NULL AND expiry_timestamp < $1', [now]);
                if (result.rowCount > 0) {
                    console.log(`Deleted ${result.rowCount} expired ads from project ${projectId}.`);
                }
            } catch (error) {
                console.error(`Error deleting expired ads from project ${projectId}:`, error);
            }
        }
    }, 60 * 1000); // تعمل كل دقيقة

    // تجهيز قاعدة البيانات في كل المشاريع عند بدء التشغيل
    for (const projectId in projectDbPools) {
        prepareMarketingDatabase(projectDbPools[projectId]);
    }

    // دالة مساعدة لجلب بيانات المستخدم من المشروع الافتراضي
    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT uid, username, is_verified, user_role FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details for ${userId}:`, error);
            return null;
        }
    }

    // GET /api/marketing - جلب كل الإعلانات
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads ORDER BY is_pinned DESC, timestamp DESC');
                
                const enrichedAds = await Promise.all(result.rows.map(async (ad) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
                    return {
                        ...ad,
                        seller_username: sellerDetails ? sellerDetails.username : 'غير معروف',
                        seller_is_verified: sellerDetails ? sellerDetails.is_verified : false,
                    };
                }));
                allAds = allAds.concat(enrichedAds);
            }
            allAds.sort((a, b) => (b.is_pinned ? 1 : -1) || (b.timestamp - a.timestamp));
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - إنشاء إعلان جديد
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id, duration_hours } = req.body;
        if (!title || !description || !ad_type || !seller_id || !price) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrl = null;
            if (req.file) {
                const bucketName = 'marketing-images';
                const fileName = `${uuidv4()}`;
                const { error } = await supabase.storage.from(bucketName).upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
                if (error) throw error;
                imageUrl = supabase.storage.from(bucketName).getPublicUrl(fileName).data.publicUrl;
            }
            
            const adId = uuidv4();
            const timestamp = Date.now();
            const durationMs = (parseInt(duration_hours, 10) || 24) * 60 * 60 * 1000;
            const expiry_timestamp = timestamp + durationMs;

            // السعر يجب أن يكون بالدولار
            const priceInUSD = price.replace(/[^0-9.]/g, '') + ' USD';

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, seller_id, expiry_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [adId, title, description, priceInUSD, imageUrl, ad_type, timestamp, seller_id, expiry_timestamp]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // POST /api/marketing/pin/:adId - لتثبيت إعلان
    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid, duration_hours } = req.body;
        const duration = parseInt(duration_hours, 10);

        if (!callerUid || !duration || duration < 1) {
            return res.status(400).json({ error: "Invalid request." });
        }
        
        // هنا يمكنك إضافة منطق التحقق من الدفع الفعلي
        console.log(`User ${callerUid} is paying ${duration * 10}$ to pin ad ${adId} for ${duration} hours.`);

        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) {
                        return res.status(403).json({ error: "Unauthorized." });
                    }
                    const expiry = Date.now() + (duration * 60 * 60 * 1000);
                    await pool.query('UPDATE marketing_ads SET is_pinned = TRUE, expiry_timestamp = $1 WHERE id = $2', [expiry, adId]);
                    return res.status(200).json({ message: `Ad pinned successfully for ${duration} hour(s).` });
                }
            }
            return res.status(404).json({ error: "Ad not found." });
        } catch(error) {
            console.error("Error pinning ad:", error);
            res.status(500).json({ error: "Failed to pin ad." });
        }
    });

    // GET /api/marketing/exchange-rates - نقطة نهاية لأسعار الصرف
    router.get('/exchange-rates', (req, res) => {
        // في تطبيق حقيقي، يجب جلب هذه البيانات من API موثوق
        res.json({
            "USD": 1.0,
            "SAR": 3.75,
            "YER": 250.0,
            "EGP": 47.5
        });
    });

    // POST /api/marketing/purchase - نقطة نهاية الشراء بنظام الحجز
    router.post('/purchase', async (req, res) => {
        const { adId, buyerId, adType } = req.body;
        if (!adId || !buyerId || !adType) {
            return res.status(400).json({ error: "Missing fields." });
        }

        try {
            const { pool } = await getUserProjectContext(buyerId);
            
            // جلب تفاصيل الإعلان
            const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
            if (adResult.rows.length === 0) return res.status(404).json({ error: "Ad not found." });
            const ad = adResult.rows[0];
            const sellerId = ad.seller_id;
            const price = parseFloat(ad.price.replace(/[^0-9.]/g, ''));

            // إنشاء الطلب
            const orderId = uuidv4();
            await pool.query(
                `INSERT INTO product_orders (order_id, ad_id, ad_title, buyer_id, seller_id, price, status, order_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [orderId, adId, ad.title, buyerId, sellerId, price, adType === 'digital_product' ? 'completed' : 'pending_delivery', Date.now()]
            );

            // التأكد من وجود محفظة للبائع
            await pool.query(
                `INSERT INTO seller_wallets (seller_id) VALUES ($1) ON CONFLICT (seller_id) DO NOTHING`,
                [sellerId]
            );

            // منطق تحويل الأموال
            if (adType === 'digital_product') {
                // منتج رقمي: تحويل فوري للرصيد المتاح
                const amountToCredit = price * (1 - COMMISSION_RATE);
                await pool.query(
                    `UPDATE seller_wallets SET available_balance = available_balance + $1 WHERE seller_id = $2`,
                    [amountToCredit, sellerId]
                );
                res.status(200).json({ message: "تم الشراء بنجاح! يمكنك الوصول للمنتج الآن." });
            } else {
                // منتج مادي: إضافة للرصيد المعلق
                await pool.query(
                    `UPDATE seller_wallets SET pending_balance = pending_balance + $1 WHERE seller_id = $2`,
                    [price, sellerId]
                );
                res.status(200).json({ message: "تم الشراء بنجاح! المبلغ معلق حتى تأكيد الاستلام." });
            }

        } catch (error) {
            console.error("Error in purchase request:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });

    // POST /api/marketing/confirm-delivery - تأكيد استلام الطلب
    router.post('/confirm-delivery', async (req, res) => {
        const { orderId, buyerId } = req.body;
        if (!orderId || !buyerId) return res.status(400).json({ error: "Missing fields." });

        try {
            const { pool } = await getUserProjectContext(buyerId);
            const orderResult = await pool.query('SELECT * FROM product_orders WHERE order_id = $1', [orderId]);
            if (orderResult.rows.length === 0) return res.status(404).json({ error: "Order not found." });
            
            const order = orderResult.rows[0];
            if (order.buyer_id !== buyerId) return res.status(403).json({ error: "Unauthorized." });
            if (order.status !== 'pending_delivery') return res.status(400).json({ error: "Order already processed." });

            const price = parseFloat(order.price);
            const amountToCredit = price * (1 - COMMISSION_RATE);

            // استخدام transaction لضمان سلامة البيانات
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                // 1. نقل المبلغ من المعلق إلى المتاح للبائع
                await client.query(
                    `UPDATE seller_wallets SET pending_balance = pending_balance - $1, available_balance = available_balance + $2 WHERE seller_id = $3`,
                    [price, amountToCredit, order.seller_id]
                );
                // 2. تحديث حالة الطلب إلى مكتمل
                await client.query(
                    `UPDATE product_orders SET status = 'completed' WHERE order_id = $1`,
                    [orderId]
                );
                await client.query('COMMIT');
                res.status(200).json({ message: "تم تأكيد الاستلام بنجاح!" });
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error("Error confirming delivery:", error);
            res.status(500).json({ error: "Failed to confirm delivery." });
        }
    });

    // GET /api/marketing/account-details/:userId - جلب بيانات حساب المستخدم
    router.get('/account-details/:userId', async (req, res) => {
        const { userId } = req.params;
        try {
            const { pool } = await getUserProjectContext(userId);
            
            // جلب المحفظة
            let walletResult = await pool.query('SELECT * FROM seller_wallets WHERE seller_id = $1', [userId]);
            let wallet = walletResult.rows[0] || { available_balance: 0, pending_balance: 0 };
            wallet.available_balance = parseFloat(wallet.available_balance);
            wallet.pending_balance = parseFloat(wallet.pending_balance);

            // جلب المبيعات
            const salesResult = await pool.query('SELECT * FROM product_orders WHERE seller_id = $1 ORDER BY order_timestamp DESC', [userId]);
            const sales = await Promise.all(salesResult.rows.map(async (order) => {
                const buyerDetails = await getUserDetailsFromDefaultProject(order.buyer_id);
                return { ...order, buyer_username: buyerDetails ? buyerDetails.username : 'مجهول' };
            }));

            // جلب المشتريات
            const purchasesResult = await pool.query('SELECT * FROM product_orders WHERE buyer_id = $1 ORDER BY order_timestamp DESC', [userId]);
            const purchases = await Promise.all(purchasesResult.rows.map(async (order) => {
                const sellerDetails = await getUserDetailsFromDefaultProject(order.seller_id);
                return { ...order, seller_username: sellerDetails ? sellerDetails.username : 'مجهول' };
            }));

            res.status(200).json({ wallet, sales, purchases });
        } catch (error) {
            console.error("Error fetching account details:", error);
            res.status(500).json({ error: "Failed to fetch account details." });
        }
    });

    // باقي الدوال تبقى كما هي
    async function getUserProjectContext(userId) {
        // ... no changes needed
    }
    router.delete('/:adId', async (req, res) => {
        // ... no changes needed
    });

    return router;
};
