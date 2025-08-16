// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // ==== دالة جديدة لتجهيز قاعدة البيانات عند بدء التشغيل ====
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
                'SELECT username, is_verified, user_role FROM users WHERE uid = $1',
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
                // الترتيب الجديد: المثبت أولاً، ثم الأحدث
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

    // POST /api/marketing - إنشاء إعلان جديد (منتج، وظيفة، أو عرض)
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
            const deal_expiry = is_deal ? timestamp + (24 * 60 * 60 * 1000) : null; // 24 ساعة للعروض

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, ad_type, timestamp, is_deal, deal_expiry, seller_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [adId, title, description, price, imageUrl, ad_type, timestamp, is_deal, deal_expiry, seller_id]
            );

            res.status(201).json({ message: "Ad published successfully.", adId: adId });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // ... (باقي الدوال مثل الحذف والشراء تبقى كما هي)

    return router;
};
