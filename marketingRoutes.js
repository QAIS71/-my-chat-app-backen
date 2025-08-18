// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push');

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // ==== دالة لتجهيز قاعدة البيانات لكل الميزات الجديدة ====
    async function prepareMarketingDatabase(pool) {
        try {
            // إضافة أعمدة جديدة لجدول الإعلانات إذا لم تكن موجودة
            await pool.query(`
                ALTER TABLE marketing_ads
                ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS pin_expiry BIGINT,
                ADD COLUMN IF NOT EXISTS is_deal BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS deal_expiry BIGINT;
            `);
            console.log('تم التأكد من وجود أعمدة الإعلانات المثبتة والعروض في جدول marketing_ads.');

            // إنشاء جدول جديد لنقاط المستخدمين في الألعاب
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_points (
                    user_id VARCHAR(255) PRIMARY KEY,
                    points INTEGER DEFAULT 0,
                    last_updated BIGINT
                );
            `);
            console.log('تم التأكد من وجود جدول user_points.');

        } catch (error) {
            console.error("خطأ في تجهيز قاعدة بيانات التسويق:", error);
        }
    }

    // تجهيز قاعدة البيانات في كل المشاريع عند بدء التشغيل
    for (const projectId in projectDbPools) {
        prepareMarketingDatabase(projectDbPools[projectId]);
    }
    // ==== نهاية دالة تجهيز قاعدة البيانات ====

    async function getUserDetailsFromDefaultProject(userId) {
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

    // GET /api/marketing - جلب كل الإعلانات مع ترتيب المثبت أولاً
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

    // POST /api/marketing - إنشاء إعلان جديد
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id } = req.body;
        const imageFile = req.file;
        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrl = null;
            if (imageFile) {
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
            const deal_expiry = is_deal ? timestamp + (24 * 60 * 60 * 1000) : null;
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

    // POST /api/marketing/purchase - نقطة نهاية الشراء
    router.post('/purchase', async (req, res) => {
        const { sellerId, buyerId, messageText } = req.body;
        if (!sellerId || !buyerId || !messageText) {
            return res.status(400).json({ error: "Missing fields." });
        }
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const sellerData = await getUserDetailsFromDefaultProject(sellerId);
            const buyerData = await getUserDetailsFromDefaultProject(buyerId);
            if (!sellerData || !buyerData) {
                return res.status(404).json({ error: "User not found." });
            }
            let chatId;
            const existingChatResult = await defaultPool.query(`SELECT id FROM chats WHERE type = 'private' AND (participants @> '["${buyerId}"]'::jsonb AND participants @> '["${sellerId}"]'::jsonb)`);
            if (existingChatResult.rows.length > 0) {
                chatId = existingChatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                const timestamp = Date.now();
                await defaultPool.query(`INSERT INTO chats (id, type, participants, contact_names, profile_bg_url, timestamp) VALUES ($1, 'private', $2, $3, $4, $5)`, [chatId, JSON.stringify([buyerId, sellerId]), JSON.stringify({ [buyerId]: sellerData.username, [sellerId]: buyerData.username }), sellerData.profile_bg_url, timestamp]);
            }
            const { pool: buyerPool } = await getUserProjectContext(buyerId);
            await buyerPool.query(`INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, 'text', $7)`, [uuidv4(), chatId, buyerId, buyerData.username, messageText, Date.now(), buyerData.profile_bg_url]);
            await defaultPool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, Date.now(), chatId]);
            const subResult = await defaultPool.query('SELECT subscription_info FROM push_subscriptions WHERE user_id = $1', [sellerId]);
            if (subResult.rows.length > 0) {
                const payload = JSON.stringify({ title: `طلب شراء جديد من ${buyerData.username}`, body: messageText, url: `/?chatId=${chatId}`, icon: buyerData.profile_bg_url });
                webPush.sendNotification(subResult.rows[0].subscription_info, payload).catch(err => console.error(`Failed to send notification to ${sellerId}:`, err.body));
            }
            res.status(200).json({ message: "Request sent!", chatId: chatId });
        } catch (error) {
            console.error("Error in purchase request:", error);
            res.status(500).json({ error: "Failed to send request." });
        }
    });

    // GET /api/marketing/points/:userId - جلب نقاط المستخدم
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

    // POST /api/marketing/points - إضافة نقطة
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
    
    // POST /api/marketing/pin/:adId - لتثبيت إعلان
    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid } = req.body;
        // هنا يمكنك إضافة منطق التحقق من الدفع لاحقاً
        // حالياً سنقوم بالتثبيت مباشرة
        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) {
                        return res.status(403).json({ error: "Unauthorized." });
                    }
                    const expiry = Date.now() + (60 * 60 * 1000); // ساعة واحدة
                    await pool.query('UPDATE marketing_ads SET is_pinned = TRUE, pin_expiry = $1 WHERE id = $2', [expiry, adId]);
                    return res.status(200).json({ message: "Ad pinned successfully for 1 hour." });
                }
            }
            return res.status(404).json({ error: "Ad not found." });
        } catch(error) {
            console.error("Error pinning ad:", error);
            res.status(500).json({ error: "Failed to pin ad." });
        }
    });

    async function getUserProjectContext(userId) {
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
