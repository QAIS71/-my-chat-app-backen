// server.js
// تحميل متغيرات البيئة من ملف .env في البيئة المحلية. في Render، يتم توفيرها مباشرة.
require('dotenv').config();

// إعداد بيئة Node.js كـ 'production' (إنتاج). هذا يساعد Render في فهم كيفية إدارة التطبيق.
process.env.NODE_ENV = 'production';

// استيراد المكتبات الضرورية
const express = require('express');
const { Pool } = require('pg'); // مكتبة للتعامل مع قاعدة بيانات PostgreSQL
const { NFTStorage, File } = require('nft.storage'); // مكتبة للتعامل مع تخزين الملفات على NFT.Storage (IPFS)
const multer = require('multer'); // مكتبة لمعالجة رفع الملفات (الصور والفيديوهات)
const cors = require('cors'); // مكتبة للسماح بالوصول من نطاقات مختلفة (Cross-Origin Resource Sharing)
const crypto = require('crypto'); // مكتبة Node.js الأصلية للعمليات التشفيرية (مثل التشفير/فك التشفير)
const fs = require('fs'); // مكتبة Node.js الأصلية للتعامل مع نظام الملفات (لقراءة وحذف الملفات المؤقتة)

// إنشاء تطبيق Express
const app = express();

// --- أسطر تصحيح الأخطاء (Debug) لمتغيرات البيئة ---
// هذه الأسطر ستطبع قيم متغيرات البيئة في سجلات Render عند بدء تشغيل الخادم.
// هذا يساعد في التأكد من أن Render يقرأ هذه القيم بشكل صحيح.
console.log('DEBUG: process.env.PORT:', process.env.PORT);
console.log('DEBUG: process.env.DATABASE_URL (partial):', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + '...' : 'Not set');
console.log('DEBUG: process.env.NFT_STORAGE_API_KEY (partial):', process.env.NFT_STORAGE_API_KEY ? process.env.NFT_STORAGE_API_KEY.substring(0, 10) + '...' : 'Not set');
// --- نهاية أسطر تصحيح الأخطاء ---


// تحديد المنفذ الذي سيستمع عليه الخادم.
// يستخدم process.env.PORT الذي يوفره Render، أو المنفذ 3000 للتطوير المحلي.
const port = process.env.PORT || 3000;

// تفعيل CORS للسماح لطلبات الواجهة الأمامية بالوصول إلى الخادم.
app.use(cors({
    origin: '*', // السماح بالوصول من أي نطاق. يمكن تحديد نطاقات معينة لأمان أفضل.
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // أنواع الطلبات المسموح بها
    allowedHeaders: ['Content-Type', 'Authorization'] // الرؤوس المسموح بها
}));

// تفعيل Express لمعالجة طلبات JSON في جسم الطلب.
app.use(express.json());

// إعداد اتصال قاعدة بيانات PostgreSQL باستخدام Pool.
// يستخدم DATABASE_URL الذي يتم توفيره كمتغير بيئة.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // السماح بالاتصال حتى لو كانت شهادة SSL غير موثوقة (ضروري لـ Supabase على Render)
    }
});

// تهيئة عميل NFT.Storage باستخدام مفتاح API.
const nftStorageClient = new NFTStorage({ token: '8eaeca42.4a1d3c18ab244b1488edd76ceb2b9374' });

// إعداد Multer لتخزين الملفات المرفوعة مؤقتاً في مجلد 'uploads/'.
const upload = multer({ dest: 'uploads/' });

// التأكد من وجود مجلد 'uploads' لـ Multer.
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// ---------------------------------------------------
// مسارات API (API Routes) - وظائف الخادم
// ---------------------------------------------------

// مسار أساسي للتحقق من أن الخادم يعمل
app.get('/', (req, res) => {
    res.send('Backend is running!');
});

// تسجيل المستخدمين الجدد
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
        }

        let customId;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            customId = Math.floor(10000000 + Math.random() * 90000000).toString();
            const idCheck = await pool.query('SELECT * FROM users WHERE custom_id = $1', [customId]);
            if (idCheck.rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
        if (!isUnique) {
            return res.status(500).json({ error: 'فشل في إنشاء معرف مخصص فريد.' });
        }

        const newUser = await pool.query(
            'INSERT INTO users (username, password, custom_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING uid, username, custom_id',
            [username, password, customId]
        );
        res.status(201).json({ message: 'تم تسجيل المستخدم بنجاح', user: newUser.rows[0] });
    } catch (err) {
        console.error('خطأ في التسجيل:', err);
        res.status(500).json({ error: 'خطأ خادم داخلي أثناء التسجيل.' });
    }
});

