// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // دالة مساعدة لجلب تفاصيل المستخدم من المشروع الافتراضي
    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT username, is_verified, user_role FROM users WHERE uid = $1',
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
                
                // إثراء الإعلانات بأسماء المستخدمين ومعلومات التوثيق
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

        if (!callerUid) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            const isAdmin = callerDetails && callerDetails.user_role === 'admin';
            
            let adFound = false;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                
                if (adResult.rows.length > 0) {
                    adFound = true;
                    const ad = adResult.rows[0];

                    if (ad.seller_id !== callerUid && !isAdmin) {
                        return res.status(403).json({ error: "You are not authorized to delete this ad." });
                    }

                    if (ad.image_url) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'marketing-images';
                        const url = new URL(ad.image_url);
                        const pathSegments = url.pathname.split('/');
                        const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
                        await supabase.storage.from(bucketName).remove([filePathInBucket]);
                    }

                    await pool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
                    return res.status(200).json({ message: 'Ad deleted successfully.' });
                }
            }

            if (!adFound) {
                return res.status(404).json({ error: 'Ad not found.' });
            }

        } catch (error) {
            console.error("Error deleting ad:", error);
            res.status(500).json({ error: "Failed to delete ad." });
        }
    });

    return router;
};
