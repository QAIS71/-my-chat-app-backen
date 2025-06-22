// استيراد المكتبات الضرورية
const express = require('express'); // إطار عمل لإنشاء تطبيقات الويب
const { Pool } = require('pg'); // مكتبة للتعامل مع قاعدة بيانات PostgreSQL
const bcrypt = require('bcrypt'); // لتشفير كلمات المرور
const cors = require('cors'); // للسماح بطلبات من نطاقات مختلفة (مهم للواجهة الأمامية)
const { v4: uuidv4 } = require('uuid'); // لتوليد معرفات فريدة عالمياً
const multer = require('multer'); // للتعامل مع رفع الملفات (الصور والفيديوهات)
require('dotenv').config(); // لتحميل متغيرات البيئة من ملف .env (إذا كنت تعمل محلياً)

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000; // استخدام المنفذ الذي يوفره Render أو 3000 محلياً

// تهيئة PostgreSQL Pool للاتصال بقاعدة البيانات
// DATABASE_URL يجب أن يتم تعيينه كمتغير بيئة في Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // ضروري لـ Render (يسمح بالاتصال عبر SSL)
    }
});

// رسائل DEBUG لتأكيد قراءة متغيرات البيئة
console.log(`DEBUG: process.env.PORT = ${process.env.PORT}`);
console.log(`DEBUG: process.env.DATABASE_URL = ${process.env.DATABASE_URL ? 'تم تحميل الرابط' : 'غير محمل'}`);
console.log(`DEBUG: Backend starting with DATABASE_URL: ${process.env.DATABASE_URL}`);

// إنشاء جداول قاعدة البيانات عند بدء التشغيل (إذا لم تكن موجودة)
async function createTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url TEXT DEFAULT NULL,
                user_chats JSONB DEFAULT '[]'::jsonb -- قائمة بمعرفات المحادثات الخاصة بالمستخدم مع أسماء جهات الاتصال
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(255) PRIMARY KEY,
                author_id VARCHAR(255) NOT NULL,
                author_name VARCHAR(255) NOT NULL,
                text TEXT,
                media_url TEXT,
                media_type VARCHAR(50),
                timestamp BIGINT NOT NULL,
                likes JSONB DEFAULT '[]'::jsonb, -- مصفوفة من user_uid الذين أعجبوا بالمنشور
                views JSONB DEFAULT '[]'::jsonb,  -- مصفوفة من user_uid الذين شاهدوا المنشور
                comments JSONB DEFAULT '[]'::jsonb, -- مصفوفة من الكائنات {user, text, timestamp}
                author_profile_bg TEXT
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS followers (
                follower_id VARCHAR(255) NOT NULL,
                followed_id VARCHAR(255) NOT NULL,
                PRIMARY KEY (follower_id, followed_id)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(50) NOT NULL, -- 'private' or 'group'
                name VARCHAR(255) NOT NULL, -- اسم المجموعة أو اسم الشريك للمحادثة الخاصة
                description TEXT, -- لوصف المجموعة
                created_at BIGINT NOT NULL,
                last_message_at BIGINT,
                members JSONB DEFAULT '[]'::jsonb, -- للمحادثات الخاصة: [user1_uid, user2_uid] / للمجموعات: [{uid, role, customId, username}]
                profile_bg_url TEXT -- لخلفية صورة المحادثة (خاصة للمجموعات)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                chat_id VARCHAR(255) NOT NULL,
                sender_id VARCHAR(255) NOT NULL,
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                media_url TEXT,
                media_type VARCHAR(50),
                timestamp BIGINT NOT NULL,
                sender_profile_bg TEXT
            );
        `);
        console.log('DEBUG: Database tables checked/created successfully.');
    } catch (err) {
        console.error('ERROR: Error creating database tables:', err);
    }
}

// استدعاء دالة إنشاء الجداول عند بدء تشغيل الخادم
createTables();

// Middleware
app.use(cors()); // تفعيل CORS للسماح بطلبات من الواجهة الأمامية
app.use(express.json()); // تحليل نصوص JSON في جسم الطلبات
app.use(express.urlencoded({ extended: true })); // تحليل البيانات المرسلة من النماذج (form-urlencoded)

// تهيئة Multer لرفع الملفات مؤقتاً
const upload = multer({ dest: 'uploads/' }); // حفظ الملفات في مجلد 'uploads' مؤقتاً

// ----------------------------------------------------
// وظائف المساعدة (Helper Functions)
// ----------------------------------------------------

// وظيفة لتوليد معرف عشوائي فريد مكون من 8 أرقام
async function generateUniqueCustomId() {
    let customId;
    let isUnique = false;
    while (!isUnique) {
        customId = Math.floor(10000000 + Math.random() * 90000000).toString(); // توليد رقم 8 خانات
        const result = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [customId]);
        if (result.rows.length === 0) {
            isUnique = true;
        }
    }
    return customId;
}

// ----------------------------------------------------
// نقاط نهاية الـ API (API Endpoints)
// ----------------------------------------------------

// نقطة نهاية للتحقق من أن الخادم يعمل
app.get('/', (req, res) => {
    res.send('Backend is running!');
});

// -------------------- المستخدمون (Users) --------------------

// التسجيل (Register)
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

        const passwordHash = await bcrypt.hash(password, 10); // تشفير كلمة المرور
        const uid = uuidv4(); // توليد معرف فريد للمستخدم
        const customId = await generateUniqueCustomId(); // توليد معرف مخصص 8 أرقام

        await pool.query(
            'INSERT INTO users (uid, username, password_hash, custom_id, user_chats) VALUES ($1, $2, $3, $4, $5)',
            [uid, username, passwordHash, customId, '[]']
        );
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح!', uid, customId });
    } catch (err) {
        console.error('ERROR: Register error:', err);
        res.status(500).json({ error: 'فشل في إنشاء المستخدم.' });
    }
});

// تسجيل الدخول (Login)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        // إرجاع بيانات المستخدم للواجهة الأمامية
        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح!',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_bg_url // إرجاع رابط خلفية الملف الشخصي
            }
        });
    } catch (err) {
        console.error('ERROR: Login error:', err);
        res.status(500).json({ error: 'فشل في تسجيل الدخول.' });
    }
});

// الحصول على بيانات المستخدم بواسطة customId (للبحث عن المستخدمين لبدء محادثة)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE custom_id = $1', [customId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'لم يتم العثور على مستخدم بهذا المعرف.' });
        }
        res.status(200).json(user);
    } catch (err) {
        console.error('ERROR: Get user by custom ID error:', err);
        res.status(500).json({ error: 'فشل في جلب بيانات المستخدم.' });
    }
});

// نقطة نهاية لجلب خلفية ملف المستخدم الشخصي (إذا لم يتم تحميلها مع بيانات المستخدم الأصلية)
app.get('/api/user/:uid/profile-background', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [uid]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ url: user.profile_bg_url });
    } catch (err) {
        console.error('ERROR: Get profile background error:', err);
        res.status(500).json({ error: 'فشل في جلب خلفية الملف الشخصي.' });
    }
});

// رفع خلفية الملف الشخصي (سيتم استخدام رابط بديل)
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    try {
        // بما أن NFT.Storage معطل، سنرجع رابط صورة بديلة
        const placeholderUrl = `https://placehold.co/150x150/00796b/ffffff?text=Profile+BG`; // رابط صورة بديلة
        console.log(`DEBUG: NFT.Storage disabled. Returning placeholder URL: ${placeholderUrl}`);

        await pool.query(
            'UPDATE users SET profile_bg_url = $1 WHERE uid = $2',
            [placeholderUrl, userId]
        );
        res.status(200).json({ message: 'تم تحديث خلفية الملف الشخصي (صورة بديلة).', url: placeholderUrl });
    } catch (err) {
        console.error('ERROR: Upload profile background error:', err);
        res.status(500).json({ error: 'فشل في تحديث خلفية الملف الشخصي.' });
    }
});