// تسجيل دخول المستخدمين
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        const user = userResult.rows[0];
        if (user.password !== password) { // يجب استخدام تشفير أقوى لكلمات المرور في الإنتاج
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_background_url
            }
        });
    } catch (err) {
        console.error('خطأ في تسجيل الدخول:', err);
        res.status(500).json({ error: 'خطأ خادم داخلي أثناء تسجيل الدخول.' });
    }
});

// رفع صورة خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'لم يتم رفع أي ملف.' });
    }
    const { userId } = req.body;
    if (!userId) {
        fs.unlinkSync(req.file.path); // حذف الملف المؤقت إذا لم يتم توفير معرف المستخدم
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const filePath = req.file.path;
    const fileName = `${userId}_profile_bg_${Date.now()}`;
    const mimeType = req.file.mimetype;

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
        
        const ipfsGatewayUrl = `https://ipfs.io/ipfs/${cid}`;

        await pool.query(
            'UPDATE users SET profile_background_url = $1 WHERE uid = $2',
            [ipfsGatewayUrl, userId]
        );

        fs.unlinkSync(filePath); // حذف الملف المؤقت بعد رفعه إلى NFT.Storage

        res.status(200).json({ message: 'تم رفع وتحديث خلفية الملف الشخصي بنجاح!', url: ipfsGatewayUrl });
    } catch (error) {
        console.error('خطأ في رفع خلفية الملف الشخصي:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); // التأكد من حذف الملف المؤقت في حال حدوث خطأ
        }
        res.status(500).json({ error: 'فشل في رفع خلفية الملف الشخصي: ' + error.message });
    }
});

// الحصول على رابط خلفية الملف الشخصي للمستخدم
app.get('/api/user/:uid/profile-background', async (req, res) => {
    const { uid } = req.params;
    try {
        const userResult = await pool.query('SELECT profile_background_url FROM users WHERE uid = $1', [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ url: userResult.rows[0].profile_background_url });
    } catch (err) {
        console.error('خطأ في جلب رابط خلفية الملف الشخصي:', err);
        res.status(500).json({ error: 'خطأ خادم داخلي.' });
    }
});

// الحصول على معلومات المستخدم بواسطة المعرف المخصص (Custom ID)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const userResult = await pool.query('SELECT uid, username, custom_id, profile_background_url FROM users WHERE custom_id = $1', [customId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        const user = userResult.rows[0];
        res.status(200).json({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_background_url
        });
    } catch (err) {
        console.error('خطأ في جلب المستخدم بواسطة المعرف المخصص:', err);
        res.status(500).json({ error: 'خطأ خادم داخلي.' });
    }
});

// الحصول على معلومات المستخدم بواسطة UID
app.get('/api/user/:uid', async (req, res) => {
    const { uid } = req.params;
    try {
        const userResult = await pool.query('SELECT uid, username, custom_id, profile_background_url FROM users WHERE uid = $1', [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        const user = userResult.rows[0];
        res.status(200).json({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_background_url
        });
    } catch (err) {
        console.error('خطأ في جلب المستخدم بواسطة UID:', err);
        res.status(500).json({ error: 'خطأ خادم داخلي.' });
    }
});

// الحصول على جميع المنشورات
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
        res.json(result.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('خطأ في جلب المنشورات:', err);
        res.status(500).json({ error: 'فشل في جلب المنشورات' });
    }
});

// الحصول على منشورات المتابعين
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const followingResult = await pool.query('SELECT following_uid FROM followers WHERE follower_uid = $1', [userId]);
        const followedUids = followingResult.rows.map(row => row.following_uid);
        followedUids.push(userId); // تضمين منشورات المستخدم الحالي

        if (followedUids.length === 0) {
            return res.json([]);
        }

        const postsResult = await pool.query(
            'SELECT * FROM posts WHERE author_id = ANY($1::text[]) ORDER BY created_at DESC',
            [followedUids]
        );
        res.json(postsResult.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('خطأ في جلب منشورات المتابعين:', err);
        res.status(500).json({ error: 'فشل في جلب منشورات المتابعين' });
    }
});

