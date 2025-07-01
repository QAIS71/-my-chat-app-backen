// استيراد المكتبات المطلوبة
const express = require('express'); // إطار عمل Express لإنشاء الخادم
const bodyParser = require('body-parser'); // لتحليل نصوص طلبات HTTP
const cors = require('cors'); // للتعامل مع سياسات CORS (Cross-Origin Resource Sharing)
const multer = require('multer'); // للتعامل مع تحميل الملفات (الصور والفيديوهات)
const { v4: uuidv4 } = require('uuid'); // لإنشاء معرفات فريدة عالمياً (UUIDs)
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'); // عميل Storj DCS S3
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner'); // لإنشاء روابط مؤقتة للملفات
const path = require('path'); // للتعامل مع مسارات الملفات
const { Pool } = require('pg'); // لاستخدام PostgreSQL

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000; // استخدام المنفذ المحدد بواسطة البيئة (مثلاً Render) أو المنفذ 3000 افتراضياً

// ----------------------------------------------------------------------------------------------------
// مفاتيح Storj DCS
// ----------------------------------------------------------------------------------------------------
const STORJ_ENDPOINT = "https://gateway.storjshare.io";
const STORJ_REGION = "us-east-1";
const STORJ_ACCESS_KEY_ID = "jwsutdemteo7a3odjeweckixb5oa";
const STORJ_SECRET_ACCESS_KEY = "j3h3b4tvphprkdmfy7ntxw5el4wk46i6xhifxl573zuuogvfjorms";
const STORJ_BUCKET_NAME = "my-chat-uploads";

// تهيئة Storj DCS S3 Client
const s3Client = new S3Client({
    endpoint: STORJ_ENDPOINT,
    region: STORJ_REGION,
    credentials: {
        accessKeyId: STORJ_ACCESS_KEY_ID,
        secretAccessKey: STORJ_SECRET_ACCESS_KEY,
    },
});
const bucketName = STORJ_BUCKET_NAME;

// تهيئة Multer لتخزين الملفات مؤقتاً في الذاكرة
const upload = multer({ storage: multer.memoryStorage() });

// ----------------------------------------------------------------------------------------------------
// تهيئة PostgreSQL Pool
// ----------------------------------------------------------------------------------------------------
const connectionString = "postgresql://watsaligram_new_db_user:4eANGsVHChH1xByG9LRMBP8N4FGytaK0@dpg-d1gjijnfte5s738npfr0-a.singapore-postgres.render.com/watsaligram_new_db";
const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // مطلوب لـ Render PostgreSQL (إذا لم يكن لديك شهادة SSL موثوقة)
    }
});

