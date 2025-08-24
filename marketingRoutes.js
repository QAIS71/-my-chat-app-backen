// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push');

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // ==== دالة لتجهيز قاعدة البيانات بالميزات الجديدة ====
    async function prepareMarketingDatabase(pool) {
        try {
            // تحديث جدول الإعلانات
            await pool.query(`
                ALTER TABLE marketing_ads
                ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS pin_expiry BIGINT,
                ADD COLUMN IF NOT EXISTS is_deal BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS deal_expiry BIGINT;
            `);
            console.log('تم التأكد من وجود أعمدة الإعلانات المثبتة والعروض.');

            // جدول نقاط المستخدمين
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_points (
                    user_id VARCHAR(255) PRIMARY KEY,
                    points INTEGER DEFAULT 0,
                    last_updated BIGINT
                );
            `);
            console.log('تم التأكد من وجود جدول user_points.');

            // --- الجداول الجديدة للنظام المالي ---
            // جدول محافظ البائعين
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wallets (
                    user_id VARCHAR(255) PRIMARY KEY,
                    pending_balance NUMERIC(10, 2) DEFAULT 0.00,
                    available_balance NUMERIC(10, 2) DEFAULT 0.00,
                    currency VARCHAR(10) DEFAULT 'USD'
                );
            `);
            console.log('تم التأكد من وجود جدول wallets.');

            // جدول لتتبع المعاملات المالية
            await pool.query(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id VARCHAR(255) PRIMARY KEY,
                    ad_id VARCHAR(255),
                    buyer_id VARCHAR(255),
                    seller_id VARCHAR(255),
                    amount NUMERIC(10, 2) NOT NULL,
                    currency VARCHAR(10) NOT NULL,
                    commission NUMERIC(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending', -- pending, completed, cancelled
                    payment_method VARCHAR(50),
                    created_at BIGINT,
                    updated_at BIGINT
                );
            `);
            console.log('تم التأكد من وجود جدول transactions.');

        } catch (error) {
            console.error("خطأ في تجهيز قاعدة بيانات التسويق:", error);
        }
    }

    // تجهيز قاعدة البيانات في كل المشاريع عند بدء التشغيل
    for (const projectId in projectDbPools) {
        prepareMarketingDatabase(projectDbPools[projectId]);
    }

    // --- وظيفة التنظيف الدورية ---
    // تعمل كل 5 دقائق لحذف العروض المنتهية وإلغاء تثبيت الإعلانات المنتهية
    setInterval(async () => {
        console.log("Running cleanup job for expired deals and pins...");
        const now = Date.now();
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                // حذف العروض المنتهية
                const deletedDeals = await pool.query('DELETE FROM marketing_ads WHERE ad_type = $1 AND deal_expiry < $2 RETURNING id', ['deal', now]);
                if (deletedDeals.rows.length > 0) {
                    console.log(`[Project ${projectId}] Deleted ${deletedDeals.rows.length} expired deals.`);
                }

                // إلغاء تثبيت الإعلانات المنتهية
                const unpinnedAds = await pool.query('UPDATE marketing_ads SET is_pinned = FALSE, pin_expiry = NULL WHERE is_pinned = TRUE AND pin_expiry < $1 RETURNING id', [now]);
                if (unpinnedAds.rows.length > 0) {
                    console.log(`[Project ${projectId}] Unpinned ${unpinnedAds.rows.length} expired ads.`);
                }
            } catch (error) {
                console.error(`[Project ${projectId}] Error during cleanup job:`, error);
            }
        }
    }, 5 * 60 * 1000); // 300000ms = 5 minutes


    async function getUserDetailsFromDefaultProject(userId) {
        // ... الكود الحالي ...
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role FROM users WHERE uid = $1',
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
        // ... الكود الحالي ...
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
                        seller_user_role: sellerDetails ? sellerDetails.user_role : 'normal'
                    };
                }));
                allAds = allAds.concat(enrichedAds);
            }
            allAds.sort((a, b) => {
                if (a.is_pinned && !b.is_pinned) return -1;
                if (!a.is_pinned && b.is_pinned) return 1;
                return b.timestamp - a.timestamp;
            });
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // --- نقطة نهاية جديدة للإعدادات ---
    router.get('/config', (req, res) => {
        // في تطبيق حقيقي، يجب جلب هذه البيانات من خدمة خارجية موثوقة
        const exchangeRates = {
            "USD": 1.0,
            "SAR": 3.75,
            "YER": 250.0,
            "EGP": 47.5,
            "AED": 3.67
        };
        res.json({ exchangeRates });
    });


    // POST /api/marketing - إنشاء إعلان جديد (مُعدّل)
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id, deal_duration_hours } = req.body;
        const imageFile = req.file;
        if (!title || !description || !ad_type || !seller_id || !price) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrl = null;
            if (imageFile) {
                // ... كود رفع الصورة يبقى كما هو ...
                const bucketName = 'marketing-images';
                const fileName = `${uuidv4()}.${imageFile.originalname.split('.').pop()}`;
                const filePath = `${seller_id}/${fileName}`;
                const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, imageFile.buffer, { contentType: imageFile.mimetype });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
                imageUrl = publicUrlData.publicUrl;
            }
            const adId = uuidv4();
            const timestamp = Date.now();
            const is_deal = ad_type === 'deal';
            
            // --- تعديل منطق انتهاء العرض ---
            let deal_expiry = null;
            if (is_deal) {
                const duration = parseInt(deal_duration_hours, 10) || 1; // ساعة واحدة كافتراضي
                deal_expiry = timestamp + (duration * 60 * 60 * 1000);
            }

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, is_deal, deal_expiry, seller_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [adId, title, description, price, imageUrl, ad_type, timestamp, is_deal, deal_expiry, seller_id]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // DELETE /api/marketing/:adId - لحذف إعلان
    router.delete('/:adId', async (req, res) => {
        // ... الكود الحالي ...
        const { adId } = req.params;
        const { callerUid } = req.body;
        if (!callerUid) { return res.status(401).json({ error: "Unauthorized" }); }
        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            const isAdmin = callerDetails && callerDetails.user_role === 'admin';
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    const ad = adResult.rows[0];
                    if (ad.seller_id !== callerUid && !isAdmin) {
                        return res.status(403).json({ error: "Unauthorized to delete." });
                    }
                    if (ad.image_url) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'marketing-images';
                        const url = new URL(ad.image_url);
                        const filePathInBucket = url.pathname.split(`/${bucketName}/`)[1];
                        await supabase.storage.from(bucketName).remove([filePathInBucket]);
                    }
                    await pool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
                    return res.status(200).json({ message: 'Ad deleted.' });
                }
            }
            return res.status(404).json({ error: 'Ad not found.' });
        } catch (error) {
            console.error("Error deleting ad:", error);
            res.status(500).json({ error: "Failed to delete ad." });
        }
    });

    // POST /api/marketing/pin/:adId - لتثبيت إعلان (مُعدّل)
    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid, pin_duration_hours } = req.body;
        
        // محاكاة عملية الدفع
        const duration = parseInt(pin_duration_hours) || 1;
        const cost = duration * 10; // 10$ per hour
        console.log(`Pinning ad ${adId} for ${duration} hours at a cost of $${cost}. (Payment simulation)`);

        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) {
                        return res.status(403).json({ error: "Unauthorized." });
                    }
                    // --- تعديل مدة التثبيت ---
                    const expiry = Date.now() + (duration * 60 * 60 * 1000);
                    await pool.query('UPDATE marketing_ads SET is_pinned = TRUE, pin_expiry = $1 WHERE id = $2', [expiry, adId]);
                    return res.status(200).json({ message: `Ad pinned successfully for ${duration} hour(s).` });
                }
            }
            return res.status(404).json({ error: "Ad not found." });
        } catch(error) {
            console.error("Error pinning ad:", error);
            res.status(500).json({ error: "Failed to pin ad." });
        }
    });

    // --- نقاط النهاية الجديدة للنظام المالي ---

    // GET /api/marketing/seller/wallet/:userId - جلب بيانات محفظة البائع
    router.get('/seller/wallet/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
            if (wallet.rows.length === 0) {
                // إنشاء محفظة جديدة إذا لم تكن موجودة
                await pool.query('INSERT INTO wallets (user_id) VALUES ($1)', [userId]);
                wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
            }
            res.status(200).json(wallet.rows[0]);
        } catch (error) {
            console.error("Error fetching wallet:", error);
            res.status(500).json({ error: "Failed to fetch wallet." });
        }
    });

    // POST /api/marketing/purchase - نقطة نهاية الشراء الجديدة (نظام Escrow)
    router.post('/purchase', async (req, res) => {
        const { adId, buyerId, amount, paymentMethod } = req.body;
        if (!adId || !buyerId || !amount || !paymentMethod) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        try {
            let adInfo = null;
            let adPool = null;

            // البحث عن الإعلان في جميع المشاريع
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) {
                    adInfo = result.rows[0];
                    adPool = pool;
                    break;
                }
            }

            if (!adInfo) return res.status(404).json({ error: "Ad not found." });
            
            const sellerId = adInfo.seller_id;
            const isDigital = adInfo.ad_type === 'digital_product';
            const commission = parseFloat(amount) * 0.02; // عمولة 2%
            const transactionId = uuidv4();
            const now = Date.now();
            
            // إضافة المعاملة إلى قاعدة البيانات
            await adPool.query(
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10)`,
                [transactionId, adId, buyerId, sellerId, amount, commission, isDigital ? 'completed' : 'pending', paymentMethod, now, now]
            );

            // تحديث محفظة البائع
            const sellerWalletPool = (await getUserProjectContext(sellerId)).pool;
            if (isDigital) {
                // للمنتجات الرقمية: إضافة المبلغ للرصيد المتاح مباشرة بعد خصم العمولة
                const netAmount = parseFloat(amount) - commission;
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`,
                    [sellerId, netAmount]
                );
            } else {
                // للمنتجات المادية: إضافة المبلغ للرصيد المعلق
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, pending_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET pending_balance = wallets.pending_balance + $2`,
                    [sellerId, amount]
                );
            }
            
            res.status(201).json({ 
                message: isDigital ? "تم الشراء بنجاح! يمكنك الآن تحميل المنتج." : "تم الدفع بنجاح! المبلغ محجوز لدى المنصة حتى تأكيد الاستلام.",
                transactionId: transactionId 
            });

        } catch (error) {
            console.error("Error during purchase:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });

    // POST /api/marketing/order/:transactionId/confirm - تأكيد استلام الطلب
    router.post('/order/:transactionId/confirm', async (req, res) => {
        const { transactionId } = req.params;
        const { buyerId } = req.body; // للتأكد من أن المشتري هو من يؤكد

        try {
            let transaction = null;
            let transactionPool = null;

            // البحث عن المعاملة في جميع المشاريع
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) {
                    transaction = result.rows[0];
                    transactionPool = pool;
                    break;
                }
            }

            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== buyerId) return res.status(403).json({ error: "Unauthorized." });
            if (transaction.status !== 'pending') return res.status(400).json({ error: "Order already confirmed or cancelled." });

            // تحديث حالة المعاملة
            await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);

            // تحويل المبلغ من الرصيد المعلق إلى المتاح للبائع
            const sellerId = transaction.seller_id;
            const sellerWalletPool = (await getUserProjectContext(sellerId)).pool;
            const amount = parseFloat(transaction.amount);
            const commission = parseFloat(transaction.commission);
            const netAmount = amount - commission;

            await sellerWalletPool.query(
                `UPDATE wallets SET 
                 pending_balance = pending_balance - $1,
                 available_balance = available_balance + $2
                 WHERE user_id = $3`,
                [amount, netAmount, sellerId]
            );

            res.status(200).json({ message: "تم تأكيد الاستلام بنجاح! تم تحويل المبلغ للبائع." });

        } catch (error) {
            console.error("Error confirming order:", error);
            res.status(500).json({ error: "Failed to confirm order." });
        }
    });


    // --- نقاط نهاية الألعاب تبقى كما هي ---
    router.get('/points/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            const result = await pool.query('SELECT points FROM user_points WHERE user_id = $1', [userId]);
            res.status(200).json({ points: result.rows.length > 0 ? result.rows[0].points : 0 });
        } catch (error) {
            console.error("Error fetching points:", error);
            res.status(500).json({ error: "Failed to fetch points." });
        }
    });

    router.post('/points', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });
        const { pool } = await getUserProjectContext(userId);
        try {
            await pool.query(`INSERT INTO user_points (user_id, points, last_updated) VALUES ($1, 1, $2) ON CONFLICT (user_id) DO UPDATE SET points = user_points.points + 1, last_updated = $2`, [userId, Date.now()]);
            res.status(200).json({ message: "Point added." });
        } catch (error) {
            console.error("Error adding point:", error);
            res.status(500).json({ error: "Failed to add point." });
        }
    });

    async function getUserProjectContext(userId) {
        // ... الكود الحالي ...
        let projectId = BACKEND_DEFAULT_PROJECT_ID;
        if (userId) {
            try {
                const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
                const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
                if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                    projectId = userResult.rows[0].user_project_id;
                }
            } catch (error) {
                console.error(`Error fetching project ID for user ${userId}:`, error);
            }
        }
        return { pool: projectDbPools[projectId], supabase: projectSupabaseClients[projectId] };
    }

    return router;
};
