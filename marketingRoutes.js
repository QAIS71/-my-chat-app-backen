// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const webPush = require('web-push');

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role, points FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details for ${userId}:`, error);
            return null;
        }
    }

    // GET /api/marketing - لجلب كل الإعلانات مع فرز المثبتة أولاً
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                // تم تعديل الاستعلام لفرز الإعلانات المثبتة في الأعلى
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
            // الفرز النهائي بعد تجميع البيانات من كل المشاريع
            allAds.sort((a, b) => (b.is_pinned - a.is_pinned) || (b.timestamp - a.timestamp));
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - لإنشاء إعلان جديد (مع دعم المثبت والعروض)
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id, is_pinned } = req.body;
        const imageFile = req.file;

        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "Title, description, type, and seller ID are required." });
        }
        
        // تحويل is_pinned من نص إلى boolean
        const isPinnedBool = is_pinned === 'true';
        const isDeal = ad_type === 'deal';
        let dealExpiresAt = null;

        // إذا كان الإعلان "عرض اليوم"، يتم تحديد وقت انتهاء الصلاحية بعد 24 ساعة
        if (isDeal) {
            const now = new Date();
            dealExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }

        // ملاحظة: هنا يجب إضافة منطق الدفع لتثبيت الإعلان (مثلاً التحقق من Stripe)
        // إذا كان isPinnedBool صحيحاً، قم بخصم 10$ من رصيد المستخدم لكل ساعة
        if (isPinnedBool) {
            console.log(`User ${seller_id} requested to pin an ad. Payment logic should be implemented here.`);
        }

        let imageUrl = null;
        let userProjectId = BACKEND_DEFAULT_PROJECT_ID;

        try {
            // ... (بقية الكود الأصلي لرفع الصورة وتحديد المشروع يبقى كما هو)
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [seller_id]);
            if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                userProjectId = userResult.rows[0].user_project_id;
            }

            const pool = projectDbPools[userProjectId];
            const supabase = projectSupabaseClients[userProjectId];

            if (imageFile) {
                const bucketName = 'marketing-images';
                const fileName = `${uuidv4()}.${imageFile.originalname.split('.').pop()}`;
                const { error: uploadError } = await supabase.storage.from(bucketName).upload(`${seller_id}/${fileName}`, imageFile.buffer, { contentType: imageFile.mimetype });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(`${seller_id}/${fileName}`);
                imageUrl = publicUrlData.publicUrl;
            }

            const adId = uuidv4();
            const timestamp = Date.now();
            
            // تم تحديث الاستعلام ليشمل الحقول الجديدة
            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, seller_id, is_pinned, is_deal, deal_expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [adId, title, description, price, imageUrl, ad_type, timestamp, seller_id, isPinnedBool, isDeal, dealExpiresAt]
            );

            res.status(201).json({ message: "Ad published successfully.", adId: adId });

        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });
    
    // POST /api/marketing/purchase - مع إضافة عمولة 2%
    router.post('/purchase', async (req, res) => {
        const { sellerId, buyerId, messageText } = req.body;
        // ... (الكود الأصلي لإرسال رسالة الشراء يبقى كما هو)
        
        // ملاحظة: هنا يجب إضافة منطق العمولة
        // بعد إتمام عملية الدفع، يتم خصم 2% من المبلغ وإضافته إلى رصيد التطبيق
        console.log(`A purchase request was made. After payment confirmation, a 2% commission should be processed.`);
        
        // الكود الأصلي لإنشاء المحادثة وإرسال الإشعار
        // ...
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
                await defaultPool.query(
                    `INSERT INTO chats (id, type, participants, timestamp) VALUES ($1, 'private', $2, $3)`,
                    [chatId, JSON.stringify([buyerId, sellerId]), Date.now()]
                );
            }
            
            // ... (بقية الكود لإنشاء الرسالة والإشعار)
            res.status(200).json({ message: "Purchase request sent successfully!", chatId: chatId });

        } catch (error) {
            console.error("Error processing purchase request:", error);
            res.status(500).json({ error: "Failed to send purchase request." });
        }
    });

    // POST /api/marketing/user/points - نقطة نهاية جديدة لتحديث نقاط المستخدم
    router.post('/user/points', async (req, res) => {
        const { userId, points } = req.body;
        if (!userId || points === undefined) {
            return res.status(400).json({ error: 'User ID and points are required.' });
        }

        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const result = await defaultPool.query(
                'UPDATE users SET points = points + $1 WHERE uid = $2 RETURNING points',
                [points, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found.' });
            }

            res.status(200).json({ message: 'Points updated successfully', newTotalPoints: result.rows[0].points });
        } catch (error) {
            console.error('Error updating user points:', error);
            res.status(500).json({ error: 'Failed to update points.' });
        }
    });
    
    // DELETE /api/marketing/:adId - يبقى كما هو
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

    return router;
};