// وظيفة لإنشاء الجداول إذا لم تكن موجودة (مع إسقاط الجداول أولاً)
async function createTables() {
    try {
        // إسقاط الجداول بترتيب عكسي للتبعيات لضمان بيئة نظيفة
        await pool.query('DROP TABLE IF EXISTS followers CASCADE;');
        await pool.query('DROP TABLE IF EXISTS messages CASCADE;');
        await pool.query('DROP TABLE IF EXISTS comments CASCADE;');
        await pool.query('DROP TABLE IF EXISTS posts CASCADE;');
        await pool.query('DROP TABLE IF EXISTS chats CASCADE;');
        await pool.query('DROP TABLE IF EXISTS users CASCADE;');
        console.log('Existing tables dropped (if any).');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url VARCHAR(255)
            );

            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(255) PRIMARY KEY,
                author_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                author_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                author_profile_bg VARCHAR(255),
                likes JSONB DEFAULT '[]'::jsonb,
                views JSONB DEFAULT '[]'::jsonb
            );

            CREATE TABLE IF NOT EXISTS comments (
                id VARCHAR(255) PRIMARY KEY,
                post_id VARCHAR(255) REFERENCES posts(id) ON DELETE CASCADE,
                user_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                text TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                user_profile_bg VARCHAR(255),
                likes JSONB DEFAULT '[]'::jsonb
            );

            CREATE TABLE IF NOT EXISTS chats (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(50) NOT NULL, -- 'private' or 'group'
                name VARCHAR(255), -- For groups
                description TEXT, -- For groups
                admin_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE, -- For groups
                participants JSONB NOT NULL, -- Array of UIDs
                member_roles JSONB, -- For groups: {uid: role}
                last_message TEXT,
                timestamp BIGINT NOT NULL,
                profile_bg_url VARCHAR(255), -- For groups
                contact_names JSONB -- For private chats: {user1Id: user2Name, user2Id: user1Name}
            );

            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                chat_id VARCHAR(255) REFERENCES chats(id) ON DELETE CASCADE,
                sender_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                sender_profile_bg VARCHAR(255)
            );

            CREATE TABLE IF NOT EXISTS followers (
                follower_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                followed_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                PRIMARY KEY (follower_id, followed_id)
            );
        `);
        console.log('Tables created successfully.');
    } catch (err) {
        console.error('ERROR: Failed to create tables:', err);
    }
}

// ----------------------------------------------------------------------------------------------------
// Middleware (البرمجيات الوسيطة)
// ----------------------------------------------------------------------------------------------------

// تمكين CORS لجميع الطلبات (Netlify Proxy سيتعامل مع الباقي)
app.use(cors());

// تحليل نصوص JSON في طلبات HTTP
app.use(bodyParser.json());

// ----------------------------------------------------------------------------------------------------
// وظائف المساعدة (Helper Functions)
// ----------------------------------------------------------------------------------------------------

// وظيفة لإنشاء معرف مستخدم فريد مكون من 8 أرقام (من قاعدة البيانات)
async function generateCustomId() {
    let id;
    let userExists = true;
    while (userExists) {
        id = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 أرقام
        const res = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [id]);
        userExists = res.rows.length > 0;
    }
    return id;
}

// ----------------------------------------------------------------------------------------------------
// نقاط نهاية API (API Endpoints) - تم تعديلها للعمل مع PostgreSQL
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية تسجيل المستخدم
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const existingUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
        }

        const uid = uuidv4(); // إنشاء معرف فريد للمستخدم
        const customId = await generateCustomId(); // إنشاء معرف مخصص من 8 أرقام

        await pool.query(
            'INSERT INTO users (uid, username, password, custom_id, profile_bg_url) VALUES ($1, $2, $3, $4, $5)',
            [uid, username, password, customId, null]
        );

        console.log('User registered:', username, 'UID:', uid, 'Custom ID:', customId);
        res.status(201).json({ message: 'تم التسجيل بنجاح.', user: { uid, username, customId, profileBg: null } });
    } catch (error) {
        console.error('ERROR: Failed to register user:', error);
        res.status(500).json({ error: 'فشل التسجيل.' });
    }
});

// نقطة نهاية تسجيل الدخول
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url, password FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || user.password !== password) { // في تطبيق حقيقي، تحقق من كلمة المرور المشفرة
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        console.log('User logged in:', user.username);
        res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url } });
    } catch (error) {
        console.error('ERROR: Failed to log in user:', error);
        res.status(500).json({ error: 'فشل تسجيل الدخول.' });
    }
});

// نقطة نهاية للحصول على معلومات المستخدم بواسطة customId
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE custom_id = $1', [customId]);
        const user = result.rows[0];
        if (user) {
            res.status(200).json({ uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
    } catch (error) {
        console.error('ERROR: Failed to get user by custom ID:', error);
        res.status(500).json({ error: 'فشل جلب معلومات المستخدم.' });
    }
});

// نقطة نهاية لرفع خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const uploadedFile = req.file;

    if (!userId || !uploadedFile) {
        return res.status(400).json({ error: 'معرف المستخدم والملف مطلوبان.' });
    }

    try {
        const userResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const fileExtension = path.extname(uploadedFile.originalname);
        const fileName = `${uuidv4()}${fileExtension}`;
        const filePath = `profile_bg/${fileName}`; // مسار التخزين في الباكت

        const params = {
            Bucket: bucketName,
            Key: filePath,
            Body: uploadedFile.buffer,
            ContentType: uploadedFile.mimetype,
        };

        await s3Client.send(new PutObjectCommand(params));
        const mediaUrl = `/api/media/${userId}/${filePath}`; // رابط الوكالة (proxy URL)

        await pool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [mediaUrl, userId]);

        console.log(`تم تحميل خلفية الملف الشخصي للمستخدم ${userId}: ${mediaUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: mediaUrl });
    } catch (error) {
        console.error('ERROR: Failed to upload profile background to Storj DCS or update DB:', error);
        res.status(500).json({ error: 'فشل تحميل الخلفية.' });
    }
});

// نقطة نهاية للحصول على عدد متابعي مستخدم معين
app.get('/api/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [userId]);
        const followerCount = parseInt(result.rows[0].count);
        res.status(200).json({ count: followerCount });
    } catch (error) {
        console.error('ERROR: Failed to get follower count:', error);
        res.status(500).json({ error: 'فشل جلب عدد المتابعين.' });
    }
});

// نقطة نهاية للحصول على حالة المتابعة بين مستخدمين
app.get('/api/user/:followerId/following/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    try {
        const result = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
        const isFollowing = result.rows.length > 0;
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error('ERROR: Failed to get following status:', error);
        res.status(500).json({ error: 'فشل جلب حالة المتابعة.' });
    }
});

