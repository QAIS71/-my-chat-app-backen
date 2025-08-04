// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// هذه الدالة ستقبل المتغيرات من server.js
module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // دالة مساعدة لجلب تفاصيل المستخدم من المشروع الافتراضي
    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT username FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details ${userId}:`, error);
            return null;
        }
    }

    // GET /api/marketing - لجلب كل الإعلانات من كل المشاريع
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads ORDER BY timestamp DESC');
                
                // إثراء الإعلانات بأسماء المستخدمين
                const enrichedAds = await Promise.all(result.rows.map(async (ad) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
                    return {
                        ...ad,
                        seller_username: sellerDetails ? sellerDetails.username : 'مستخدم محذوف'
                    };
                }));

                allAds = allAds.concat(enrichedAds);
            }
            // فرز نهائي لكل الإعلانات حسب الوقت
            allAds.sort((a, b) => b.timestamp - a.timestamp);
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - لإنشاء إعلان جديد
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id, seller_username } = req.body;
        const imageFile = req.file;

        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "Title, description, type, and seller ID are required." });
        }

        let imageUrl = null;
        let userProjectId = BACKEND_DEFAULT_PROJECT_ID; // افتراضياً

        try {
            // 1. تحديد مشروع المستخدم الصحيح لتخزين الإعلان والصورة
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

            // 2. رفع الصورة إلى Supabase Storage إذا كانت موجودة
            if (imageFile) {
                const bucketName = 'marketing-images'; // اسم الحاوية للصور التسويقية
                const fileExtension = imageFile.originalname.split('.').pop();
                const fileName = `${uuidv4()}.${fileExtension}`;
                const filePath = `${seller_id}/${fileName}`;

                const { data, error: uploadError } = await supabase.storage
                    .from(bucketName)
                    .upload(filePath, imageFile.buffer, {
                        contentType: imageFile.mimetype,
                        upsert: false
                    });

                if (uploadError) {
                    throw uploadError;
                }
                
                const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
                imageUrl = publicUrlData.publicUrl;
            }

            // 3. تخزين بيانات الإعلان في قاعدة بيانات مشروع المستخدم
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

    return router;
};
