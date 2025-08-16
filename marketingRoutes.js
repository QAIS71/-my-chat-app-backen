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
                'SELECT uid, username, is_verified, user_role, points FROM users WHERE uid = $1',
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
                const result = await pool.query('SELECT * FROM marketing_ads');
                const enrichedAds = await Promise.all(result.rows.map(async (ad) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
                    return { ...ad, seller_username: sellerDetails?.username || 'غير معروف' };
                }));
                allAds = allAds.concat(enrichedAds);
            }
            // الفرز النهائي: المثبت أولاً، ثم الأحدث
            allAds.sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.timestamp) - new Date(a.timestamp)));
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - لإنشاء إعلان جديد
    router.post('/', upload.single('image'), async (req, res) => {
        const { title, description, price, ad_type, seller_id, is_pinned } = req.body;
        if (!title || !description || !ad_type || !seller_id) {
            return res.status(400).json({ error: "Missing required fields." });
        }
        
        const isPinnedBool = is_pinned === 'true';
        const isDeal = ad_type === 'deal';
        let dealExpiresAt = isDeal ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

        if (isPinnedBool) {
            // !! ملاحظة: هنا يجب إضافة منطق الدفع لتثبيت الإعلان !!
            console.log(`User ${seller_id} requested a pinned ad. Implement payment logic here.`);
        }

        try {
            const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // Assume all ads go to default project
            const supabase = projectSupabaseClients[BACKEND_DEFAULT_PROJECT_ID];
            let imageUrl = null;

            if (req.file) {
                const bucketName = 'marketing-images';
                const fileName = `${uuidv4()}.${req.file.originalname.split('.').pop()}`;
                const { error } = await supabase.storage.from(bucketName).upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
                if (error) throw error;
                imageUrl = supabase.storage.from(bucketName).getPublicUrl(fileName).data.publicUrl;
            }

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, seller_id, is_pinned, is_deal, deal_expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)`,
                [uuidv4(), title, description, price, imageUrl, ad_type, seller_id, isPinnedBool, isDeal, dealExpiresAt]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // POST /api/marketing/user/points - لتحديث نقاط المستخدم
    router.post('/user/points', async (req, res) => {
        const { userId, points } = req.body;
        if (!userId || points === undefined) return res.status(400).json({ error: 'User ID and points are required.' });
        try {
            const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const result = await pool.query(
                'UPDATE users SET points = points + $1 WHERE uid = $2 RETURNING points',
                [points, userId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
            res.status(200).json({ newTotalPoints: result.rows[0].points });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update points.' });
        }
    });

    // ... باقي الدوال مثل الشراء والحذف تبقى كما هي ...
    
    return router;
};