// نقطة نهاية للمتابعة/إلغاء المتابعة
app.post('/api/user/:followerId/follow/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;

    if (followerId === followedId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    try {
        const followerUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followerId]);
        const followedUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followedId]);

        if (followerUserResult.rows.length === 0 || followedUserResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم (المتابع أو المتابع) غير موجود.' });
        }

        const existingFollow = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);

        let message;
        let isFollowing;
        if (existingFollow.rows.length > 0) {
            // إلغاء المتابعة
            await pool.query('DELETE FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
            message = 'تم إلغاء المتابعة.';
            isFollowing = false;
        } else {
            // متابعة
            await pool.query('INSERT INTO followers (follower_id, followed_id) VALUES ($1, $2)', [followerId, followedId]);
            message = 'تمت المتابعة بنجاح.';
            isFollowing = true;
        }
        console.log(`User ${followerId} ${message} user ${followedId}`);
        res.status(200).json({ message, isFollowing });
    } catch (error) {
        console.error('ERROR: Failed to follow/unfollow user:', error);
        res.status(500).json({ error: 'فشل في عملية المتابعة/إلغاء المتابعة.' });
    }
});

// نقطة نهاية للحصول على جهات الاتصال (المستخدمين الذين أجرى معهم المستخدم الحالي محادثات فردية)
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(`
            SELECT DISTINCT u.uid, u.username, u.custom_id, u.profile_bg_url
            FROM users u
            JOIN chats c ON (
                (c.type = 'private' AND c.participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND c.participants @> to_jsonb(ARRAY[u.uid]::VARCHAR[]) AND u.uid != $1)
            )
        `, [userId]);

        const userContacts = result.rows.map(row => ({
            uid: row.uid,
            username: row.username,
            customId: row.custom_id,
            profileBg: row.profile_bg_url
        }));

        res.status(200).json(userContacts);
    } catch (error) {
        console.error('ERROR: Failed to get user contacts:', error);
        res.status(500).json({ error: 'فشل جلب جهات الاتصال.' });
    }
});

// نقطة نهاية لنشر منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;

    let postMediaUrl = null;
    let postMediaType = mediaType || 'text';

    if (!authorId || !authorName || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'المعرف، الاسم، والنص أو ملف الوسائط مطلوب.' });
    }

    try {
        if (mediaFile) {
            const fileExtension = path.extname(mediaFile.originalname);
            const fileName = `${uuidv4()}${fileExtension}`;
            const filePath = `posts/${fileName}`;

            const params = {
                Bucket: bucketName,
                Key: filePath,
                Body: mediaFile.buffer,
                ContentType: mediaFile.mimetype,
            };

            await s3Client.send(new PutObjectCommand(params));
            postMediaUrl = `/api/media/${authorId}/${filePath}`;
            console.log(`تم تحميل ملف الوسائط للمنشور: ${postMediaUrl}`);

            if (!mediaType || mediaType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    postMediaType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    postMediaType = 'video';
                }
            }
        }

        const postId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO posts (id, author_id, author_name, text, timestamp, media_url, media_type, author_profile_bg, likes, views)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [postId, authorId, authorName, text || '', timestamp, postMediaUrl, postMediaType, authorProfileBg || null, '[]', '[]']
        );

        const newPost = {
            id: postId,
            authorId,
            authorName,
            text: text || '',
            timestamp,
            likes: [],
            comments: [], // التعليقات لا تُحفظ هنا، بل في جدول comments
            views: [],
            mediaUrl: postMediaUrl,
            mediaType: postMediaType,
            authorProfileBg: authorProfileBg || null
        };
        console.log('تم نشر منشور جديد:', newPost);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
    } catch (error) {
        console.error('ERROR: Failed to publish post:', error);
        res.status(500).json({ error: 'فشل نشر المنشور.' });
    }
});