// البحث في المنشورات
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    let queryText = 'SELECT * FROM posts WHERE (post_text ILIKE $1 OR author_name ILIKE $1)';
    const queryParams = [`%${q}%`];
    let postRows;

    try {
        if (filter === 'followed' && userId) {
            const followingResult = await pool.query('SELECT following_uid FROM followers WHERE follower_uid = $1', [userId]);
            const followedUids = followingResult.rows.map(row => row.following_uid);
            followedUids.push(userId);
            
            if (followedUids.length === 0) {
                return res.json([]);
            }
            queryText += ' AND author_id = ANY($2::text[])';
            queryParams.push(followedUids);
            postRows = await pool.query(queryText + ' ORDER BY created_at DESC', queryParams);

        } else {
            postRows = await pool.query(queryText + ' ORDER BY created_at DESC', queryParams);
        }

        res.json(postRows.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('خطأ في البحث عن المنشورات:', err);
        res.status(500).json({ error: 'فشل في البحث عن المنشورات' });
    }
});

// إنشاء منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    let mediaUrl = null;
    const filePath = req.file ? req.file.path : null;

    try {
        if (filePath) {
            const fileName = `${req.file.originalname}_${Date.now()}`;
            const mimeType = req.file.mimetype;

            const fileBuffer = fs.readFileSync(filePath);
            const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
            mediaUrl = `https://ipfs.io/ipfs/${cid}`;
            fs.unlinkSync(filePath); // حذف الملف المؤقت
        }

        // جلب عدد المتابعين للمؤلف
        const followerCountResult = await pool.query('SELECT COUNT(*) FROM followers WHERE following_uid = $1', [authorId]);
        const followerCount = parseInt(followerCountResult.rows[0].count) || 0;

        const newPost = await pool.query(
            `INSERT INTO posts (author_id, author_name, post_text, media_type, media_url, likes, comments, views, follower_count, author_profile_bg, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING post_id`,
            [authorId, authorName, text, mediaType || null, mediaUrl, [], [], [], followerCount, authorProfileBg]
        );
        res.status(201).json({ message: 'تم نشر المنشور بنجاح!', postId: newPost.rows[0].post_id });
    } catch (err) {
        console.error('خطأ في نشر المنشور:', err);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'فشل في نشر المنشور: ' + err.message });
    }
});

// حذف منشور
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        const deleteResult = await pool.query('DELETE FROM posts WHERE post_id = $1 RETURNING post_id', [postId]);
        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    }
     catch (err) {
        console.error('خطأ في حذف المنشور:', err);
        res.status(500).json({ error: 'فشل في حذف المنشور.' });
    }
});

// تبديل حالة الإعجاب بالمنشور (Like/Unlike)
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    try {
        const postResult = await pool.query('SELECT likes FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        let likes = postResult.rows[0].likes || [];

        const index = likes.indexOf(userId);
        let isLiked;

        if (index > -1) {
            likes.splice(index, 1); // إزالة الإعجاب إذا كان موجوداً
            isLiked = false;
        } else {
            likes.push(userId); // إضافة الإعجاب
            isLiked = true;
        }

        await pool.query('UPDATE posts SET likes = $1 WHERE post_id = $2', [likes, postId]);
        res.status(200).json({ message: 'تم تحديث حالة الإعجاب', isLiked, likesCount: likes.length });
    } catch (err) {
        console.error('خطأ في تبديل حالة الإعجاب:', err);
        res.status(500).json({ error: 'فشل في تبديل حالة الإعجاب.' });
    }
});

// تسجيل مشاهدة المنشور
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    try {
        const postResult = await pool.query('SELECT views FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        let views = postResult.rows[0].views || [];

        if (!views.includes(userId)) { // إضافة المشاهدة فقط إذا لم يتم تسجيلها من قبل هذا المستخدم
            views.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE post_id = $2', [views, postId]);
        }
        res.status(200).json({ message: 'تم تسجيل المشاهدة.' });
    } catch (err) {
        console.error('خطأ في تسجيل المشاهدة:', err);
        res.status(500).json({ error: 'فشل في تسجيل المشاهدة.' });
    }
});