// المتابعة/إلغاء المتابعة
app.post('/api/user/:followerId/follow/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    if (followerId === followedId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // بدء عملية قاعدة بيانات

        const checkFollow = await client.query(
            'SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2',
            [followerId, followedId]
        );

        let message;
        let isFollowing;

        if (checkFollow.rows.length > 0) {
            // موجود -> إلغاء المتابعة
            await client.query(
                'DELETE FROM followers WHERE follower_id = $1 AND followed_id = $2',
                [followerId, followedId]
            );
            message = 'تم إلغاء المتابعة بنجاح.';
            isFollowing = false;
        } else {
            // غير موجود -> متابعة
            await client.query(
                'INSERT INTO followers (follower_id, followed_id) VALUES ($1, $2)',
                [followerId, followedId]
            );
            message = 'تمت المتابعة بنجاح.';
            isFollowing = true;
        }

        await client.query('COMMIT'); // تأكيد العملية
        res.status(200).json({ message, isFollowing });
    } catch (err) {
        await client.query('ROLLBACK'); // التراجع عن العملية في حالة الخطأ
        console.error('ERROR: Follow/unfollow error:', err);
        res.status(500).json({ error: 'فشل في عملية المتابعة.' });
    } finally {
        client.release();
    }
});

// جلب عدد متابعي مستخدم معين
app.get('/api/user/:uid/followers/count', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [uid]);
        const count = parseInt(result.rows[0].count, 10);
        res.status(200).json({ count });
    } catch (err) {
        console.error('ERROR: Get follower count error:', err);
        res.status(500).json({ error: 'فشل في جلب عدد المتابعين.' });
    }
});

// جلب قائمة جهات الاتصال للمستخدم (المستخدمين الذين لديهم محادثات معهم)
app.get('/api/user/:uid/contacts', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT user_chats FROM users WHERE uid = $1', [uid]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        // user_chats هو JSONB، قد يكون مخزناً كـ [] إذا لم تكن هناك محادثات
        const contacts = user.user_chats || [];
        res.status(200).json(contacts);
    } catch (err) {
        console.error('ERROR: Get user contacts error:', err);
        res.status(500).json({ error: 'فشل في جلب جهات الاتصال.' });
    }
});

// -------------------- المنشورات (Posts) --------------------