// نقطة نهاية للحصول على جميع المنشورات
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                   (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes))
                    FROM comments c WHERE c.post_id = p.id) AS comments
            FROM posts p
            ORDER BY p.timestamp DESC
        `);

        const postsWithComments = result.rows.map(row => ({
            id: row.id,
            authorId: row.author_id,
            authorName: row.author_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            likes: row.likes, // JSONB is already an array in Node.js
            comments: row.comments || [], // Ensure it's an empty array if no comments
            views: row.views,
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            authorProfileBg: row.author_profile_bg
        }));
        res.status(200).json(postsWithComments);
    } catch (error) {
        console.error('ERROR: Failed to get all posts:', error);
        res.status(500).json({ error: 'فشل جلب المنشورات.' });
    }
});

// نقطة نهاية للحصول على منشورات المستخدمين الذين يتابعهم المستخدم الحالي
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const followedUsersResult = await pool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
        const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);

        // **تعديل: تضمين منشورات المستخدم نفسه**
        followedUsersIds.push(userId); // إضافة معرف المستخدم الحالي

        if (followedUsersIds.length === 0) {
            return res.status(200).json([]); // لا يوجد متابعون ولا منشورات للمستخدم نفسه
        }

        const result = await pool.query(`
            SELECT p.*,
                   (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes))
                    FROM comments c WHERE c.post_id = p.id) AS comments
            FROM posts p
            WHERE p.author_id = ANY($1::VARCHAR[])
            ORDER BY p.timestamp DESC
        `, [followedUsersIds]);

        const postsWithComments = result.rows.map(row => ({
            id: row.id,
            authorId: row.author_id,
            authorName: row.author_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            likes: row.likes,
            comments: row.comments || [],
            views: row.views,
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            authorProfileBg: row.author_profile_bg
        }));
        res.status(200).json(postsWithComments);
    } catch (error) {
        console.error('ERROR: Failed to get followed posts:', error);
        res.status(500).json({ error: 'فشل جلب منشورات المتابعين.' });
    }
});

// نقطة نهاية للبحث في المنشورات
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query; // q هو نص البحث
    const searchTerm = q ? `%${q.toLowerCase()}%` : ''; // استخدام % للبحث الجزئي

    let queryText = `
        SELECT p.*,
               (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes))
                FROM comments c WHERE c.post_id = p.id) AS comments
        FROM posts p
    `;
    const queryParams = [];
    let whereClause = [];

    if (filter === 'followed' && userId) {
        try {
            const followedUsersResult = await pool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
            const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);
            followedUsersIds.push(userId); // تضمين منشورات المستخدم نفسه
            if (followedUsersIds.length > 0) {
                queryParams.push(followedUsersIds);
                whereClause.push(`p.author_id = ANY($${queryParams.length}::VARCHAR[])`);
            } else {
                return res.status(200).json([]); // لا يوجد متابعون ولا منشورات للمستخدم نفسه
            }
        } catch (error) {
            console.error('ERROR: Failed to get followed users for search:', error);
            return res.status(500).json({ error: 'فشل في البحث عن منشورات المتابعين.' });
        }
    }

    if (searchTerm) {
        queryParams.push(searchTerm);
        whereClause.push(`(LOWER(p.text) LIKE $${queryParams.length} OR LOWER(p.author_name) LIKE $${queryParams.length})`);
    }

    if (whereClause.length > 0) {
        queryText += ` WHERE ${whereClause.join(' AND ')}`;
    }

    queryText += ` ORDER BY p.timestamp DESC`;

    try {
        const result = await pool.query(queryText, queryParams);
        const filteredPosts = result.rows.map(row => ({
            id: row.id,
            authorId: row.author_id,
            authorName: row.author_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            likes: row.likes,
            comments: row.comments || [],
            views: row.views,
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            authorProfileBg: row.author_profile_bg
        }));
        res.status(200).json(filteredPosts);
    } catch (error) {
        console.error('ERROR: Failed to search posts:', error);
        res.status(500).json({ error: 'فشل البحث في المنشورات.' });
    }
});

// نقطة نهاية لحذف منشور
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        const postResult = await pool.query('SELECT media_url FROM posts WHERE id = $1', [postId]);
        const deletedPost = postResult.rows[0];

        if (!deletedPost) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        // إذا كان المنشور يحتوي على وسائط، احذفها من Storj DCS
        if (deletedPost.media_url) {
            const urlParts = deletedPost.media_url.split('/');
            const filePathInBucket = urlParts.slice(4).join('/');
            const params = { Bucket: bucketName, Key: filePathInBucket };
            s3Client.send(new DeleteObjectCommand(params))
                .then(() => console.log(`تم حذف الملف من Storj DCS: ${filePathInBucket}`))
                .catch(error => console.error('ERROR: Failed to delete media from Storj DCS:', error));
        }

        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        console.log('تم حذف المنشور:', postId);
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to delete post:', error);
        res.status(500).json({ error: 'فشل حذف المنشور.' });
    }
});

// نقطة نهاية للإعجاب بمنشور
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    try {
        const postResult = await pool.query('SELECT likes FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentLikes = post.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId); // إضافة إعجاب
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1); // إزالة إعجاب
            isLiked = false;
        }

        await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);
        res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('ERROR: Failed to like post:', error);
        res.status(500).json({ error: 'فشل تحديث الإعجاب.' });
    }
});

// نقطة نهاية لزيادة عدد المشاهدات
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    try {
        const postResult = await pool.query('SELECT views FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentViews = post.views || [];

        // إضافة المشاهدة فقط إذا لم يشاهدها المستخدم من قبل
        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE id = $2', [JSON.stringify(currentViews), postId]);
        }
        res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح.', viewsCount: currentViews.length });
    } catch (error) {
        console.error('ERROR: Failed to update post views:', error);
        res.status(500).json({ error: 'فشل تحديث المشاهدات.' });
    }
});

// نقطة نهاية لإضافة تعليق على منشور
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'نص التعليق مطلوب.' });
    }

    try {
        const postResult = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const userResult = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [userId]);
        const userProfileBg = userResult.rows[0] ? userResult.rows[0].profile_bg_url : null;

        const commentId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO comments (id, post_id, user_id, username, text, timestamp, user_profile_bg, likes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [commentId, postId, userId, username, text, timestamp, userProfileBg, '[]']
        );

        const newComment = {
            id: commentId,
            userId,
            username,
            text,
            timestamp,
            likes: [],
            userProfileBg: userProfileBg
        };
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', comment: newComment });
    } catch (error) {
        console.error('ERROR: Failed to add comment:', error);
        res.status(500).json({ error: 'فشل إضافة التعليق.' });
    }
});

// نقطة نهاية للحصول على تعليقات منشور
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY timestamp ASC', [postId]);
        const comments = result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            username: row.username,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            userProfileBg: row.user_profile_bg,
            likes: row.likes // JSONB is already an array in Node.js
        }));
        res.status(200).json(comments);
    } catch (error) {
        console.error('ERROR: Failed to get comments:', error);
        res.status(500).json({ error: 'فشل جلب التعليقات.' });
    }
});

// نقطة نهاية للإعجاب بتعليق
app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;

    try {
        const commentResult = await pool.query('SELECT likes FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        let currentLikes = comment.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId); // إضافة إعجاب
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1); // إزالة إعجاب
            isLiked = false;
        }

        await pool.query('UPDATE comments SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), commentId]);
        res.status(200).json({ message: 'تم تحديث الإعجاب بالتعليق بنجاح.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('ERROR: Failed to like comment:', error);
        res.status(500).json({ error: 'فشل تحديث الإعجاب بالتعليق.' });
    }
});

// نقطة نهاية خدمة ملفات الوسائط (الصور والفيديوهات)
app.get('/api/media/:userId/:folder/:fileName', async (req, res) => {
    const { userId, folder, fileName } = req.params;
    const filePathInBucket = `${folder}/${fileName}`;

    console.log(`DEBUG: طلب ملف وسائط: ${filePathInBucket} للمستخدم: ${userId}`);

    const params = {
        Bucket: bucketName,
        Key: filePathInBucket,
    };

    try {
        const data = await s3Client.send(new GetObjectCommand(params));
        if (!data.Body) {
            console.error(`ERROR: لا يوجد جسم للبيانات للملف: ${filePathInBucket}`);
            return res.status(404).send('الملف غير موجود أو فارغ.');
        }

        res.setHeader('Content-Type', data.ContentType || 'application/octet-stream');
        if (data.ContentLength) {
            res.setHeader('Content-Length', data.ContentLength);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000');

        data.Body.pipe(res);

        console.log(`DEBUG: تم خدمة الملف بنجاح: ${filePathInBucket}`);

    } catch (error) {
        console.error(`ERROR: فشل خدمة ملف الوسائط ${filePathInBucket} من Storj DCS:`, error);
        if (error.Code === 'NoSuchKey') {
            return res.status(404).send('الملف غير موجود.');
        }
        res.status(500).send('فشل في خدمة الملف.');
    }
});

// ----------------------------------------------------------------------------------------------------
// وظائف الدردشة (Chat Functions) - تم تعديلها للعمل مع PostgreSQL
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء محادثة فردية
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    try {
        // تحقق مما إذا كانت المحادثة موجودة بالفعل
        const existingChatResult = await pool.query(`
            SELECT id FROM chats
            WHERE type = 'private'
            AND (participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[]))
        `, [user1Id, user2Id]);

        if (existingChatResult.rows.length > 0) {
            const existingChatId = existingChatResult.rows[0].id;
            console.log('محادثة فردية موجودة بالفعل:', existingChatId);
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChatId });
        }

        const newChatId = uuidv4();
        const timestamp = Date.now();
        const participantsArray = [user1Id, user2Id];
        const contactNamesObject = {
            [user1Id]: contactName,
            [user2Id]: user1Name
        };

        await pool.query(
            `INSERT INTO chats (id, type, participants, last_message, timestamp, contact_names)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [newChatId, 'private', JSON.stringify(participantsArray), null, timestamp, JSON.stringify(contactNamesObject)]
        );

        console.log('تم إنشاء محادثة فردية جديدة:', newChatId);
        res.status(201).json({ message: 'تم إنشاء المحادثة.', chatId: newChatId });
    } catch (error) {
        console.error('ERROR: Failed to create private chat:', error);
        res.status(500).json({ error: 'فشل إنشاء المحادثة.' });
    }
});