// الحصول على تعليقات المنشور
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE post_id = $1', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        res.status(200).json(postResult.rows[0].comments || []);
    } catch (err) {
        console.error('خطأ في جلب التعليقات:', err);
        res.status(500).json({ error: 'فشل في جلب التعليقات.' });
    }
});

// إضافة تعليق على المنشور
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        let comments = postResult.rows[0].comments || [];

        const newComment = {
            user: username,
            text: text,
            timestamp: Date.now()
        };
        comments.push(newComment); // إضافة التعليق الجديد

        await pool.query('UPDATE posts SET comments = $1 WHERE post_id = $2', [comments, postId]);
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح!', comment: newComment });
    } catch (err) {
        console.error('خطأ في إضافة التعليق:', err);
        res.status(500).json({ error: 'فشل في إضافة التعليق.' });
    }
});

// تبديل حالة المتابعة للمستخدم (Follow/Unfollow)
app.post('/api/user/:followerUid/follow/:followingUid', async (req, res) => {
    const { followerUid, followingUid } = req.params;
    if (followerUid === followingUid) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }
    try {
        const checkFollow = await pool.query(
            'SELECT * FROM followers WHERE follower_uid = $1 AND following_uid = $2',
            [followerUid, followingUid]
        );

        let isFollowing;
        let message;

        if (checkFollow.rows.length > 0) {
            // إذا كان المستخدم يتابعه بالفعل، قم بإلغاء المتابعة
            await pool.query(
                'DELETE FROM followers WHERE follower_uid = $1 AND following_uid = $2',
                [followerUid, followingUid]
            );
            isFollowing = false;
            message = 'تم إلغاء المتابعة بنجاح.';
        } else {
            // إذا لم يكن يتابعه، قم بالمتابعة
            await pool.query(
                'INSERT INTO followers (follower_uid, following_uid) VALUES ($1, $2)',
                [followerUid, followingUid]
            );
            isFollowing = true;
            message = 'تمت المتابعة بنجاح.';
        }
        res.status(200).json({ message, isFollowing });
    } catch (err) {
        console.error('خطأ في تبديل حالة المتابعة:', err);
        res.status(500).json({ error: 'فشل في تبديل حالة المتابعة.' });
    }
});

// التحقق من حالة المتابعة
app.get('/api/user/:followerUid/following/:followingUid', async (req, res) => {
    const { followerUid, followingUid } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM followers WHERE follower_uid = $1 AND following_uid = $2',
            [followerUid, followingUid]
        );
        res.status(200).json({ isFollowing: result.rows.length > 0 });
    } catch (err) {
        console.error('خطأ في التحقق من حالة المتابعة:', err);
        res.status(500).json({ error: 'فشل في التحقق من حالة المتابعة.' });
    }
});

// الحصول على عدد المتابعين
app.get('/api/user/:uid/followers/count', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE following_uid = $1', [uid]);
        res.status(200).json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('خطأ في جلب عدد المتابعين:', err);
        res.status(500).json({ error: 'فشل في جلب عدد المتابعين.' });
    }
});

// الحصول على جهات اتصال المستخدم
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT contact_uid, contact_name, contact_custom_id, contact_username FROM user_contacts WHERE user_uid = $1', [userId]);
        res.json(result.rows.map(row => ({
            uid: row.contact_uid,
            username: row.contact_name, // استخدام contact_name كاسم عرض
            customId: row.contact_custom_id,
            actualUsername: row.contact_username // اسم المستخدم الفعلي
        })));
    } catch (err) {
        console.error('خطأ في جلب جهات اتصال المستخدم:', err);
        res.status(500).json({ error: 'فشل في جلب جهات اتصال المستخدم.' });
    }
});