// إنشاء منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;

    if (!authorId || !authorName || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'البيانات المطلوبة للمنشور غير مكتملة.' });
    }

    try {
        const postId = uuidv4();
        const timestamp = Date.now();
        let mediaUrl = null;

        if (mediaFile) {
            // كما ذكرنا، NFT.Storage معطل. نرجع رابط بديل ونحذف الملف المؤقت.
            mediaUrl = `https://placehold.co/600x400/00796b/ffffff?text=${mediaType === 'image' ? 'Image' : 'Video'}+Placeholder`;
            // حذف الملف المؤقت بعد "رفعه" (ليس رفعاً حقيقياً)
            // if (fs.existsSync(mediaFile.path)) {
            //     fs.unlinkSync(mediaFile.path);
            // }
            console.log(`DEBUG: NFT.Storage disabled. Using placeholder for media: ${mediaUrl}`);
        }

        await pool.query(
            'INSERT INTO posts (id, author_id, author_name, text, media_url, media_type, timestamp, author_profile_bg, likes, views, comments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [postId, authorId, authorName, text, mediaUrl, mediaType, timestamp, authorProfileBg, '[]', '[]', '[]']
        );
        res.status(201).json({ message: 'تم إنشاء المنشور بنجاح!', postId });
    } catch (err) {
        console.error('ERROR: Create post error:', err);
        res.status(500).json({ error: 'فشل في إنشاء المنشور.' });
    }
});

// جلب جميع المنشورات (مع عدد المتابعين للمؤلف)
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE(
                    (SELECT jsonb_agg(f.follower_id) FROM followers f WHERE f.followed_id = p.author_id),
                    '[]'::jsonb
                ) as followers_list
            FROM posts p
            ORDER BY p.timestamp DESC;
        `);

        const posts = result.rows.map(row => {
            // حساب عدد المتابعين من قائمة المتابعين (followers_list)
            const followerCount = row.followers_list ? row.followers_list.length : 0;
            return {
                id: row.id,
                authorId: row.author_id,
                authorName: row.author_name,
                text: row.text,
                mediaUrl: row.media_url,
                mediaType: row.media_type,
                timestamp: parseInt(row.timestamp),
                likes: row.likes || [],
                views: row.views || [],
                comments: row.comments || [],
                authorProfileBg: row.author_profile_bg,
                followerCount: followerCount // إضافة عدد المتابعين
            };
        });
        res.status(200).json(posts);
    } catch (err) {
        console.error('ERROR: Get all posts error:', err);
        res.status(500).json({ error: 'فشل في جلب المنشورات.' });
    }
});

// جلب منشورات المستخدمين الذين تتم متابعتهم
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE(
                    (SELECT jsonb_agg(f.follower_id) FROM followers f WHERE f.followed_id = p.author_id),
                    '[]'::jsonb
                ) as followers_list
            FROM posts p
            JOIN followers f ON p.author_id = f.followed_id
            WHERE f.follower_id = $1
            ORDER BY p.timestamp DESC;
        `, [userId]);

        const posts = result.rows.map(row => {
            const followerCount = row.followers_list ? row.followers_list.length : 0;
            return {
                id: row.id,
                authorId: row.author_id,
                authorName: row.author_name,
                text: row.text,
                mediaUrl: row.media_url,
                mediaType: row.media_type,
                timestamp: parseInt(row.timestamp),
                likes: row.likes || [],
                views: row.views || [],
                comments: row.comments || [],
                authorProfileBg: row.author_profile_bg,
                followerCount: followerCount
            };
        });
        res.status(200).json(posts);
    } catch (err) {
        console.error('ERROR: Get followed posts error:', err);
        res.status(500).json({ error: 'فشل في جلب منشورات المتابعين.' });
    }
});

// البحث في المنشورات (جديد)
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query; // q: query, filter: 'all' or 'followed'
    const searchTerm = `%${q.toLowerCase()}%`;

    let queryText;
    let queryParams;

    if (filter === 'followed' && userId) {
        queryText = `
            SELECT 
                p.*,
                COALESCE(
                    (SELECT jsonb_agg(f.follower_id) FROM followers f WHERE f.followed_id = p.author_id),
                    '[]'::jsonb
                ) as followers_list
            FROM posts p
            JOIN followers f ON p.author_id = f.followed_id
            WHERE f.follower_id = $1 AND LOWER(p.text) LIKE $2
            ORDER BY p.timestamp DESC;
        `;
        queryParams = [userId, searchTerm];
    } else {
        queryText = `
            SELECT 
                p.*,
                COALESCE(
                    (SELECT jsonb_agg(f.follower_id) FROM followers f WHERE f.followed_id = p.author_id),
                    '[]'::jsonb
                ) as followers_list
            FROM posts p
            WHERE LOWER(p.text) LIKE $1
            ORDER BY p.timestamp DESC;
        `;
        queryParams = [searchTerm];
    }

    try {
        const result = await pool.query(queryText, queryParams);
        const posts = result.rows.map(row => {
            const followerCount = row.followers_list ? row.followers_list.length : 0;
            return {
                id: row.id,
                authorId: row.author_id,
                authorName: row.author_name,
                text: row.text,
                mediaUrl: row.media_url,
                mediaType: row.media_type,
                timestamp: parseInt(row.timestamp),
                likes: row.likes || [],
                views: row.views || [],
                comments: row.comments || [],
                authorProfileBg: row.author_profile_bg,
                followerCount: followerCount
            };
        });
        res.status(200).json(posts);
    } catch (err) {
        console.error('ERROR: Search posts error:', err);
        res.status(500).json({ error: 'فشل في البحث عن المنشورات.' });
    }
});