// نقطة نهاية لتعديل اسم جهة الاتصال في محادثة فردية
app.put('/api/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    try {
        const chatResult = await pool.query('SELECT contact_names FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية التعديل.' });
        }

        let currentContactNames = chat.contact_names || {};
        currentContactNames[userId] = newContactName;

        await pool.query('UPDATE chats SET contact_names = $1 WHERE id = $2', [JSON.stringify(currentContactNames), chatId]);
        console.log(`تم تحديث اسم جهة الاتصال للمحادثة ${chatId} بواسطة ${userId} إلى ${newContactName}`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to update contact name:', error);
        res.status(500).json({ error: 'فشل تحديث اسم جهة الاتصال.' });
    }
});

// نقطة نهاية للحصول على جميع المحادثات لمستخدم معين
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(`
            SELECT id, type, name, last_message, timestamp, profile_bg_url, admin_id, contact_names, participants
            FROM chats
            WHERE participants @> to_jsonb(ARRAY[$1]::VARCHAR[])
            ORDER BY timestamp DESC
        `, [userId]);

        const userChats = [];
        for (const row of result.rows) {
            let chatName = '';
            let chatCustomId = null;
            let chatProfileBg = null;
            let chatAdminId = null;

            if (row.type === 'private') {
                chatName = row.contact_names ? row.contact_names[userId] : 'Unknown Contact';
                const otherParticipantId = row.participants.find(pId => pId !== userId);
                if (otherParticipantId) {
                    const otherUserResult = await pool.query('SELECT custom_id, profile_bg_url FROM users WHERE uid = $1', [otherParticipantId]);
                    const otherUser = otherUserResult.rows[0];
                    if (otherUser) {
                        chatCustomId = otherUser.custom_id;
                        chatProfileBg = otherUser.profile_bg_url;
                    }
                }
            } else if (row.type === 'group') {
                chatName = row.name;
                chatProfileBg = row.profile_bg_url;
                chatAdminId = row.admin_id;
            }

            userChats.push({
                id: row.id,
                type: row.type,
                name: chatName,
                lastMessage: row.last_message,
                timestamp: parseInt(row.timestamp),
                customId: chatCustomId,
                profileBg: chatProfileBg,
                adminId: chatAdminId
            });
        }

        res.status(200).json(userChats);
    } catch (error) {
        console.error('ERROR: Failed to get user chats:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات.' });
    }
});

