// استيراد المكتبات المطلوبة
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// هذه الوظيفة تستقبل مجمعات الاتصال بقواعد البيانات وعملاء Supabase
// بالإضافة إلى كائن upload من multer ومعرف المشروع الافتراضي.
module.exports = (projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) => {
    const router = express.Router();

    // وظيفة مساعدة للحصول على سياق المشروع الصحيح (Pool و Supabase Client) للمستخدم
    // تم نسخها من server.js لضمان استقلال marketingRoutes.js قدر الإمكان
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
                console.error(`خطأ في جلب معرف المشروع للمستخدم ${userId} في marketingRoutes:`, error);
            }
        }

        if (!projectDbPools[projectId] || !projectSupabaseClients[projectId]) {
            console.error(`خطأ: معرف المشروع ${projectId} غير صالح أو غير مهيأ في marketingRoutes. سيتم الرجوع إلى المشروع الافتراضي.`);
            projectId = BACKEND_DEFAULT_PROJECT_ID;
        }

        return {
            pool: projectDbPools[projectId],
            supabase: projectSupabaseClients[projectId],
            projectId: projectId
        };
    }

    // وظيفة مساعدة لجلب تفاصيل المستخدم من المشروع الافتراضي
    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool) {
            console.error("Default project pool not initialized in marketingRoutes.");
            return null;
        }
        try {
            const userResult = await defaultPool.query(
                'SELECT username, is_verified, user_role, profile_bg_url FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`خطأ في جلب تفاصيل المستخدم ${userId} من المشروع الافتراضي في marketingRoutes:`, error);
            return null;
        }
    }

    // نقطة نهاية لنشر إعلان جديد (منتج، خدمة، وظيفة)
    router.post('/ads', upload.single('mediaFile'), async (req, res) => {
        const { title, description, price, adType, isPromoted, sellerId } = req.body;
        const mediaFile = req.file;
        const bucketName = 'marketing-ads-media'; // اسم الباكت لملفات التسويق

        let imageUrl = null;

        if (!title || !adType || !sellerId) {
            console.error('خطأ: العنوان، نوع الإعلان، ومعرف البائع مطلوبون.');
            return res.status(400).json({ error: 'العنوان، نوع الإعلان، ومعرف البائع مطلوبون.' });
        }

        // الحصول على سياق المشروع الصحيح للبائع (المستخدم الذي ينشر الإعلان)
        const { pool, supabase, projectId } = await getUserProjectContext(sellerId);

        try {
            // التحقق من وجود البائع في جدول المستخدمين بالمشروع الافتراضي
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const sellerCheck = await defaultPool.query('SELECT 1 FROM users WHERE uid = $1', [sellerId]);
            if (sellerCheck.rows.length === 0) {
                console.error(`خطأ: البائع ${sellerId} غير موجود.`);
                return res.status(404).json({ error: 'البائع غير موجود.' });
            }

            if (mediaFile) {
                const fileExtension = mediaFile.originalname.split('.').pop();
                const fileName = `${uuidv4()}.${fileExtension}`;
                const filePath = `${sellerId}/${fileName}`; // تخزين الملفات تحت مجلد باسم البائع

                console.log(`محاولة تحميل ملف الإعلان إلى المشروع ${projectId}، Bucket: ${bucketName}, المسار: ${filePath}`);
                const { data, error: uploadError } = await supabase.storage
                    .from(bucketName)
                    .upload(filePath, mediaFile.buffer, {
                        contentType: mediaFile.mimetype,
                        upsert: false // لا تقم بالتحديث إذا كان الملف موجودًا بالفعل
                    });

                if (uploadError) {
                    console.error('خطأ: فشل تحميل الملف إلى Supabase Storage:', uploadError);
                    console.error('تفاصيل خطأ Supabase:', uploadError.statusCode, uploadError.error, uploadError.message);
                    return res.status(500).json({ error: 'فشل تحميل الملف إلى التخزين.' });
                }

                const { data: publicUrlData } = supabase.storage
                    .from(bucketName)
                    .getPublicUrl(filePath);

                if (!publicUrlData || !publicUrlData.publicUrl) {
                    console.error('خطأ: فشل الحصول على الرابط العام للملف الذي تم تحميله.');
                    return res.status(500).json({ error: 'فشل الحصول على رابط الملف العام.' });
                }

                imageUrl = publicUrlData.publicUrl;
                console.log(`تم تحميل ملف الوسائط للإعلان في المشروع ${projectId}: ${imageUrl}`);
            }

            const adId = uuidv4();
            const timestamp = Date.now();

            await pool.query( // استخدام الـ pool الخاص بمشروع البائع
                `INSERT INTO marketing_ads (id, title, description, price, image_url, is_promoted, ad_type, timestamp, seller_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [adId, title, description || null, price || null, imageUrl, isPromoted === 'true', adType, timestamp, sellerId]
            );

            console.log(`تم نشر إعلان جديد في المشروع ${projectId}:`, { adId, title, adType, sellerId });
            res.status(201).json({ message: 'تم نشر الإعلان بنجاح.', adId });
        } catch (error) {
            console.error('خطأ: فشل نشر الإعلان:', error);
            res.status(500).json({ error: 'فشل نشر الإعلان.' });
        }
    });

    // نقطة نهاية لجلب الإعلانات
    router.get('/ads', async (req, res) => {
        const { type, search, promotedOnly } = req.query; // معايير الفلترة
        let allAds = [];

        // جلب الإعلانات من جميع المشاريع
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                let query = `SELECT * FROM marketing_ads`;
                const queryParams = [];
                const conditions = [];
                let paramIndex = 1;

                if (type) {
                    conditions.push(`ad_type = $${paramIndex++}`);
                    queryParams.push(type);
                }
                if (search) {
                    conditions.push(`(LOWER(title) LIKE $${paramIndex} OR LOWER(description) LIKE $${paramIndex++})`);
                    queryParams.push(`%${search.toLowerCase()}%`);
                }
                if (promotedOnly === 'true') {
                    conditions.push(`is_promoted = TRUE`);
                }

                if (conditions.length > 0) {
                    query += ` WHERE ` + conditions.join(' AND ');
                }
                query += ` ORDER BY timestamp DESC`; // فرز حسب الأحدث

                const result = await pool.query(query, queryParams);
                allAds = allAds.concat(result.rows);
            } catch (error) {
                console.error(`خطأ في جلب الإعلانات من المشروع ${projectId}:`, error);
            }
        }

        // إثراء الإعلانات بتفاصيل البائع (المستخدم) من المشروع الافتراضي
        const enrichedAds = await Promise.all(allAds.map(async ad => {
            const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
            return {
                id: ad.id,
                title: ad.title,
                description: ad.description,
                price: ad.price,
                imageUrl: ad.image_url,
                isPromoted: ad.is_promoted,
                adType: ad.ad_type,
                timestamp: parseInt(ad.timestamp),
                sellerId: ad.seller_id,
                sellerUsername: sellerDetails ? sellerDetails.username : 'Unknown Seller',
                sellerProfileBg: sellerDetails ? sellerDetails.profile_bg_url : null,
                sellerIsVerified: sellerDetails ? sellerDetails.is_verified : false,
                sellerUserRole: sellerDetails ? sellerDetails.user_role : 'normal'
            };
        }));

        // الفرز النهائي: الإعلانات المثبتة أولاً، ثم حسب الأحدث
        enrichedAds.sort((a, b) => {
            if (a.isPromoted && !b.isPromoted) return -1;
            if (!a.isPromoted && b.isPromoted) return 1;
            return b.timestamp - a.timestamp;
        });

        res.status(200).json(enrichedAds);
    });

    // نقطة نهاية لحذف إعلان (للبائع أو المدير)
    router.delete('/ads/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerId } = req.body; // معرف المستخدم الذي يقوم بالحذف

        if (!callerId) {
            return res.status(400).json({ error: 'معرف المستخدم الذي يقوم بالحذف مطلوب.' });
        }

        let adToDelete = null;
        let adPool = null;
        let adProjectId = null;

        // البحث عن الإعلان في جميع المشاريع
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                const result = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) {
                    adToDelete = result.rows[0];
                    adPool = pool;
                    adProjectId = projectId;
                    break;
                }
            } catch (error) {
                console.error(`خطأ في البحث عن الإعلان ${adId} في المشروع ${projectId}:`, error);
            }
        }

        if (!adToDelete) {
            return res.status(404).json({ error: 'الإعلان غير موجود.' });
        }

        try {
            // التحقق من صلاحيات الحذف (البائع نفسه أو مدير عام)
            const callerDetails = await getUserDetailsFromDefaultProject(callerId);
            if (!callerDetails || (callerDetails.user_role !== 'admin' && adToDelete.seller_id !== callerId)) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا الإعلان.' });
            }

            // حذف الصورة من Supabase Storage إذا كانت موجودة
            if (adToDelete.image_url) {
                const supabase = projectSupabaseClients[adProjectId]; // عميل Supabase للمشروع الذي يوجد به الإعلان
                const bucketName = 'marketing-ads-media';
                const url = new URL(adToDelete.image_url);
                const pathSegments = url.pathname.split('/');
                const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');

                const { data: removeData, error: deleteError } = await supabase.storage
                    .from(bucketName)
                    .remove([filePathInBucket]);

                if (deleteError) {
                    console.error('خطأ: فشل حذف صورة الإعلان من Supabase Storage:', deleteError);
                } else {
                    console.log(`تم حذف ملف صورة الإعلان من Supabase Storage في المشروع ${adProjectId}: ${filePathInBucket}`);
                }
            }

            // حذف الإعلان من قاعدة البيانات
            await adPool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
            console.log(`تم حذف الإعلان ${adId} من المشروع ${adProjectId}.`);
            res.status(200).json({ message: 'تم حذف الإعلان بنجاح.' });
        } catch (error) {
            console.error('خطأ: فشل حذف الإعلان:', error);
            res.status(500).json({ error: 'فشل حذف الإعلان.' });
        }
    });

    return router;
};