// الإعجاب / إلغاء الإعجاب بمنشور
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT likes FROM posts WHERE id = $1 FOR UPDATE', [postId]);
        const post = result.rows[0];

        if (!post) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentLikes = post.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex > -1) {
            // المستخدم أعجب بالفعل -> إلغاء الإعجاب
            currentLikes.splice(userIndex, 1);
            isLiked = false;
        } else {
            // المستخدم لم يعجب بعد -> إضافة إعجاب
            currentLikes.push(userId);
            isLiked = true;
        }

        await client.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', likesCount: currentLikes.length, isLiked });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Toggle like error:', err);
        res.status(500).json({ error: 'فشل في تحديث الإعجاب.' });
    } finally {
        client.release();
    }
});

// زيادة عدد المشاهدات لمنشور
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body; // معرف المستخدم الذي شاهد المنشور
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT views FROM posts WHERE id = $1 FOR UPDATE', [postId]);
        const post = result.rows[0];

        if (!post) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentViews = post.views || [];
        // إضافة المستخدم فقط إذا لم يشاهد المنشور من قبل (في هذه الجلسة/التخزين المؤقت)
        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            await client.query('UPDATE posts SET views = $1 WHERE id = $2', [JSON.stringify(currentViews), postId]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح.', viewsCount: currentViews.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Increment view count error:', err);
        res.status(500).json({ error: 'فشل في تحديث المشاهدات.' });
    } finally {
        client.release();
    }
});

// إضافة تعليق لمنشور
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'معرف المستخدم، اسم المستخدم، والنص مطلوبان للتعليق.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT comments FROM posts WHERE id = $1 FOR UPDATE', [postId]);
        const post = result.rows[0];

        if (!post) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentComments = post.comments || [];
        const newComment = {
            id: uuidv4(), // معرف فريد للتعليق
            user: username,
            text: text,
            timestamp: Date.now(),
            userId: userId // تخزين UID للمستخدم
        };
        currentComments.push(newComment);

        await client.query('UPDATE posts SET comments = $1 WHERE id = $2', [JSON.stringify(currentComments), postId]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', newComment });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Add comment error:', err);
        res.status(500).json({ error: 'فشل في إضافة التعليق.' });
    } finally {
        client.release();
    }
});

// جلب تعليقات منشور
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const result = await pool.query('SELECT comments FROM posts WHERE id = $1', [postId]);
        const post = result.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        res.status(200).json(post.comments || []);
    } catch (err) {
        console.error('ERROR: Get comments error:', err);
        res.status(500).json({ error: 'فشل في جلب التعليقات.' });
    }
});

// حذف منشور
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        // يمكن إضافة منطق للتحقق من أن المستخدم لديه صلاحية الحذف (مثلاً، هو مؤلف المنشور)
        const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [postId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    } catch (err) {
        console.error('ERROR: Delete post error:', err);
        res.status(500).json({ error: 'فشل في حذف المنشور.' });
    }
});

// -------------------- المحادثات (Chats) --------------------

// إنشاء محادثة خاصة جديدة أو جلبها إذا كانت موجودة (تم تعديله بعناية لحل المشكلة)
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    // رسائل تصحيح الأخطاء (DEBUG) في الخلفية
    console.log(`DEBUG_BACKEND: received private chat request: user1Id=${user1Id}, user2Id=${user2Id}, contactName=${contactName}`);

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        console.error("ERROR_BACKEND: Missing required fields for private chat creation.");
        return res.status(400).json({ error: 'جميع البيانات المطلوبة لإنشاء محادثة خاصة غير مكتملة.' });
    }
    if (user1Id === user2Id) {
        console.error("ERROR_BACKEND: Cannot create private chat with self.");
        return res.status(400).json({ error: 'لا يمكنك بدء محادثة مع نفسك.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // بدء عملية قاعدة بيانات

        // 1. التحقق مما إذا كانت المحادثة موجودة بالفعل بين هذين المستخدمين
        // نبحث عن محادثة من نوع 'private' تحتوي على UID لكل من المستخدمين
        const existingChatResult = await client.query(
            `SELECT id, members FROM chats 
             WHERE type = 'private' 
               AND jsonb_array_length(members) = 2 
               AND (members @> '[{"uid": $1}]' OR members @> '[{"uid": $2}]')
               AND (members @> '[{"uid": $1}]' AND members @> '[{"uid": $2}]')`,
            [user1Id, user2Id]
        );

        let chatId;
        let message;
        let isNewChat = false;

        if (existingChatResult.rows.length > 0) {
            chatId = existingChatResult.rows[0].id;
            message = 'المحادثة موجودة بالفعل.';
            console.log(`DEBUG_BACKEND: Existing private chat found: ${chatId}`);
        } else {
            // 2. إذا لم تكن المحادثة موجودة، نقوم بإنشاء واحدة جديدة
            chatId = uuidv4();
            const timestamp = Date.now();
            const members = [
                { uid: user1Id, username: user1Name, customId: user1CustomId, profileBg: null },
                { uid: user2Id, username: user2Name, customId: user2CustomId, profileBg: null }
            ];

            // اسم المحادثة سيحمل اسم الشريك الآخر لسهولة العرض في قائمة المحادثات
            // في الواقع، لن يتم استخدام 'name' في المحادثات الخاصة بشكل مباشر لاسم الشريك.
            // الاسم الفعلي لجهة الاتصال سيتم تخزينه في user_chats لكل مستخدم.
            await client.query(
                'INSERT INTO chats (id, type, name, created_at, last_message_at, members) VALUES ($1, $2, $3, $4, $5, $6)',
                [chatId, 'private', `${user1Name} & ${user2Name}`, timestamp, timestamp, JSON.stringify(members)]
            );
            message = 'تم إنشاء محادثة خاصة جديدة.';
            isNewChat = true;
            console.log(`DEBUG_BACKEND: New private chat created: ${chatId}`);
        }

        // 3. تحديث قائمة المحادثات في سجل المستخدمين (user_chats)
        // للمستخدم الأول (user1Id): نضيف الشريك الثاني باسم contactName
        const user1Result = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [user1Id]);
        let user1Chats = user1Result.rows[0]?.user_chats || [];
        // تأكد من عدم تكرار إضافة المحادثة لنفس جهة الاتصال
        if (!user1Chats.some(chat => chat.chatId === chatId)) {
            user1Chats.push({
                chatId: chatId,
                type: 'private',
                name: contactName, // الاسم الذي اختاره المستخدم الأول لهذه جهة الاتصال
                partnerId: user2Id,
                customId: user2CustomId,
                profileBg: members.find(m => m.uid === user2Id)?.profileBg || null // ملف خلفية شريك المحادثة
            });
            await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(user1Chats), user1Id]);
            console.log(`DEBUG_BACKEND: User1 (${user1Id}) contacts updated.`);
        }

        // للمستخدم الثاني (user2Id): نضيف الشريك الأول باسمه الحقيقي
        const user2Result = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [user2Id]);
        let user2Chats = user2Result.rows[0]?.user_chats || [];
        if (!user2Chats.some(chat => chat.chatId === chatId)) {
            user2Chats.push({
                chatId: chatId,
                type: 'private',
                name: user1Name, // اسم المستخدم الأول لجهة الاتصال الثانية
                partnerId: user1Id,
                customId: user1CustomId,
                profileBg: members.find(m => m.uid === user1Id)?.profileBg || null // ملف خلفية شريك المحادثة
            });
            await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(user2Chats), user2Id]);
            console.log(`DEBUG_BACKEND: User2 (${user2Id}) contacts updated.`);
        }

        await client.query('COMMIT'); // تأكيد العملية

        res.status(isNewChat ? 201 : 200).json({ message, chatId });
    } catch (err) {
        await client.query('ROLLBACK'); // التراجع عن العملية في حالة الخطأ
        console.error('ERROR_BACKEND: Private chat creation/retrieval error:', err);
        res.status(500).json({ error: 'فشل في إنشاء أو جلب المحادثة الخاصة: ' + err.message });
    } finally {
        client.release();
    }
});


// إنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body; // members هو كائن {uid: role}
    
    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'الاسم، المشرف، وعضوان على الأقل مطلوبان لإنشاء المجموعة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const groupId = uuidv4();
        const timestamp = Date.now();

        // جلب بيانات المستخدمين الكاملة للأعضاء بما في ذلك customId و profileBg
        const memberUids = Object.keys(members);
        const usersResult = await client.query(
            `SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = ANY($1::text[])`,
            [memberUids]
        );

        const fullMembersData = usersResult.rows.map(user => ({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_bg_url,
            role: members[user.uid] // إضافة الدور من الـ payload
        }));

        // تأكد أن المشرف ضمن الأعضاء وأن لديه دور 'admin'
        const adminInMembers = fullMembersData.find(m => m.uid === adminId);
        if (!adminInMembers || adminInMembers.role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ولديه دور المشرف.' });
        }
        
        await client.query(
            'INSERT INTO chats (id, type, name, description, created_at, last_message_at, members) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [groupId, 'group', name, description, timestamp, timestamp, JSON.stringify(fullMembersData)]
        );

        // تحديث قائمة المحادثات لجميع الأعضاء
        for (const member of fullMembersData) {
            const userResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [member.uid]);
            let userChats = userResult.rows[0]?.user_chats || [];
            if (!userChats.some(chat => chat.chatId === groupId)) {
                userChats.push({
                    chatId: groupId,
                    type: 'group',
                    name: name,
                    customId: null, // المجموعات ليس لها customId لجهة الاتصال
                    profileBg: null // المجموعات ليس لها profileBg لجهة الاتصال في قائمة الدردشات
                });
                await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(userChats), member.uid]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح!', groupId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Create group error:', err);
        res.status(500).json({ error: 'فشل في إنشاء المجموعة: ' + err.message });
    } finally {
        client.release();
    }
});