// نقطة نهاية لإرسال رسالة في محادثة
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;

    let messageMediaUrl = null;
    let messageMediaType = mediaType || 'text';

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }
        if (!chat.participants.includes(senderId)) {
            return res.status(403).json({ error: 'المستخدم ليس عضواً في هذه المحادثة.' });
        }

        if (mediaFile) {
            const fileExtension = path.extname(mediaFile.originalname);
            const fileName = `${uuidv4()}${fileExtension}`;
            const filePath = `chat_media/${fileName}`;

            const params = {
                Bucket: bucketName,
                Key: filePath,
                Body: mediaFile.buffer,
                ContentType: mediaFile.mimetype,
            };

            await s3Client.send(new PutObjectCommand(params));
            messageMediaUrl = `/api/media/${senderId}/${filePath}`;
            console.log(`تم تحميل ملف الوسائط للرسالة: ${messageMediaUrl}`);

            if (!mediaType || mediaType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    messageMediaType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    messageMediaType = 'video';
                }
            }
        }

        const messageId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_url, media_type, sender_profile_bg)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [messageId, chatId, senderId, senderName, text || '', timestamp, messageMediaUrl, messageMediaType, senderProfileBg || null]
        );

        const lastMessageText = messageMediaUrl ? (messageMediaType === 'image' ? 'صورة' : 'فيديو') : (text || '');
        await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [lastMessageText, timestamp, chatId]);

        const newMessage = {
            id: messageId,
            senderId,
            senderName,
            text: text || '',
            timestamp,
            mediaUrl: messageMediaUrl,
            mediaType: messageMediaType,
            senderProfileBg: senderProfileBg || null
        };

        console.log('تم إرسال رسالة جديدة في المحادثة:', chatId, newMessage);
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageData: newMessage });
    } catch (error) {
        console.error('ERROR: Failed to send message:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة.' });
    }
});

