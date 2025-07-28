// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');

module.exports = (projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) => {
    const router = express.Router();

    // احصل على مجمع قاعدة البيانات وعميل Supabase الافتراضيين لعمليات التسويق
    const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    const defaultSupabase = projectSupabaseClients[BACKEND_DEFAULT_PROJECT_ID];
    const bucketName = 'marketing-ads'; // دلو مخصص لصور الإعلانات التسويقية

    if (!defaultPool || !defaultSupabase) {
        console.error("خطأ: لم يتم تهيئة مجمع قاعدة البيانات أو عميل Supabase للمشروع الافتراضي في مسارات التسويق.");
        // يمكن التعامل مع هذا الخطأ بشكل مناسب، ربما عن طريق رمي استثناء أو إرجاع قيمة فارغة
    }

    // POST: إضافة إعلان جديد
    // يتطلب: title, description, adType. اختياري: price, isPromoted, sellerId, adImage (ملف)
    router.post('/ads', upload.single('adImage'), async (req, res) => {
        // callerUid هو للتحقق من الأذونات (إذا لزم الأمر)، sellerId لربط الإعلان بمستخدم معين
        const { title, description, price, isPromoted, adType, sellerId, callerUid } = req.body;
        const adImageFile = req.file;

        if (!title || !description || !adType) {
            return res.status(400).json({ error: 'العنوان والوصف ونوع الإعلان مطلوبة.' });
        }

        // اختياري: التحقق مما إذا كان sellerId موجودًا في جدول المستخدمين
        if (sellerId) {
            try {
                const sellerCheck = await defaultPool.query('SELECT 1 FROM users WHERE uid = $1', [sellerId]);
                if (sellerCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'معرف البائع غير موجود.' });
                }
            } catch (error) {
                console.error('خطأ في التحقق من معرف البائع:', error);
                return res.status(500).json({ error: 'فشل التحقق من معرف البائع.' });
            }
        }

        let imageUrl = null;
        if (adImageFile) {
            try {
                const fileExtension = adImageFile.originalname.split('.').pop();
                const fileName = `${uuidv4()}.${fileExtension}`;
                // تخزين الصور تحت مجلد عام 'ads' أو حسب sellerId إذا كانت مرتبطة
                const filePath = sellerId ? `${sellerId}/${fileName}` : `general/${fileName}`;

                const { data, error: uploadError } = await defaultSupabase.storage
                    .from(bucketName)
                    .upload(filePath, adImageFile.buffer, {
                        contentType: adImageFile.mimetype,
                        upsert: false
                    });

                if (uploadError) {
                    console.error('خطأ: فشل تحميل صورة الإعلان إلى Supabase Storage:', uploadError);
                    return res.status(500).json({ error: 'فشل تحميل صورة الإعلان.' });
                }

                const { data: publicUrlData } = defaultSupabase.storage
                    .from(bucketName)
                    .getPublicUrl(filePath);

                if (!publicUrlData || !publicUrlData.publicUrl) {
                    console.error('خطأ: فشل الحصول على الرابط العام لصورة الإعلان.');
                    return res.status(500).json({ error: 'فشل الحصول على رابط صورة الإعلان العام.' });
                }
                imageUrl = publicUrlData.publicUrl;
                console.log(`تم تحميل صورة الإعلان: ${imageUrl}`);
            } catch (error) {
                console.error('خطأ في معالجة تحميل صورة الإعلان:', error);
                return res.status(500).json({ error: 'خطأ داخلي أثناء تحميل الصورة.' });
            }
        }

        const adId = uuidv4();
        const timestamp = Date.now();

        try {
            await defaultPool.query(
                `INSERT INTO marketing_ads (id, title, description, price, image_url, is_promoted, ad_type, timestamp, seller_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [adId, title, description, price || null, imageUrl, isPromoted === 'true', adType, timestamp, sellerId || null]
            );
            res.status(201).json({ message: 'تم إضافة الإعلان بنجاح.', ad: { id: adId, title, description, price, imageUrl, isPromoted: isPromoted === 'true', adType, timestamp, sellerId } });
        } catch (error) {
            console.error('خطأ: فشل إضافة الإعلان إلى قاعدة البيانات:', error);
            res.status(500).json({ error: 'فشل إضافة الإعلان.' });
        }
    });

    // GET: جلب جميع الإعلانات (يمكن إضافة فلاتر لاحقًا)
    router.get('/ads', async (req, res) => {
        try {
            const result = await defaultPool.query('SELECT * FROM marketing_ads ORDER BY is_promoted DESC, timestamp DESC');
            res.status(200).json(result.rows);
        } catch (error) {
            console.error('خطأ: فشل جلب الإعلانات:', error);
            res.status(500).json({ error: 'فشل جلب الإعلانات.' });
        }
    });

    // PUT: تحديث إعلان موجود (يتطلب صلاحيات المدير أو البائع الأصلي للإعلان)
    // يتطلب: adId في params. اختياري: title, description, price, isPromoted, adType, sellerId, adImage (ملف)
    router.put('/ads/:adId', upload.single('adImage'), async (req, res) => {
        const { adId } = req.params;
        const { title, description, price, isPromoted, adType, sellerId, callerUid } = req.body; // callerUid للتحقق من الصلاحيات
        const adImageFile = req.file;

        if (!callerUid) {
            return res.status(401).json({ error: 'معرف المستخدم (callerUid) مطلوب للتحقق من الصلاحيات.' });
        }

        try {
            const existingAdResult = await defaultPool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
            const existingAd = existingAdResult.rows[0];

            if (!existingAd) {
                return res.status(404).json({ error: 'الإعلان غير موجود.' });
            }

            // التحقق من الصلاحيات: يمكن للمدير أو البائع الأصلي فقط تحديث الإعلان
            const callerUser = await defaultPool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
            const callerRole = callerUser.rows[0] ? callerUser.rows[0].user_role : 'normal';

            if (callerRole !== 'admin' && existingAd.seller_id !== callerUid) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الإعلان.' });
            }

            let imageUrl = existingAd.image_url;
            if (adImageFile) {
                // حذف الصورة القديمة إذا كانت موجودة
                if (existingAd.image_url) {
                    try {
                        const url = new URL(existingAd.image_url);
                        const pathSegments = url.pathname.split('/');
                        const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
                        await defaultSupabase.storage.from(bucketName).remove([filePathInBucket]);
                        console.log(`تم حذف الصورة القديمة للإعلان ${adId}: ${filePathInBucket}`);
                    } catch (deleteError) {
                        console.warn('تحذير: فشل حذف الصورة القديمة للإعلان:', deleteError);
                    }
                }

                const fileExtension = adImageFile.originalname.split('.').pop();
                const fileName = `${uuidv4()}.${fileExtension}`;
                const filePath = existingAd.seller_id ? `${existingAd.seller_id}/${fileName}` : `general/${fileName}`;

                const { data, error: uploadError } = await defaultSupabase.storage
                    .from(bucketName)
                    .upload(filePath, adImageFile.buffer, {
                        contentType: adImageFile.mimetype,
                        upsert: false
                    });

                if (uploadError) {
                    console.error('خطأ: فشل تحميل الصورة الجديدة للإعلان:', uploadError);
                    return res.status(500).json({ error: 'فشل تحميل الصورة الجديدة.' });
                }

                const { data: publicUrlData } = defaultSupabase.storage
                    .from(bucketName)
                    .getPublicUrl(filePath);

                if (!publicUrlData || !publicUrlData.publicUrl) {
                    console.error('خطأ: فشل الحصول على الرابط العام للصورة الجديدة للإعلان.');
                    return res.status(500).json({ error: 'فشل الحصول على رابط الصورة الجديدة العام.' });
                }
                imageUrl = publicUrlData.publicUrl;
                console.log(`تم تحميل الصورة الجديدة للإعلان ${adId}: ${imageUrl}`);
            }

            // تحديث الحقول فقط إذا تم توفيرها في الطلب
            const updatedTitle = title !== undefined ? title : existingAd.title;
            const updatedDescription = description !== undefined ? description : existingAd.description;
            const updatedPrice = price !== undefined ? price : existingAd.price;
            const updatedIsPromoted = isPromoted !== undefined ? (isPromoted === 'true') : existingAd.is_promoted;
            const updatedAdType = adType !== undefined ? adType : existingAd.ad_type;
            const updatedSellerId = sellerId !== undefined ? sellerId : existingAd.seller_id;


            await defaultPool.query(
                `UPDATE marketing_ads SET title = $1, description = $2, price = $3, image_url = $4, is_promoted = $5, ad_type = $6, seller_id = $7 WHERE id = $8`,
                [updatedTitle, updatedDescription, updatedPrice, imageUrl, updatedIsPromoted, updatedAdType, updatedSellerId, adId]
            );
            res.status(200).json({ message: 'تم تحديث الإعلان بنجاح.', ad: { id: adId, title: updatedTitle, description: updatedDescription, price: updatedPrice, imageUrl, isPromoted: updatedIsPromoted, adType: updatedAdType, sellerId: updatedSellerId } });
        } catch (error) {
            console.error('خطأ: فشل تحديث الإعلان:', error);
            res.status(500).json({ error: 'فشل تحديث الإعلان.' });
        }
    });

    // DELETE: حذف إعلان (يتطلب صلاحيات المدير أو البائع الأصلي للإعلان)
    // يتطلب: adId في params, callerUid في body
    router.delete('/ads/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid } = req.body; // callerUid للتحقق من الصلاحيات

        if (!callerUid) {
            return res.status(401).json({ error: 'معرف المستخدم (callerUid) مطلوب للتحقق من الصلاحيات.' });
        }

        try {
            const existingAdResult = await defaultPool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
            const existingAd = existingAdResult.rows[0];

            if (!existingAd) {
                return res.status(404).json({ error: 'الإعلان غير موجود.' });
            }

            // التحقق من الصلاحيات: يمكن للمدير أو البائع الأصلي فقط حذف الإعلان
            const callerUser = await defaultPool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
            const callerRole = callerUser.rows[0] ? callerUser.rows[0].user_role : 'normal';

            if (callerRole !== 'admin' && existingAd.seller_id !== callerUid) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا الإعلان.' });
            }

            // حذف الصورة من التخزين إذا كانت موجودة
            if (existingAd.image_url) {
                try {
                    const url = new URL(existingAd.image_url);
                    const pathSegments = url.pathname.split('/');
                    const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
                    await defaultSupabase.storage.from(bucketName).remove([filePathInBucket]);
                    console.log(`تم حذف الصورة المرتبطة بالإعلان ${adId}: ${filePathInBucket}`);
                } catch (deleteError) {
                    console.warn('تحذير: فشل حذف الصورة من Supabase Storage:', deleteError);
                }
            }

            await defaultPool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
            res.status(200).json({ message: 'تم حذف الإعلان بنجاح.' });
        } catch (error) {
            console.error('خطأ: فشل حذف الإعلان:', error);
            res.status(500).json({ error: 'فشل حذف الإعلان.' });
        }
    });

    return router;
};