// جلب جميع المحادثات لمستخدم معين
app.get('/api/user/:uid/chats', async (req, res) => {
    const { uid } = req.params;
    try {
        // جلب قائمة المحادثات من user_chats للمستخدم
        const userResult = await pool.query('SELECT user_chats FROM users WHERE uid = $1', [uid]);
        const userChatsArray = userResult.rows[0]?.user_chats || [];

        // استخراج chatIds من userChatsArray
        const chatIds = userChatsArray.map(chat => chat.chatId);

        if (chatIds.length === 0) {
            return res.status(200).json([]); // لا توجد محادثات
        }

        // جلب تفاصيل المحادثات من جدول chats
        const chatsResult = await pool.query(
            `SELECT id, type, name, last_message_at, profile_bg_url, members FROM chats WHERE id = ANY($1::text[])`,
            [chatIds]
        );

        const detailedChats = chatsResult.rows.map(chat => {
            const userChatInfo = userChatsArray.find(uc => uc.chatId === chat.id);
            let lastMessageText = 'لا توجد رسائل بعد.';
            
            // محاولة جلب آخر رسالة من جدول الرسائل
            // هذا الجزء قد يكون مكلفاً إذا كان هناك عدد كبير جداً من الرسائل، ولكن لأغراض هذا التطبيق البسيط، سيكون مقبولاً.
            // يمكن تحسينه لاحقاً بتخزين آخر رسالة مباشرة في جدول chats
            pool.query('SELECT text, media_type FROM messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1', [chat.id])
                .then(msgResult => {
                    if (msgResult.rows.length > 0) {
                        const lastMsg = msgResult.rows[0];
                        if (lastMsg.media_type === 'image') {
                            lastMessageText = 'صورة';
                        } else if (lastMsg.media_type === 'video') {
                            lastMessageText = 'فيديو';
                        } else {
                            lastMessageText = lastMsg.text || 'رسالة نصية';
                        }
                    }
                })
                .catch(err => {
                    console.error(`ERROR: Failed to fetch last message for chat ${chat.id}:`, err);
                });

            let chatName = userChatInfo?.name || chat.name; // استخدم اسم جهة الاتصال المحفوظ إذا كان موجوداً
            let customId = userChatInfo?.customId || null;
            let profileBg = userChatInfo?.profileBg || chat.profile_bg_url || null; // خلفية المحادثة (خاصة بالمجموعات أو الشريك)

            // للمحادثات الخاصة، إذا لم يكن هناك profileBg محدد لجهة الاتصال، استخدم صورة افتراضية
            if (chat.type === 'private' && !profileBg && chat.members && chat.members.length === 2) {
                const partner = chat.members.find(member => member.uid !== uid);
                profileBg = partner?.profileBg || `https://placehold.co/50x50/cccccc/000?text=${partner?.username.charAt(0).toUpperCase() || 'P'}`;
            }

            return {
                id: chat.id,
                type: chat.type,
                name: chatName,
                customId: customId,
                lastMessage: lastMessageText,
                timestamp: chat.last_message_at ? parseInt(chat.last_message_at) : chat.created_at,
                profileBg: profileBg
            };
        });

        // يجب جلب آخر رسالة بشكل غير متزامن هنا أو الاعتماد على تحديثات لاحقة.
        // للتبسيط الآن، سنرسلها، ولكن إذا كانت هناك حاجة ماسة لآخر رسالة فورية، يجب إجراء Fetch منفصل لها بعد جلب الـ chatsResult.
        // أو الأفضل، تحديث حقل last_message_text في جدول chats عند إرسال رسالة جديدة.

        res.status(200).json(detailedChats);
    } catch (err) {
        console.error('ERROR: Get user chats error:', err);
        res.status(500).json({ error: 'فشل في جلب المحادثات.' });
    }
});


// جلب رسائل محادثة معينة
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const { since } = req.query; // جلب الرسائل الأحدث من هذا الطابع الزمني

    try {
        let queryText = 'SELECT * FROM messages WHERE chat_id = $1';
        const queryParams = [chatId];

        if (since) {
            queryText += ' AND timestamp > $2';
            queryParams.push(parseInt(since));
        }

        queryText += ' ORDER BY timestamp ASC'; // ترتيب الرسائل من الأقدم للأحدث

        const result = await pool.query(queryText, queryParams);
        const messages = result.rows.map(row => ({
            id: row.id,
            chatId: row.chat_id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            text: row.text,
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            timestamp: parseInt(row.timestamp),
            senderProfileBg: row.sender_profile_bg
        }));
        res.status(200).json(messages);
    } catch (err) {
        console.error('ERROR: Get messages error:', err);
        res.status(500).json({ error: 'فشل في جلب الرسائل.' });
    }
});

// إرسال رسالة جديدة إلى محادثة
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;

    if (!senderId || !senderName || !chatId || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'البيانات المطلوبة للرسالة غير مكتملة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const messageId = uuidv4();
        const timestamp = Date.now();
        let mediaUrl = null;

        if (mediaFile) {
            // كما ذكرنا، NFT.Storage معطل. نرجع رابط صورة بديلة ونحذف الملف المؤقت.
            mediaUrl = `https://placehold.co/600x400/00796b/ffffff?text=${mediaType === 'image' ? 'Image' : 'Video'}+Placeholder`;
            // if (fs.existsSync(mediaFile.path)) {
            //     fs.unlinkSync(mediaFile.path);
            // }
            console.log(`DEBUG: NFT.Storage disabled for message media. Using placeholder: ${mediaUrl}`);
        }

        await client.query(
            'INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_url, media_type, timestamp, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [messageId, chatId, senderId, senderName, text, mediaUrl, mediaType, timestamp, senderProfileBg]
        );

        // تحديث last_message_at في جدول chats
        await client.query(
            'UPDATE chats SET last_message_at = $1 WHERE id = $2',
            [timestamp, chatId]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', messageId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Send message error:', err);
        res.status(500).json({ error: 'فشل في إرسال الرسالة.' });
    } finally {
        client.release();
    }
});

// جلب عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT jsonb_array_length(members) as count FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = result.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json({ count: group.count });
    } catch (err) {
        console.error('ERROR: Get group members count error:', err);
        res.status(500).json({ error: 'فشل في جلب عدد أعضاء المجموعة.' });
    }
});