// إنشاء محادثة خاصة (بين شخصين)
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    // ترتيب معرفات الأعضاء لضمان chat_id فريد ومتسق
    const chatMembers = [user1Id, user2Id].sort();
    const chatId = chatMembers.join('_');

    try {
        const existingChat = await pool.query('SELECT * FROM chats WHERE chat_id = $1', [chatId]);
        if (existingChat.rows.length > 0) {
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId });
        }

        // إنشاء المحادثة في جدول chats
        await pool.query(
            `INSERT INTO chats (chat_id, member1_uid, member2_uid, last_message, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [chatId, chatMembers[0], chatMembers[1], 'لا توجد رسائل بعد']
        );

        // إضافة المحادثة لجدول user_chats لكل عضو
        await pool.query(
            'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [user1Id, chatId, 'private', contactName, user2CustomId, 'لا توجد رسائل بعد']
        );
        await pool.query(
            'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [user2Id, chatId, 'private', user1Name, user1CustomId, 'لا توجد رسائل بعد']
        );

        // إضافة المستخدم كجهة اتصال للآخر
        await pool.query(
            `INSERT INTO user_contacts (user_uid, contact_uid, contact_name, contact_custom_id, contact_username)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_uid, contact_uid) DO UPDATE SET contact_name = EXCLUDED.contact_name`,
            [user1Id, user2Id, contactName, user2CustomId, user2Name]
        );

        res.status(201).json({ message: 'تم إنشاء المحادثة الخاصة بنجاح!', chatId });
    } catch (err) {
        console.error('خطأ في إنشاء المحادثة الخاصة:', err);
        res.status(500).json({ error: 'فشل في إنشاء المحادثة الخاصة.' });
    }
});

// الحصول على محادثات المستخدم (الخاصة والمجموعات)
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    try {
        const chats = [];

        // جلب المحادثات الخاصة
        const privateChatsResult = await pool.query(
            `SELECT
                uc.chat_id,
                uc.chat_type,
                uc.chat_name,
                uc.custom_id,
                uc.last_message,
                uc.updated_at,
                c.member1_uid,
                c.member2_uid
            FROM user_chats uc
            JOIN chats c ON uc.chat_id = c.chat_id
            WHERE uc.user_uid = $1 AND uc.chat_type = 'private'
            ORDER BY uc.updated_at DESC`,
            [userId]
        );

        for (const row of privateChatsResult.rows) {
            const otherUid = row.member1_uid === userId ? row.member2_uid : row.member1_uid;
            const otherUserResult = await pool.query('SELECT profile_background_url FROM users WHERE uid = $1', [otherUid]);
            const profileBg = otherUserResult.rows.length > 0 ? otherUserResult.rows[0].profile_background_url : null;
            chats.push({
                id: row.chat_id,
                type: row.chat_type,
                name: row.chat_name,
                customId: row.custom_id,
                lastMessage: row.last_message,
                timestamp: new Date(row.updated_at).getTime(),
                profileBg: profileBg
            });
        }

        // جلب محادثات المجموعات
        const groupChatsResult = await pool.query(
            `SELECT
                uc.chat_id,
                uc.chat_type,
                uc.chat_name,
                uc.last_message,
                uc.updated_at,
                g.name as group_name
            FROM user_chats uc
            JOIN groups g ON uc.chat_id = g.group_id
            WHERE uc.user_uid = $1 AND uc.chat_type = 'group'
            ORDER BY uc.updated_at DESC`,
            [userId]
        );

        for (const row of groupChatsResult.rows) {
            chats.push({
                id: row.chat_id,
                type: row.chat_type,
                name: row.group_name, // اسم المجموعة من جدول groups
                customId: null, // لا يوجد customId للمجموعات
                lastMessage: row.last_message,
                timestamp: new Date(row.updated_at).getTime(),
                profileBg: null // لا توجد صورة خلفية للمجموعات حالياً
            });
        }

        // فرز جميع المحادثات حسب آخر تحديث
        chats.sort((a, b) => b.timestamp - a.timestamp);

        res.json(chats);
    } catch (err) {
        console.error('خطأ في جلب محادثات المستخدم:', err);
        res.status(500).json({ error: 'فشل في جلب محادثات المستخدم.' });
    }
});

// الحصول على رسائل المحادثة
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = req.query.since ? new Date(parseInt(req.query.since)) : new Date(0); // جلب الرسائل الأحدث من وقت معين

    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 AND created_at > $2 ORDER BY created_at ASC',
            [chatId, sinceTimestamp]
        );
        res.json(result.rows.map(msg => ({
            id: msg.message_id,
            senderId: msg.sender_id,
            senderName: msg.sender_name,
            text: msg.message_text,
            mediaType: msg.media_type,
            mediaUrl: msg.media_url,
            timestamp: new Date(msg.created_at).getTime(),
            senderProfileBg: msg.sender_profile_bg
        })));
    } catch (err) {
        console.error('خطأ في جلب الرسائل:', err);
        res.status(500).json({ error: 'فشل في جلب الرسائل.' });
    }
});

// إرسال رسالة في محادثة
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    let mediaUrl = null;
    const filePath = req.file ? req.file.path : null;

    try {
        if (filePath) {
            const fileName = `${req.file.originalname}_${Date.now()}`;
            const mimeType = req.file.mimetype;

            const fileBuffer = fs.readFileSync(filePath);
            const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
            mediaUrl = `https://ipfs.io/ipfs/${cid}`;
            fs.unlinkSync(filePath); // حذف الملف المؤقت
        }

        // إدخال الرسالة الجديدة في جدول الرسائل
        const newMessageResult = await pool.query(
            `INSERT INTO messages (chat_id, sender_id, sender_name, message_text, media_type, media_url, sender_profile_bg, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING message_id`,
            [chatId, senderId, senderName, text, mediaType || null, mediaUrl, senderProfileBg || null]
        );

        // تحديث آخر رسالة وتاريخ التحديث في جدول المحادثات الرئيسي (chats أو groups)
        const isGroupChat = (await pool.query('SELECT * FROM groups WHERE group_id = $1', [chatId])).rows.length > 0;
        const chatTableName = isGroupChat ? 'groups' : 'chats';
        const chatPkColumn = isGroupChat ? 'group_id' : 'chat_id';

        await pool.query(
            `UPDATE ${chatTableName} SET last_message = $1, updated_at = NOW() WHERE ${chatPkColumn} = $2`,
            [text || (mediaType === 'image' ? 'صورة جديدة' : 'فيديو جديد'), chatId]
        );

        // تحديث آخر رسالة وتاريخ التحديث في جدول user_chats لكل عضو في المحادثة/المجموعة
        if (isGroupChat) {
            const groupMembersResult = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1', [chatId]);
            const members = groupMembersResult.rows.map(row => row.member_uid);
            for (const memberUid of members) {
                await pool.query(
                    'UPDATE user_chats SET last_message = $1, updated_at = NOW() WHERE user_uid = $2 AND chat_id = $3',
                    [text || (mediaType === 'image' ? 'صورة جديدة' : 'فيديو جديد'), memberUid, chatId]
                );
            }
        } else {
            const chatMembersResult = await pool.query('SELECT member1_uid, member2_uid FROM chats WHERE chat_id = $1', [chatId]);
            const members = [chatMembersResult.rows[0].member1_uid, chatMembersResult.rows[0].member2_uid];
            for (const memberUid of members) {
                await pool.query(
                    'UPDATE user_chats SET last_message = $1, updated_at = NOW() WHERE user_uid = $2 AND chat_id = $3',
                    [text || (mediaType === 'image' ? 'صورة جديدة' : 'فيديو جديد'), memberUid, chatId]
                );
            }
        }

        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', messageId: newMessageResult.rows[0].message_id });
    } catch (err) {
        console.error('خطأ في إرسال الرسالة:', err);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'فشل في إرسال الرسالة: ' + err.message });
    }
});