// نقطة نهاية للحصول على رسائل محادثة معينة (مع فلتر زمني)
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = parseInt(req.query.since || '0');

    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 AND timestamp > $2 ORDER BY timestamp ASC',
            [chatId, sinceTimestamp]
        );

        const messages = result.rows.map(row => ({
            id: row.id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            senderProfileBg: row.sender_profile_bg
        }));
        res.status(200).json(messages);
    } catch (error) {
        console.error('ERROR: Failed to get chat messages:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل.' });
    }
});

// نقطة نهاية لحذف محادثة لمستخدم معين (في هذا النموذج، حذف من جدول chats)
app.delete('/api/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;

    try {
        // في تطبيق حقيقي، قد لا تحذف المحادثة بالكامل، بل تزيل المستخدم من المشاركين
        // أو تضع علامة على المحادثة بأنها محذوفة لهذا المستخدم.
        // للتبسيط، سنقوم بحذف المحادثة إذا كان المستخدم هو المشارك الوحيد المتبقي.
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو المستخدم ليس عضواً فيها.' });
        }

        let updatedParticipants = chat.participants.filter(p => p !== userId);

        if (updatedParticipants.length === 0) {
            // إذا لم يتبق أي مشاركين، احذف المحادثة بالكامل
            await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
            console.log(`تم حذف المحادثة ${chatId} بالكامل لأن المستخدم ${userId} كان آخر مشارك.`);
            res.status(200).json({ message: 'تم حذف المحادثة بالكامل بنجاح.' });
        } else {
            // تحديث قائمة المشاركين
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatId]);
            console.log(`تم حذف المحادثة ${chatId} للمستخدم ${userId} فقط.`);
            res.status(200).json({ message: 'تم حذف المحادثة من عندك بنجاح.' });
        }
    } catch (error) {
        console.error('ERROR: Failed to delete chat for user:', error);
        res.status(500).json({ error: 'فشل حذف المحادثة.' });
    }
});

// نقطة نهاية لحذف محادثة فردية من الطرفين
app.delete('/api/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;

    try {
        const chatResult = await pool.query('SELECT media_url FROM messages WHERE chat_id = $1', [chatId]);
        const messagesMediaUrls = chatResult.rows.map(row => row.media_url).filter(Boolean);

        // حذف ملفات الوسائط المرتبطة بالرسائل في هذه المحادثة من Storj DCS
        for (const mediaUrl of messagesMediaUrls) {
            const urlParts = mediaUrl.split('/');
            const filePathInBucket = urlParts.slice(4).join('/');
            const params = { Bucket: bucketName, Key: filePathInBucket };
            s3Client.send(new DeleteObjectCommand(params))
                .then(() => console.log(`تم حذف ملف الوسائط من Storj DCS: ${filePathInBucket}`))
                .catch(error => console.error('ERROR: Failed to delete message media from Storj DCS:', error));
        }

        // حذف جميع الرسائل المتعلقة بالمحادثة
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        // حذف المحادثة نفسها
        await pool.query('DELETE FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, callerUid]);

        console.log(`تم حذف المحادثة الفردية ${chatId} من الطرفين بواسطة ${callerUid}.`);
        res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to delete private chat for both:', error);
        res.status(500).json({ error: 'فشل حذف المحادثة من الطرفين.' });
    }
});

