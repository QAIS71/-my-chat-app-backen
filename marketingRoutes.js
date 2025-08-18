// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push'); // مهم جداً لوظيفة الإشعارات

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // دالة مساعدة لجلب تفاصيل المستخدم من المشروع الافتراضي
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

    // GET /api/marketing - لجلب كل الإعلانات مع معلومات التوثيق
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads ORDER BY timestamp DESC');
                
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
            allAds.sort((a, b) => b.timestamp - a.timestamp);
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - لإنشاء إعلان جديد
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id } = req.body;
        const imageFile = req.file;

        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "Title, description, type, and seller ID are required." });
        }

        let imageUrl = null;
        let userProjectId = BACKEND_DEFAULT_PROJECT_ID;

        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [seller_id]);
            if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                userProjectId = userResult.rows[0].user_project_id;
            }

            const pool = projectDbPools[userProjectId];
            const supabase = projectSupabaseClients[userProjectId];

            if (!pool || !supabase) {
                throw new Error(`Project context for ${userProjectId} not found.`);
            }

            if (imageFile) {
                const bucketName = 'marketing-images';
                const fileExtension = imageFile.originalname.split('.').pop();
                const fileName = `${uuidv4()}.${fileExtension}`;
                const filePath = `${seller_id}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from(bucketName)
                    .upload(filePath, imageFile.buffer, { contentType: imageFile.mimetype });

                if (uploadError) throw uploadError;
                
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
                imageUrl = publicUrlData.publicUrl;
            }

            const adId = uuidv4();
            const timestamp = Date.now();

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, seller_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [adId, title, description, price, imageUrl, ad_type, timestamp, seller_id]
            );

            res.status(201).json({ message: "Ad published successfully.", adId: adId });

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
                        return res.status(403).json({ error: "You are not authorized to delete this ad." });
                    }
                    if (ad.image_url) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'marketing-images';
                        const url = new URL(ad.image_url);
                        const filePathInBucket = url.pathname.split(`/${bucketName}/`)[1];
                        await supabase.storage.from(bucketName).remove([filePathInBucket]);
                    }
                    await pool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
                    return res.status(200).json({ message: 'Ad deleted successfully.' });
                }
            }
            return res.status(404).json({ error: 'Ad not found.' });
        } catch (error) {
            console.error("Error deleting ad:", error);
            res.status(500).json({ error: "Failed to delete ad." });
        }
    });

    // POST /api/marketing/purchase - نقطة نهاية الشراء مع إرسال الإشعار
    router.post('/purchase', async (req, res) => {
        const { sellerId, buyerId, messageText } = req.body;

        if (!sellerId || !buyerId || !messageText) {
            return res.status(400).json({ error: "Missing required fields for purchase." });
        }

        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

            const sellerData = await getUserDetailsFromDefaultProject(sellerId);
            const buyerData = await getUserDetailsFromDefaultProject(buyerId);
            if (!sellerData || !buyerData) {
                return res.status(404).json({ error: "Seller or buyer not found." });
            }

            let chatId;
            const existingChatResult = await defaultPool.query(
                `SELECT id FROM chats WHERE type = 'private' AND (participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[]))`,
                [buyerId, sellerId]
            );

            if (existingChatResult.rows.length > 0) {
                chatId = existingChatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                const timestamp = Date.now();
                const participantsArray = [buyerId, sellerId];
                const contactNamesObject = { [buyerId]: sellerData.username, [sellerId]: buyerData.username };
                await defaultPool.query(
                    `INSERT INTO chats (id, type, participants, last_message, timestamp, contact_names, profile_bg_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', JSON.stringify(participantsArray), null, timestamp, JSON.stringify(contactNamesObject), sellerData.profile_bg_url]
                );
            }

            const { pool: buyerPool } = await getUserProjectContext(buyerId);
            const messageId = uuidv4();
            const messageTimestamp = Date.now();
            await buyerPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [messageId, chatId, buyerId, buyerData.username, messageText, messageTimestamp, 'text', buyerData.profile_bg_url]
            );

            await defaultPool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, messageTimestamp, chatId]);

            // ==== بداية كود إرسال الإشعار للبائع ====
            const subResult = await defaultPool.query('SELECT subscription_info FROM push_subscriptions WHERE user_id = $1', [sellerId]);
            if (subResult.rows.length > 0) {
                const subscription = subResult.rows[0].subscription_info;
                const payload = JSON.stringify({
                    title: `طلب شراء جديد من ${buyerData.username}`,
                    body: messageText,
                    url: `/?chatId=${chatId}`,
                    icon: buyerData.profile_bg_url // صورة المشتري
                });
                webPush.sendNotification(subscription, payload).catch(error => {
                    console.error(`فشل إرسال إشعار شراء إلى ${sellerId}:`, error.body || error.message);
                });
            }
            // ==== نهاية كود إرسال الإشعار ====

            res.status(200).json({ message: "Purchase request sent successfully!", chatId: chatId });

        } catch (error) {
            console.error("Error processing purchase request:", error);
            res.status(500).json({ error: "Failed to send purchase request." });
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
        return { pool: projectDbPools[projectId] };
    }

    return router;
};
