// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push');

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    async function prepareMarketingDatabase(pool) {
        try {
            await pool.query(`
                ALTER TABLE marketing_ads
                ADD COLUMN IF NOT EXISTS price_numeric DECIMAL(10, 2),
                ADD COLUMN IF NOT EXISTS price_currency VARCHAR(10),
                ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS pin_expiry BIGINT,
                ADD COLUMN IF NOT EXISTS is_deal BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS deal_expiry BIGINT,
                ADD COLUMN IF NOT EXISTS digital_file_url VARCHAR(255); -- *** العمود الجديد للملف الرقمي ***
            `);
            console.log('تم التأكد من وجود أعمدة الإعلانات المثبتة والعروض والأسعار والملفات الرقمية.');

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

    for (const projectId in projectDbPools) {
        prepareMarketingDatabase(projectDbPools[projectId]);
    }

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
        if (!projectDbPools[projectId] || !projectSupabaseClients[projectId]) {
            console.warn(`Project context for ${projectId} not found, falling back to default.`);
            projectId = BACKEND_DEFAULT_PROJECT_ID;
        }
        return { pool: projectDbPools[projectId], supabase: projectSupabaseClients[projectId] };
    }

    router.get('/', async (req, res) => {
        let allAds = [];
        const now = Date.now();
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query(
                    `SELECT * FROM marketing_ads 
                     WHERE (pin_expiry IS NULL OR pin_expiry > $1) 
                     AND (deal_expiry IS NULL OR deal_expiry > $1)
                     ORDER BY is_pinned DESC, timestamp DESC`, [now]
                );
                
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

    // *** تعديل نقطة النهاية لتقبل ملفين ***
    const adUploads = upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'digital_file', maxCount: 1 }
    ]);
    router.post('/', adUploads, async (req, res) => {
        const { title, description, price_numeric, price_currency, ad_type, seller_id, deal_duration_hours } = req.body;
        
        // الوصول للملفات من req.files
        const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
        const digitalFile = req.files && req.files['digital_file'] ? req.files['digital_file'][0] : null;

        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrl = null;
            let digitalFileUrl = null;

            // رفع صورة العرض
            if (imageFile) {
                const bucketName = 'marketing-images';
                const fileName = `${uuidv4()}-${imageFile.originalname}`;
                const filePath = `${seller_id}/${fileName}`;
                const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, imageFile.buffer, { contentType: imageFile.mimetype });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
                imageUrl = publicUrlData.publicUrl;
            }

            // رفع الملف الرقمي إذا كان النوع منتج رقمي
            if (ad_type === 'digital_product' && digitalFile) {
                const bucketName = 'digital-products'; // استخدام bucket مختلف للملفات الرقمية
                const fileName = `${uuidv4()}-${digitalFile.originalname}`;
                const filePath = `${seller_id}/${fileName}`;
                const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, digitalFile.buffer, { contentType: digitalFile.mimetype });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
                digitalFileUrl = publicUrlData.publicUrl;
            }

            const adId = uuidv4();
            const timestamp = Date.now();
            const is_deal = ad_type === 'deal';
            
            let deal_expiry = null;
            if (is_deal && deal_duration_hours) {
                deal_expiry = timestamp + (parseInt(deal_duration_hours) * 60 * 60 * 1000);
            }

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price_numeric, price_currency, image_url, digital_file_url, ad_type, timestamp, is_deal, deal_expiry, seller_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [adId, title, description, price_numeric || null, price_currency || 'USD', imageUrl, digitalFileUrl, ad_type, timestamp, is_deal, deal_expiry, seller_id]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

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
                    const supabase = projectSupabaseClients[projectId];
                    // حذف صورة العرض
                    if (ad.image_url) {
                        const bucketName = 'marketing-images';
                        const url = new URL(ad.image_url);
                        const filePathInBucket = url.pathname.split(`/${bucketName}/`)[1];
                        if (filePathInBucket) await supabase.storage.from(bucketName).remove([filePathInBucket]);
                    }
                    // حذف الملف الرقمي
                    if (ad.digital_file_url) {
                        const bucketName = 'digital-products';
                        const url = new URL(ad.digital_file_url);
                        const filePathInBucket = url.pathname.split(`/${bucketName}/`)[1];
                        if (filePathInBucket) await supabase.storage.from(bucketName).remove([filePathInBucket]);
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

    router.post('/purchase', async (req, res) => {
        const { sellerId, buyerId, messageText, pointsToRedeem } = req.body;
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
            const messageId = uuidv4();
            const messageTimestamp = Date.now();
            await buyerPool.query(`INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, 'text', $7)`, [messageId, chatId, buyerId, buyerData.username, messageText, messageTimestamp, buyerData.profile_bg_url]);
            await defaultPool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, messageTimestamp, chatId]);
            
            if (pointsToRedeem > 0) {
                await buyerPool.query(
                    `UPDATE user_points SET points = points - $1 WHERE user_id = $2 AND points >= $1`,
                    [pointsToRedeem, buyerId]
                );
            }
            
            // ... (منطق الإشعارات) ...
            res.status(200).json({ message: "Request sent!", chatId: chatId });
        } catch (error) {
            console.error("Error in purchase request:", error);
            res.status(500).json({ error: "Failed to send request." });
        }
    });

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
    
    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid, pin_duration_hours } = req.body;
        const duration = parseInt(pin_duration_hours) || 1;
        
        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) {
                        return res.status(403).json({ error: "Unauthorized." });
                    }
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

    return router;
};