// ----------------------------------------------------------------------------------------------------
// وظائف المجموعة (Group Functions) - تم تعديلها للعمل مع PostgreSQL
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body; // members هو كائن {uid: role}

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، معرف المشرف، وعضوان على الأقل مطلوبان.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
        return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً.' });
    }

    try {
        const newGroupId = uuidv4();
        const timestamp = Date.now();
        const participantsArray = Object.keys(members);

        await pool.query(
            `INSERT INTO chats (id, type, name, description, admin_id, participants, member_roles, last_message, timestamp, profile_bg_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [newGroupId, 'group', name, description || '', adminId, JSON.stringify(participantsArray), JSON.stringify(members), null, timestamp, null]
        );

        console.log('تم إنشاء مجموعة جديدة:', newGroupId);
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroupId });
    } catch (error) {
        console.error('ERROR: Failed to create group:', error);
        res.status(500).json({ error: 'فشل إنشاء المجموعة.' });
    }
});

// نقطة نهاية لتغيير اسم المجموعة
app.put('/api/groups/:groupId/name', async (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير اسم المجموعة.' });
        }

        await pool.query('UPDATE chats SET name = $1 WHERE id = $2', [newName, groupId]);
        console.log(`تم تغيير اسم المجموعة ${groupId} إلى ${newName}`);
        res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to change group name:', error);
        res.status(500).json({ error: 'فشل تغيير اسم المجموعة.' });
    }
});

// نقطة نهاية للحصول على أعضاء المجموعة (مع الأدوار)
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const memberUids = group.participants;
        const memberRoles = group.member_roles;

        const usersResult = await pool.query('SELECT uid, username, custom_id FROM users WHERE uid = ANY($1::VARCHAR[])', [memberUids]);
        const usersMap = new Map(usersResult.rows.map(u => [u.uid, u]));

        const membersInfo = memberUids.map(pId => {
            const user = usersMap.get(pId);
            if (user) {
                return {
                    uid: user.uid,
                    username: user.username,
                    customId: user.custom_id,
                    role: memberRoles[pId] || 'member'
                };
            }
            return null;
        }).filter(Boolean);

        res.status(200).json(membersInfo);
    } catch (error) {
        console.error('ERROR: Failed to get group members:', error);
        res.status(500).json({ error: 'فشل جلب أعضاء المجموعة.' });
    }
});

// نقطة نهاية للحصول على عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const groupResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json({ count: group.participants.length });
    } catch (error) {
        console.error('ERROR: Failed to get group members count:', error);
        res.status(500).json({ error: 'فشل جلب عدد أعضاء المجموعة.' });
    }
});

// نقطة نهاية لإضافة أعضاء إلى مجموعة موجودة
app.post('/api/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية إضافة أعضاء إلى هذه المجموعة.' });
        }

        let currentParticipants = group.participants;
        let currentMemberRoles = group.member_roles;
        const addedMembers = [];

        for (const uid of newMemberUids) {
            if (!currentParticipants.includes(uid)) {
                const userResult = await pool.query('SELECT username FROM users WHERE uid = $1', [uid]);
                const user = userResult.rows[0];
                if (user) {
                    currentParticipants.push(uid);
                    currentMemberRoles[uid] = 'member';
                    addedMembers.push(user.username);
                }
            }
        }

        if (addedMembers.length > 0) {
            await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(currentParticipants), JSON.stringify(currentMemberRoles), groupId]);
            console.log(`تم إضافة أعضاء جدد إلى المجموعة ${groupId}: ${addedMembers.join(', ')}`);
            res.status(200).json({ message: `تم إضافة ${addedMembers.length} أعضاء بنجاح: ${addedMembers.join(', ')}` });
        } else {
            res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
        }
    } catch (error) {
        console.error('ERROR: Failed to add members to group:', error);
        res.status(500).json({ error: 'فشل إضافة أعضاء إلى المجموعة.' });
    }
});

// نقطة نهاية لتغيير دور عضو في المجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير أدوار الأعضاء.' });
        }

        if (memberUid === group.admin_id && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير دور مالك المجموعة.' });
        }

        if (group.member_roles[memberUid] === 'admin' && newRole === 'member' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر من الإشراف.' });
        }

        if (!group.participants.includes(memberUid)) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        let updatedMemberRoles = group.member_roles;
        updatedMemberRoles[memberUid] = newRole;

        await pool.query('UPDATE chats SET member_roles = $1 WHERE id = $2', [JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تم تغيير دور العضو بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to change member role:', error);
        res.status(500).json({ error: 'فشل تغيير دور العضو.' });
    }
});

// نقطة نهاية لإزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة أعضاء من هذه المجموعة.' });
        }

        if (memberUid === group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
        }

        if (group.member_roles[memberUid] === 'admin' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر.' });
        }

        const memberIndex = group.participants.indexOf(memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        let updatedParticipants = group.participants.filter(id => id !== memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تم إزالة العضو بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to remove member from group:', error);
        res.status(500).json({ error: 'فشل إزالة العضو.' });
    }
});

// نقطة نهاية لمغادرة المجموعة
app.delete('/api/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const memberIndex = group.participants.indexOf(memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
        }

        if (memberUid === group.admin_id) {
            if (group.participants.length > 1) {
                 return res.status(403).json({ error: 'لا يمكنك مغادرة المجموعة بصفتك المالك. يرجى تعيين مالك جديد أولاً.' });
            } else {
                await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                console.log(`تم حذف المجموعة ${groupId} لأن المالك غادر وكان العضو الوحيد.`);
                return res.status(200).json({ message: 'تم حذف المجموعة بنجاح بعد مغادرتك.' });
            }
        }

        let updatedParticipants = group.participants.filter(id => id !== memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تمت مغادرة المجموعة بنجاح.' });
    } catch (error) {
        console.error('ERROR: Failed to leave group:', error);
        res.status(500).json({ error: 'فشل مغادرة المجموعة.' });
    }
});


// بدء تشغيل الخادم
app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Backend URL: http://localhost:${port}`);
    console.log('Storj DCS Keys are directly in code. For production, consider environment variables.');
    await createTables(); // استدعاء لإنشاء الجداول عند بدء التشغيل
});