// حذف محادثة (خاصة أو جماعية)
app.post('/api/chats/delete', async (req, res) => {
    const { chatId, chatType, action, userId } = req.body;

    try {
        if (chatType === 'private') {
            if (action === 'forMe') {
                // حذف المحادثة من قائمة المستخدم الحالي فقط
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);
                res.status(200).json({ message: 'تم حذف المحادثة لك فقط.' });
            } else if (action === 'forBoth') {
                // حذف المحادثة لجميع المشاركين والرسائل وجهات الاتصال
                const chatMembersResult = await pool.query('SELECT member1_uid, member2_uid FROM chats WHERE chat_id = $1', [chatId]);
                if (chatMembersResult.rows.length === 0) {
                    return res.status(404).json({ error: 'المحادثة الخاصة غير موجودة.' });
                }
                const { member1_uid, member2_uid } = chatMembersResult.rows[0];

                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [member1_uid, chatId]);
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [member2_uid, chatId]);

                await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                await pool.query('DELETE FROM chats WHERE chat_id = $1', [chatId]);

                // حذف من جهات الاتصال لكلا المستخدمين
                await pool.query('DELETE FROM user_contacts WHERE user_uid = $1 AND contact_uid = $2', [member1_uid, member2_uid]);
                await pool.query('DELETE FROM user_contacts WHERE user_uid = $1 AND contact_uid = $2', [member2_uid, member1_uid]);

                res.status(200).json({ message: 'تم حذف المحادثة لكلا المشاركين.' });
            }
        } else if (chatType === 'group') {
            const groupRef = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [chatId]);
            if (groupRef.rows.length === 0) {
                return res.status(404).json({ error: 'المجموعة غير موجودة.' });
            }
            const groupAdminId = groupRef.rows[0].admin_uid;

            if (action === 'forMe') {
                // إزالة المجموعة من قائمة المستخدم الحالي فقط
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);
                res.status(200).json({ message: 'تمت إزالة المجموعة من قائمتك.' });
            } else if (action === 'leaveGroup') {
                // مغادرة المجموعة
                await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_uid = $2', [chatId, userId]);
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);

                // إذا لم يتبق أعضاء في المجموعة، قم بحذفها بالكامل
                const remainingMembers = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [chatId]);
                if (parseInt(remainingMembers.rows[0].count) === 0) {
                    await pool.query('DELETE FROM groups WHERE group_id = $1', [chatId]);
                    await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                    res.status(200).json({ message: 'لقد غادرت المجموعة. تم حذف المجموعة لعدم بقاء أعضاء.' });
                } else {
                    // إذا كان المستخدم الذي غادر هو المدير الوحيد، قم بتعيين مدير جديد
                    const remainingAdmins = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1 AND role = \'admin\'', [chatId]);
                    if (remainingAdmins.rows.length === 0 && userId === groupAdminId) {
                        const firstRemainingMember = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1 ORDER BY joined_at ASC LIMIT 1', [chatId]);
                        if (firstRemainingMember.rows.length > 0) {
                            await pool.query('UPDATE group_members SET role = \'admin\' WHERE group_id = $1 AND member_uid = $2', [chatId, firstRemainingMember.rows[0].member_uid]);
                            console.log(`Group ${chatId}: تم تعيين مدير جديد لـ ${firstRemainingMember.rows[0].member_uid}`);
                        }
                    }
                    res.status(200).json({ message: 'لقد غادرت المجموعة.' });
                }
            }
        }
    } catch (err) {
        console.error('خطأ في حذف المحادثة:', err);
        res.status(500).json({ error: 'فشل في حذف المحادثة: ' + err.message });
    }
});

// إنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;
    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، والمدير، وعضوان على الأقل مطلوبان.' });
    }

    try {
        const newGroupResult = await pool.query(
            `INSERT INTO groups (name, description, admin_uid, last_message, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING group_id`,
            [name, description, adminId, 'تم إنشاء المجموعة']
        );
        const groupId = newGroupResult.rows[0].group_id;

        const memberInsertPromises = [];
        for (const memberUid in members) {
            memberInsertPromises.push(
                pool.query('INSERT INTO group_members (group_id, member_uid, role, joined_at) VALUES ($1, $2, $3, NOW())',
                [groupId, memberUid, members[memberUid]])
            );
            // إضافة المجموعة إلى قائمة المحادثات لكل عضو
            const memberUserResult = await pool.query('SELECT username, custom_id FROM users WHERE uid = $1', [memberUid]);
            const memberUsername = memberUserResult.rows[0]?.username || 'مستخدم غير معروف';
            const memberCustomId = memberUserResult.rows[0]?.custom_id || 'غير متاح';

            memberInsertPromises.push(
                pool.query(
                    'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
                    [memberUid, groupId, 'group', name, null, 'تم إنشاء المجموعة']
                )
            );
        }
        await Promise.all(memberInsertPromises); // تنفيذ جميع عمليات إدخال الأعضاء

        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح!', groupId });
    } catch (err) {
        console.error('خطأ في إنشاء المجموعة:', err);
        res.status(500).json({ error: 'فشل في إنشاء المجموعة: ' + err.message });
    }
});