// جلب قائمة أعضاء المجموعة
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT members FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = result.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json(group.members || []);
    } catch (err) {
        console.error('ERROR: Get group members error:', err);
        res.status(500).json({ error: 'فشل في جلب أعضاء المجموعة.' });
    }
});

// تغيير دور عضو في المجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body; // callerUid هو معرف المستخدم الذي يقوم بالتغيير

    if (!['admin', 'member'].includes(newRole) || !callerUid) {
        return res.status(400).json({ error: 'الدور الجديد ومعرف المتصل مطلوبان.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // جلب معلومات المجموعة والأعضاء (FOR UPDATE لقفل الصف)
        const groupResult = await client.query('SELECT members FROM chats WHERE id = $1 AND type = \'group\' FOR UPDATE', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentMembers = group.members || [];

        // التحقق من صلاحيات المتصل (المتصل يجب أن يكون مشرفاً)
        const callerMember = currentMembers.find(m => m.uid === callerUid);
        if (!callerMember || callerMember.role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'لا تملك صلاحية لتغيير أدوار الأعضاء.' });
        }

        // البحث عن العضو المستهدف
        const targetMemberIndex = currentMembers.findIndex(m => m.uid === memberUid);
        if (targetMemberIndex === -1) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        const targetMember = currentMembers[targetMemberIndex];

        // منطق خاص: لا يمكن للمشرف الوحيد أن يتم إزالة إشرافه (يجب أن يبقى مشرف واحد على الأقل)
        if (targetMember.role === 'admin' && newRole === 'member') {
            const adminCount = currentMembers.filter(m => m.role === 'admin').length;
            if (adminCount === 1) { // إذا كان هو المشرف الوحيد
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكنك إزالة المشرف الوحيد من الإشراف.' });
            }
        }

        // تطبيق التغيير
        currentMembers[targetMemberIndex].role = newRole;

        await client.query('UPDATE chats SET members = $1 WHERE id = $2', [JSON.stringify(currentMembers), groupId]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم تغيير دور العضو بنجاح.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Change member role error:', err);
        res.status(500).json({ error: 'فشل في تغيير دور العضو: ' + err.message });
    } finally {
        client.release();
    }
});

// إزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body; // معرف المستخدم الذي يقوم بالإزالة

    if (!callerUid) {
        return res.status(400).json({ error: 'معرف المتصل مطلوب.' });
    }
    if (memberUid === callerUid) {
        return res.status(400).json({ error: 'لا يمكنك إزالة نفسك من المجموعة هنا، استخدم خيار المغادرة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // جلب معلومات المجموعة والأعضاء (FOR UPDATE لقفل الصف)
        const groupResult = await client.query('SELECT members FROM chats WHERE id = $1 AND type = \'group\' FOR UPDATE', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentMembers = group.members || [];

        // التحقق من صلاحيات المتصل (المتصل يجب أن يكون مشرفاً)
        const callerMember = currentMembers.find(m => m.uid === callerUid);
        if (!callerMember || callerMember.role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'لا تملك صلاحية لإزالة أعضاء.' });
        }

        // البحث عن العضو المستهدف
        const targetMemberIndex = currentMembers.findIndex(m => m.uid === memberUid);
        if (targetMemberIndex === -1) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        const targetMember = currentMembers[targetMemberIndex];

        // إذا كان العضو المستهدف مشرفاً، تحقق من أنه ليس المشرف الوحيد
        if (targetMember.role === 'admin') {
            const adminCount = currentMembers.filter(m => m.role === 'admin').length;
            if (adminCount === 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكنك إزالة المشرف الوحيد من المجموعة.' });
            }
        }

        // إزالة العضو من قائمة الأعضاء
        currentMembers.splice(targetMemberIndex, 1);

        await client.query('UPDATE chats SET members = $1 WHERE id = $2', [JSON.stringify(currentMembers), groupId]);

        // إزالة المحادثة من قائمة محادثات العضو الذي تم حذفه
        const removedUserResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [memberUid]);
        let removedUserChats = removedUserResult.rows[0]?.user_chats || [];
        const chatIndexInRemovedUser = removedUserChats.findIndex(chat => chat.chatId === groupId);
        if (chatIndexInRemovedUser !== -1) {
            removedUserChats.splice(chatIndexInRemovedUser, 1);
            await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(removedUserChats), memberUid]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم إزالة العضو بنجاح.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Remove member error:', err);
        res.status(500).json({ error: 'فشل في إزالة العضو: ' + err.message });
    } finally {
        client.release();
    }
});