// الحصول على أعضاء المجموعة
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const membersResult = await pool.query(
            `SELECT gm.member_uid, gm.role, u.username, u.custom_id, u.profile_background_url
            FROM group_members gm
            JOIN users u ON gm.member_uid = u.uid
            WHERE gm.group_id = $1 ORDER BY gm.joined_at ASC`,
            [groupId]
        );
        res.status(200).json(membersResult.rows.map(row => ({
            uid: row.member_uid,
            username: row.username,
            customId: row.custom_id,
            role: row.role,
            profileBg: row.profile_background_url
        })));
    } catch (err) {
        console.error('خطأ في جلب أعضاء المجموعة:', err);
        res.status(500).json({ error: 'فشل في جلب أعضاء المجموعة.' });
    }
});

// الحصول على عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [groupId]);
        res.status(200).json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('خطأ في جلب عدد أعضاء المجموعة:', err);
        res.status(500).json({ error: 'فشل في جلب عدد أعضاء المجموعة.' });
    }
});

// تغيير دور العضو في المجموعة
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;
    
    try {
        // التحقق مما إذا كان المستخدم الذي يقوم بالطلب هو مدير
        const callerRoleResult = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, callerUid]);
        if (callerRoleResult.rows.length === 0 || callerRoleResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'ممنوع: يجب أن تكون مديراً لتغيير أدوار الأعضاء.' });
        }

        // منع إزالة دور المدير الوحيد للمجموعة
        if (newRole === 'member') {
            const groupInfoResult = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [groupId]);
            const groupAdminId = groupInfoResult.rows[0]?.admin_uid;

            const currentAdminsCountResult = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = \'admin\'', [groupId]);
            const currentAdminsCount = parseInt(currentAdminsCountResult.rows[0].count);

            if (currentAdminsCount === 1 && memberUid === groupAdminId) {
                return res.status(400).json({ error: 'لا يمكن خفض رتبة المدير الوحيد (منشئ المجموعة).' });
            }
        }

        await pool.query(
            'UPDATE group_members SET role = $1 WHERE group_id = $2 AND member_uid = $3',
            [newRole, groupId, memberUid]
        );
        res.status(200).json({ message: `تم تحديث دور العضو إلى ${newRole}.` });
    } catch (err) {
        console.error('خطأ في تغيير دور العضو:', err);
        res.status(500).json({ error: 'فشل في تغيير دور العضو.' });
    }
});

// إزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    try {
        // التحقق مما إذا كان المستخدم الذي يقوم بالطلب هو مدير
        const callerRoleResult = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, callerUid]);
        if (callerRoleResult.rows.length === 0 || callerRoleResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'ممنوع: يجب أن تكون مديراً لإزالة الأعضاء.' });
        }

        // منع إزالة النفس بهذا المسار
        if (memberUid === callerUid) {
            return res.status(400).json({ error: 'لا يمكنك إزالة نفسك بهذه الطريقة. يرجى استخدام خيار مغادرة المجموعة.' });
        }

        // منع إزالة المدير الوحيد
        const groupInfoResult = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [groupId]);
        const groupAdminId = groupInfoResult.rows[0]?.admin_uid;

        if (memberUid === groupAdminId) {
            const currentAdminsCountResult = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = \'admin\'', [groupId]);
            const currentAdminsCount = parseInt(currentAdminsCountResult.rows[0].count);
            if (currentAdminsCount === 1) {
                return res.status(400).json({ error: 'لا يمكن إزالة المدير الوحيد (منشئ المجموعة).' });
            }
        }
        
        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, memberUid]);
        await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [memberUid, groupId]);

        // إذا لم يتبق أعضاء في المجموعة بعد الإزالة، قم بحذفها بالكامل
        const remainingMembers = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [groupId]);
        if (parseInt(remainingMembers.rows[0].count) === 0) {
            await pool.query('DELETE FROM groups WHERE group_id = $1', [groupId]);
            await pool.query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
            res.status(200).json({ message: 'تمت إزالة العضو. تم حذف المجموعة لعدم بقاء أعضاء.' });
        } else {
            res.status(200).json({ message: 'تمت إزالة العضو بنجاح.' });
        }

    } catch (err) {
        console.error('خطأ في إزالة العضو:', err);
        res.status(500).json({ error: 'فشل في إزالة العضو: ' + err.message });
    }
});

// بدء تشغيل الخادم
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Access it locally via: http://localhost:${port}`);
});