// حذف محادثة أو مغادرة مجموعة
app.post('/api/chats/delete', async (req, res) => {
    const { chatId, chatType, action, userId } = req.body; // action: 'forMe', 'forBoth', 'leaveGroup'

    if (!chatId || !chatType || !action || !userId) {
        return res.status(400).json({ error: 'البيانات المطلوبة غير مكتملة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (chatType === 'private') {
            if (action === 'forMe') {
                // حذف المحادثة من قائمة محادثات المستخدم فقط
                const userResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [userId]);
                let userChats = userResult.rows[0]?.user_chats || [];
                const chatIndex = userChats.findIndex(chat => chat.chatId === chatId);
                if (chatIndex !== -1) {
                    userChats.splice(chatIndex, 1);
                    await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(userChats), userId]);
                    await client.query('COMMIT');
                    return res.status(200).json({ message: 'تم حذف المحادثة من قائمتك بنجاح.' });
                } else {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'المحادثة غير موجودة في قائمتك.' });
                }
            } else if (action === 'forBoth') {
                // حذف المحادثة من الطرفين وحذف جميع الرسائل
                const chatResult = await client.query('SELECT members FROM chats WHERE id = $1 AND type = \'private\' FOR UPDATE', [chatId]);
                const chat = chatResult.rows[0];
                if (!chat) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'المحادثة الخاصة غير موجودة.' });
                }

                // التأكد أن المتصل هو أحد طرفي المحادثة
                const membersUids = chat.members.map(m => m.uid);
                if (!membersUids.includes(userId)) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'لا تملك صلاحية لحذف هذه المحادثة من الطرفين.' });
                }

                // إزالة المحادثة من قائمة user_chats لكلا المستخدمين
                for (const memberUid of membersUids) {
                    const memberUserResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [memberUid]);
                    let memberUserChats = memberUserResult.rows[0]?.user_chats || [];
                    const memberChatIndex = memberUserChats.findIndex(chat => chat.chatId === chatId);
                    if (memberChatIndex !== -1) {
                        memberUserChats.splice(memberChatIndex, 1);
                        await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(memberUserChats), memberUid]);
                    }
                }

                // حذف جميع الرسائل من هذه المحادثة
                await client.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                // حذف سجل المحادثة نفسه
                await client.query('DELETE FROM chats WHERE id = $1', [chatId]);

                await client.query('COMMIT');
                return res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
            }
        } else if (chatType === 'group') {
            if (action === 'leaveGroup') {
                // مغادرة المجموعة (إزالة المستخدم من قائمة الأعضاء في الدردشة وإزالة الدردشة من قائمة محادثاته)
                const groupResult = await client.query('SELECT members FROM chats WHERE id = $1 AND type = \'group\' FOR UPDATE', [chatId]);
                const group = groupResult.rows[0];
                if (!group) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'المجموعة غير موجودة.' });
                }

                let currentMembers = group.members || [];
                const memberIndex = currentMembers.findIndex(m => m.uid === userId);

                if (memberIndex === -1) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
                }

                // إذا كان المستخدم هو المشرف الوحيد، لا يمكنه مغادرة المجموعة
                const leavingMember = currentMembers[memberIndex];
                if (leavingMember.role === 'admin') {
                    const adminCount = currentMembers.filter(m => m.role === 'admin').length;
                    if (adminCount === 1 && currentMembers.length > 1) { // مشرف وحيد ولسنا وحدنا في المجموعة
                        await client.query('ROLLBACK');
                        return res.status(400).json({ error: 'لا يمكنك مغادرة المجموعة لأنك المشرف الوحيد. الرجاء تعيين مشرف آخر أولاً.' });
                    }
                }

                // إزالة المستخدم من قائمة الأعضاء في المجموعة
                currentMembers.splice(memberIndex, 1);

                // إذا أصبحت المجموعة فارغة، يمكن حذفها بالكامل
                if (currentMembers.length === 0) {
                    await client.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                    await client.query('DELETE FROM chats WHERE id = $1', [chatId]);
                } else {
                    // تحديث قائمة الأعضاء في المجموعة
                    await client.query('UPDATE chats SET members = $1 WHERE id = $2', [JSON.stringify(currentMembers), chatId]);
                }

                // إزالة المحادثة من قائمة user_chats للمستخدم الذي غادر
                const userResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [userId]);
                let userChats = userResult.rows[0]?.user_chats || [];
                const chatIndexInUser = userChats.findIndex(chat => chat.chatId === chatId);
                if (chatIndexInUser !== -1) {
                    userChats.splice(chatIndexInUser, 1);
                    await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(userChats), userId]);
                }

                await client.query('COMMIT');
                return res.status(200).json({ message: 'لقد غادرت المجموعة بنجاح.' });
            } else if (action === 'forMe') {
                 // حذف المجموعة من قائمة محادثات المستخدم فقط (دون مغادرة المجموعة فعلياً)
                 // هذا الخيار قد يكون مربكاً، ولكن إذا كانت المطلوبة، فإنه يحذفها فقط من عرض المستخدم
                 const userResult = await client.query('SELECT user_chats FROM users WHERE uid = $1 FOR UPDATE', [userId]);
                 let userChats = userResult.rows[0]?.user_chats || [];
                 const chatIndex = userChats.findIndex(chat => chat.chatId === chatId);
                 if (chatIndex !== -1) {
                     userChats.splice(chatIndex, 1);
                     await client.query('UPDATE users SET user_chats = $1 WHERE uid = $2', [JSON.stringify(userChats), userId]);
                     await client.query('COMMIT');
                     return res.status(200).json({ message: 'تم حذف المجموعة من قائمتك بنجاح.' });
                 } else {
                     await client.query('ROLLBACK');
                     return res.status(404).json({ error: 'المجموعة غير موجودة في قائمتك.' });
                 }
            }
        }

        await client.query('ROLLBACK');
        res.status(400).json({ error: 'عملية حذف غير صالحة.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR: Chat deletion/leave error:', err);
        res.status(500).json({ error: 'فشل في عملية الحذف/المغادرة: ' + err.message });
    } finally {
        client.release();
    }
});


// ----------------------------------------------------
// بدء تشغيل الخادم
// ----------------------------------------------------
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Backend URL (if deployed on Render): YOUR_RENDER_SERVICE_URL_HERE`); // تذكير برابط Render
})
