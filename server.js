// استيراد المكتبات الضرورية
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // للتعامل مع نظام الملفات المؤقتة
const util = require('util'); // لاستخدام promisify
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const { Pool } = require('pg'); // مكتبة PostgreSQL

// استيراد مكتبة AWS SDK S3 (للتوافق مع Storj DCS S3 API)
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// تحويل fs.stat إلى دالة تدعم async/await
const stat = util.promisify(fs.stat);

// تهيئة تطبيق Express
const app = express();
const PORT = process.env.PORT || 3000;

// تهيئة CORS
app.use(cors());

// تحليل طلبات JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- إعداد اتصال PostgreSQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // جلب رابط قاعدة البيانات من متغيرات البيئة
    ssl: {
        rejectUnauthorized: false // مطلوب لـ Render PostgreSQL (تجنب مشاكل شهادات SSL)
    }
});

// اختبار الاتصال بقاعدة البيانات عند بدء التشغيل
pool.connect()
    .then(client => {
        console.log('INFO: Connected to PostgreSQL database successfully!');
        client.release(); // إطلاق العميل فوراً بعد الاختبار
    })
    .catch(err => {
        console.error('ERROR: Database connection failed!', err.stack);
        // في بيئة الإنتاج، قد ترغب في إنهاء التطبيق هنا إذا كان الاتصال بالقاعدة ضرورياً
        // process.exit(1); 
    });

// --- إعداد Storj DCS (متوافق مع S3 API) ---
// جلب متغيرات البيئة لـ Storj DCS
const STORJ_ENDPOINT = process.env.STORJ_ENDPOINT;
const STORJ_ACCESS_KEY_ID = process.env.STORJ_ACCESS_KEY_ID;
const STORJ_SECRET_ACCESS_KEY = process.env.STORJ_SECRET_ACCESS_KEY;
const STORJ_BUCKET_NAME = process.env.STORJ_BUCKET_NAME;

// تهيئة S3 Client للاتصال ببوابة Storj DCS
const s3Client = new S3Client({
    endpoint: STORJ_ENDPOINT,
    credentials: {
        accessKeyId: STORJ_ACCESS_KEY_ID,
        secretAccessKey: STORJ_SECRET_ACCESS_KEY,
    },
    region: 'us-east-1', // Storj DCS لا يستخدم مناطق تقليدية مثل AWS، ولكن هذه القيمة مطلوبة لمكتبة S3.
                         // يمكنك استخدام 'auto' أو أي منطقة صالحة مثل 'us-east-1'.
    forcePathStyle: true, // هام جداً لبعض الخدمات المتوافقة مع S3 مثل Storj DCS (مثل Storj)
});

// التحقق من أن متغيرات Storj DCS تم تعيينها
if (!STORJ_ENDPOINT || !STORJ_ACCESS_KEY_ID || !STORJ_SECRET_ACCESS_KEY || !STORJ_BUCKET_NAME) {
    console.error('ERROR: Storj DCS (S3-compatible) environment variables not fully set. Image/video uploads will likely fail. Please ensure STORJ_ENDPOINT, STORJ_ACCESS_KEY_ID, STORJ_SECRET_ACCESS_KEY, and STORJ_BUCKET_NAME are properly configured in Render environment variables.');
} else {
    console.log('INFO: Storj DCS (S3-compatible) client initialized and ready.');
}

// --- إعداد تخزين Multer للملفات المؤقتة قبل الرفع إلى Storj ---
// Multer سيقوم بحفظ الملفات مؤقتاً على القرص، ثم نقوم نحن برفعها إلى Storj DCS
const tempUploadsDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempUploadsDir)) {
    fs.mkdirSync(tempUploadsDir);
    console.log(`INFO: Created temporary uploads directory at ${tempUploadsDir}`);
} else {
    console.log(`INFO: Temporary uploads directory already exists at ${tempUploadsDir}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempUploadsDir); // مجلد الوجهة المؤقت لرفع الملفات
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const newFileName = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        console.log(`DEBUG: Multer generated temporary filename: ${newFileName}`);
        cb(null, newFileName);
    }
});

const upload = multer({ storage: storage });

// دالة مساعدة لتوليد معرفات مستخدم مخصصة (8 أرقام)
const generateCustomId = customAlphabet('0123456789', 8);

// --- وظائف API للمصادقة ---

// التسجيل
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const customId = generateCustomId();
        const uid = uuidv4();

        const insertQuery = `
            INSERT INTO users (uid, username, password_hash, custom_id, profile_bg_url, followers, following)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING uid, username, custom_id`;
        const newUserResult = await pool.query(insertQuery, [uid, username, passwordHash, customId, null, [], []]);
        const newUser = newUserResult.rows[0];

        console.log(`INFO: User registered: ${username}, Custom ID: ${customId}`);
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح!', user: { uid: newUser.uid, username: newUser.username, customId: newUser.custom_id } });
    } catch (error) {
        console.error('ERROR: Registration error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية التسجيل.' });
    }
});

// تسجيل الدخول
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

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }
        
        console.log(`INFO: User logged in: ${username}`);
        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح!',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_bg_url
            }
        });
    } catch (error) {
        console.error('ERROR: Login error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية تسجيل الدخول.' });
    }
});

// --- وظائف API للملفات الشخصية وخلفيات المستخدمين ---

// رفع خلفية الملف الشخصي (باستخدام Storj DCS)
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    console.log("DEBUG: Received request to upload profile background.");
    console.log("DEBUG: req.file for profile background:", req.file);

    if (!req.file) {
        console.warn("WARN: No file provided for profile background upload.");
        return res.status(400).json({ error: 'لم يتم توفير ملف.' });
    }
    const { userId } = req.body;
    if (!userId) {
        console.warn("WARN: userId missing for profile background upload.");
        fs.unlinkSync(req.file.path); // حذف الملف المؤقت
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE uid = $1', [userId]);
        const user = userResult.rows[0];

        if (!user) {
            console.warn(`WARN: User ${userId} not found for profile background upload.`);
            fs.unlinkSync(req.file.path); // حذف الملف المؤقت
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        // قراءة حجم الملف أولاً بشكل غير متزامن
        const fileStats = await stat(req.file.path);
        const fileSize = fileStats.size;
        console.log(`DEBUG: File size for profile background upload: ${fileSize}`); // DEBUG: Log file size

        // قراءة الملف المؤقت كـ Stream
        const fileStream = fs.createReadStream(req.file.path);
        const objectKey = `profile-backgrounds/${userId}/${req.file.filename}`; // المسار في Storj DCS

        // رفع الملف إلى Storj DCS
        const uploadParams = {
            Bucket: STORJ_BUCKET_NAME,
            Key: objectKey,
            Body: fileStream,
            ContentType: req.file.mimetype, // هام لكي يتم عرض الملف بشكل صحيح في المتصفح
            ContentLength: fileSize // هذا هو الإصلاح المطلوب
        };
        await s3Client.send(new PutObjectCommand(uploadParams));

        // بناء الرابط العام للملف في Storj DCS
        const fileUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${objectKey}`;
        await pool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [fileUrl, userId]);
        
        console.log(`INFO: Profile background uploaded for ${userId} to Storj DCS. URL: ${fileUrl}`);
        res.status(200).json({ message: 'تم تحديث خلفية الملف الشخصي بنجاح!', url: fileUrl });

    } catch (error) {
        console.error('ERROR: Profile background upload to Storj DCS failed!', error.stack);
        res.status(500).json({ error: 'فشل في رفع خلفية الملف الشخصي إلى Storj DCS.' });
    } finally {
        // دائماً قم بحذف الملف المؤقت بعد محاولة الرفع
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`DEBUG: Deleted temporary file: ${req.file.path}`);
        }
    }
});

// جلب خلفية الملف الشخصي للمستخدم (الرابط يأتي من DB الآن)
app.get('/api/user/:userId/profile-background', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [userId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ url: user.profile_bg_url });
    } catch (error) {
        console.error('ERROR: Get profile background error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب خلفية الملف الشخصي.' });
    }
});

// جلب عدد متابعي مستخدم معين
app.get('/api/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT followers FROM users WHERE uid = $1', [userId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ count: (user.followers || []).length });
    } catch (error) {
        console.error('ERROR: Get followers count error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب عدد المتابعين.' });
    }
});

// جلب مستخدم بواسطة المعرف المخصص (Custom ID)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE custom_id = $1', [customId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود بهذا المعرف المخصص.' });
        }
        res.status(200).json({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_bg_url
        });
    } catch (error) {
        console.error('ERROR: Get user by custom ID error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب المستخدم بواسطة المعرف المخصص.' });
    }
});

// جلب جهات الاتصال لمستخدم معين
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    try {
        const chatsResult = await pool.query(
            `SELECT id, type, participants, created_at, name, profile_bg_url, admin_id FROM chats WHERE $1 = ANY(ARRAY(SELECT (p->>'uid') FROM jsonb_array_elements(participants) p)) AND type = 'private'`,
            [userId]
        );
        const userChats = chatsResult.rows;

        const contacts = new Map();

        for (const chat of userChats) {
            const participants = chat.participants;
            const otherParticipant = participants.find(p => p.uid !== userId);

            if (otherParticipant) {
                const userResult = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [otherParticipant.uid]);
                const contactUser = userResult.rows[0];
                if (contactUser) {
                    contacts.set(contactUser.uid, {
                        uid: contactUser.uid,
                        username: contactUser.username,
                        customId: contactUser.custom_id,
                        profileBg: contactUser.profile_bg_url
                    });
                }
            }
        }
        res.status(200).json(Array.from(contacts.values()));
    } catch (error) {
        console.error('ERROR: Get user contacts error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب جهات الاتصال.' });
    }
});

// --- وظائف API للمتابعة ---

// متابعة/إلغاء متابعة مستخدم
app.post('/api/user/:followerId/follow/:followingId', async (req, res) => {
    const { followerId, followingId } = req.params; // الإصلاح: استخرج followingId هنا

    try {
        const followerResult = await pool.query('SELECT followers, following FROM users WHERE uid = $1', [followerId]);
        const follower = followerResult.rows[0];
        const followingResult = await pool.query('SELECT followers FROM users WHERE uid = $1', [followingId]);
        const following = followingResult.rows[0];

        if (!follower || !following) {
            return res.status(404).json({ error: 'المستخدم (المتابع أو المتبوع) غير موجود.' });
        }
        if (followerId === followingId) {
            return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
        }

        let followerFollowing = Array.isArray(follower.following) ? follower.following : [];
        let followingFollowers = Array.isArray(following.followers) ? following.followers : [];

        const isFollowing = followerFollowing.includes(followingId);

        if (isFollowing) {
            followerFollowing = followerFollowing.filter(id => id !== followingId);
            followingFollowers = followingFollowers.filter(id => id !== followerId);
            await pool.query('UPDATE users SET following = $1 WHERE uid = $2', [JSON.stringify(followerFollowing), followerId]);
            await pool.query('UPDATE users SET followers = $1 WHERE uid = $2', [JSON.stringify(followingFollowers), followingId]);
            res.status(200).json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing: false });
        } else {
            followerFollowing.push(followingId);
            followingFollowers.push(followerId);
            await pool.query('UPDATE users SET following = $1 WHERE uid = $2', [JSON.stringify(followerFollowing), followerId]);
            await pool.query('UPDATE users SET followers = $1 WHERE uid = $2', [JSON.stringify(followingFollowers), followingId]);
            res.status(200).json({ message: 'تمت المتابعة بنجاح.', isFollowing: true });
        }
    } catch (error) {
        console.error('ERROR: Follow/unfollow error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية المتابعة/إلغاء المتابعة.' });
    }
});

// التحقق مما إذا كان المستخدم يتابع آخر
app.get('/api/user/:followerId/following/:followingId', async (req, res) => {
    const { followerId, followingId } = req.params; // الإصلاح: استخرج followingId هنا أيضًا
    try {
        const result = await pool.query('SELECT following FROM users WHERE uid = $1', [followerId]);
        const follower = result.rows[0];
        if (!follower) {
            return res.status(404).json({ error: 'المتابع غير موجود.' });
        }
        // التحقق من أن 'following' هو مصفوفة قبل استخدام includes
        const isFollowing = (Array.isArray(follower.following) ? follower.following : []).includes(followingId);
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error('ERROR: Check following error:', error.stack);
        res.status(500).json({ error: 'فشل في التحقق من حالة المتابعة.' });
    }
});


// --- وظائف API للمنشورات ---

// نشر منشور جديد (باستخدام Storj DCS)
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;

    console.log("DEBUG: req.file for post upload:", req.file);

    if (!authorId || !authorName) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المؤلف (authorId, authorName) مطلوبة.' });
    }
    if (!text && !req.file) {
        return res.status(400).json({ error: 'المنشور لا يمكن أن يكون فارغاً (يجب أن يحتوي على نص أو وسائط).' });
    }
    
    try {
        const authorResult = await pool.query('SELECT followers FROM users WHERE uid = $1', [authorId]);
        const author = authorResult.rows[0];
        if (!author) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'المؤلف غير موجود.' });
        }

        let mediaUrl = null;
        let finalMediaType = mediaType || 'text';

        if (req.file) {
            // التحقق من متغيرات Storj قبل محاولة الرفع
            if (!STORJ_ENDPOINT || !STORJ_ACCESS_KEY_ID || !STORJ_SECRET_ACCESS_KEY || !STORJ_BUCKET_NAME) {
                throw new Error('Storj DCS environment variables not set. Cannot upload media.');
            }

            // قراءة حجم الملف أولاً بشكل غير متزامن
            const fileStats = await stat(req.file.path);
            const fileSize = fileStats.size;
            console.log(`DEBUG: File size for post media upload: ${fileSize}`); // DEBUG: Log file size

            const fileStream = fs.createReadStream(req.file.path);
            const objectKey = `posts/${authorId}/${req.file.filename}`; // المسار في Storj DCS

            const uploadParams = {
                Bucket: STORJ_BUCKET_NAME,
                Key: objectKey,
                Body: fileStream,
                ContentType: req.file.mimetype,
                ContentLength: fileSize // هذا هو الإصلاح المطلوب (موجود بالفعل)
            };
            await s3Client.send(new PutObjectCommand(uploadParams));

            mediaUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${objectKey}`;
            finalMediaType = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'unknown');
            if (finalMediaType === 'unknown') {
                // إذا كان نوع الملف غير معروف، احذفه من Storj أيضاً
                await s3Client.send(new DeleteObjectCommand({ Bucket: STORJ_BUCKET_NAME, Key: objectKey }));
                throw new Error('Unsupported media type for Storj upload.');
            }
            console.log(`DEBUG: Uploaded post media to Storj DCS. URL: ${mediaUrl}, mediaType: ${finalMediaType}`);
        } else {
            console.log("DEBUG: No media file uploaded for post.");
        }

        const newPostId = uuidv4();
        const insertQuery = `
            INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`;
        const postResult = await pool.query(insertQuery, [
            newPostId, authorId, authorName, text || '', finalMediaType,
            mediaUrl, Date.now(), [], [], [],
            authorProfileBg || null, (author.followers || []).length
        ]);
        const createdPost = postResult.rows[0];

        console.log(`INFO: New post created. Post ID: ${createdPost.id}, Media URL saved: ${createdPost.media_url || 'None'}`);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح!', post: createdPost });
    } catch (error) {
        console.error('ERROR: Post creation and Storj upload failed:', error.stack);
        res.status(500).json({ error: 'فشل في نشر المنشور أو رفع الوسائط.' });
    } finally {
        // دائماً قم بحذف الملف المؤقت بعد محاولة الرفع
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`DEBUG: Deleted temporary file: ${req.file.path}`);
        }
    }
});

// جلب جميع المنشورات (الروابط تأتي من DB الآن)
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts ORDER BY timestamp DESC');
        res.status(200).json(result.rows.map(post => ({
            id: post.id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: post.timestamp,
            likes: post.likes,
            comments: post.comments,
            views: post.views,
            authorProfileBg: post.author_profile_bg,
            followerCount: post.follower_count
        })));
    } catch (error) {
        console.error('ERROR: Get all posts error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب المنشورات.' });
    }
});

// جلب منشورات المستخدمين الذين يتابعهم مستخدم معين
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const userResult = await pool.query('SELECT following FROM users WHERE uid = $1', [userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        // التحقق من أن 'following' هو مصفوفة قبل استخدامه
        const followedUids = Array.isArray(user.following) ? user.following : [];
        if (followedUids.length === 0) {
            return res.status(200).json([]);
        }

        const postsResult = await pool.query(
            `SELECT * FROM posts WHERE author_id = ANY($1::uuid[]) ORDER BY timestamp DESC`,
            [followedUids]
        );
        res.status(200).json(postsResult.rows.map(post => ({
            id: post.id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: post.timestamp,
            likes: post.likes,
            comments: post.comments,
            views: post.views,
            authorProfileBg: post.author_profile_bg,
            followerCount: post.follower_count
        })));
    } catch (error) {
        console.error('ERROR: Get followed posts error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب منشورات المتابعين.' });
    }
});

// البحث في المنشورات
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    const searchTerm = q ? `%${q.toLowerCase()}%` : '';

    try {
        let queryText = 'SELECT * FROM posts ';
        const queryParams = [];
        let whereClauses = [];

        if (searchTerm) {
            whereClauses.push('(LOWER(text) LIKE $1 OR LOWER(author_name) LIKE $1)');
            queryParams.push(searchTerm);
        }

        if (filter === 'followed' && userId) {
            const userResult = await pool.query('SELECT following FROM users WHERE uid = $1', [userId]);
            const user = userResult.rows[0];
            if (user && (Array.isArray(user.following) ? user.following : []).length > 0) {
                const followedUids = user.following;
                whereClauses.push(`author_id = ANY($${queryParams.length + 1}::uuid[])`);
                queryParams.push(followedUids);
            } else if (user) {
                return res.status(200).json([]);
            } else {
                return res.status(404).json({ error: 'المستخدم غير موجود.' });
            }
        }

        if (whereClauses.length > 0) {
            queryText += 'WHERE ' + whereClauses.join(' AND ');
        }
        queryText += ' ORDER BY timestamp DESC';

        const result = await pool.query(queryText, queryParams);
        res.status(200).json(result.rows.map(post => ({
            id: post.id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: post.timestamp,
            likes: post.likes,
            comments: post.comments,
            views: post.views,
            authorProfileBg: post.author_profile_bg,
            followerCount: post.follower_count
        })));
    } catch (error) {
        console.error('ERROR: Search posts error:', error.stack);
        res.status(500).json({ error: 'فشل في البحث عن المنشورات.' });
    }
});


// الإعجاب بمنشور / إلغاء الإعجاب
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    try {
        const postResult = await pool.query('SELECT likes FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];
        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentLikes = Array.isArray(post.likes) ? post.likes : [];
        const hasLiked = currentLikes.includes(userId);

        if (hasLiked) {
            currentLikes = currentLikes.filter(id => id !== userId);
            await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);
            res.status(200).json({ message: 'تم إلغاء الإعجاب.', isLiked: false, likesCount: currentLikes.length });
        } else {
            currentLikes.push(userId);
            await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);
            res.status(200).json({ message: 'تم الإعجاب بالمنشور!', isLiked: true, likesCount: currentLikes.length });
        }
    } catch (error) {
        console.error('ERROR: Like/unlike post error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية الإعجاب/إلغاء الإعجاب.' });
    }
});

// إضافة تعليق على منشور
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'معرف المستخدم، اسم المستخدم، والنص مطلوبان للتعليق.' });
    }

    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];
        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const userResult = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        let currentComments = Array.isArray(post.comments) ? post.comments : [];
        const newComment = {
            id: uuidv4(),
            userId,
            username,
            text,
            timestamp: Date.now(),
            likes: [],
            userProfileBg: user.profile_bg_url
        };
        currentComments.push(newComment);

        await pool.query('UPDATE posts SET comments = $1 WHERE id = $2', [JSON.stringify(currentComments), postId]);
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح!', comment: newComment });
    } catch (error) {
        console.error('ERROR: Add comment error:', error.stack);
        res.status(500).json({ error: 'فشل في إضافة التعليق.' });
    }
});

// جلب تعليقات منشور معين
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const result = await pool.query('SELECT comments FROM posts WHERE id = $1', [postId]);
        const post = result.rows[0];
        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        res.status(200).json(post.comments || []);
    } catch (error) {
        console.error('ERROR: Get comments error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب التعليقات.' });
    }
});

// الإعجاب بتعليق / إلغاء الإعجاب
app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];
        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentComments = Array.isArray(post.comments) ? post.comments : [];
        const commentIndex = currentComments.findIndex(c => c.id === commentId);
        if (commentIndex === -1) {
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        let targetComment = currentComments[commentIndex];
        let commentLikes = Array.isArray(targetComment.likes) ? targetComment.likes : [];
        const hasLiked = commentLikes.includes(userId);

        if (hasLiked) {
            commentLikes = commentLikes.filter(id => id !== userId);
            targetComment.likes = commentLikes;
            res.status(200).json({ message: 'تم إلغاء الإعجاب بالتعليق.', isLiked: false, likesCount: commentLikes.length });
        } else {
            commentLikes.push(userId);
            targetComment.likes = commentLikes;
            res.status(200).json({ message: 'تم الإعجاب بالتعليق!', isLiked: true, likesCount: commentLikes.length });
        }

        currentComments[commentIndex] = targetComment;
        await pool.query('UPDATE posts SET comments = $1 WHERE id = $2', [JSON.stringify(currentComments), postId]);
    } catch (error) {
        console.error('ERROR: Like/unlike comment error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية الإعجاب/إلغاء الإعجاب بالتعليق.' });
    }
});

// زيادة عداد مشاهدات منشور
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    try {
        const postResult = await pool.query('SELECT views FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];
        if (!post) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentViews = Array.isArray(post.views) ? post.views : [];
        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE id = $2', [JSON.stringify(currentViews), postId]);
            res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: currentViews.length });
        } else {
            res.status(200).json({ message: 'تمت مشاهدة المنشور بالفعل بواسطة هذا المستخدم.', viewsCount: currentViews.length });
        }
    } catch (error) {
        console.error('ERROR: Post view error:', error.stack);
        res.status(500).json({ error: 'فشل في تسجيل المشاهدة.' });
    }
});

// حذف منشور (مع حذف الملف من Storj DCS)
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    
    try {
        const postResult = await pool.query('SELECT media_url, author_id FROM posts WHERE id = $1', [postId]);
        const postToDelete = postResult.rows[0];

        if (!postToDelete) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        // حذف الملف من Storj DCS إذا كان موجوداً
        if (postToDelete.media_url) {
            try {
                // استخراج الـ objectKey من الـ URL (لأن Storj DCS لا يستخدم مسارات URL تقليدية)
                // مثال: https://gateway.storjshare.io/your-bucket/posts/authorId/filename.jpg
                const urlParts = postToDelete.media_url.split('/');
                const bucketIndex = urlParts.indexOf(STORJ_BUCKET_NAME);
                if (bucketIndex !== -1 && urlParts.length > bucketIndex + 1) {
                    const objectKey = urlParts.slice(bucketIndex + 1).join('/');
                    console.log(`DEBUG: Deleting object from Storj DCS: ${objectKey}`);
                    await s3Client.send(new DeleteObjectCommand({ Bucket: STORJ_BUCKET_NAME, Key: objectKey }));
                    console.log(`INFO: Media file ${objectKey} deleted from Storj DCS.`);
                } else {
                    console.warn(`WARN: Could not parse object key from media URL: ${postToDelete.media_url}`);
                }
            } catch (storjError) {
                console.error('ERROR: Failed to delete media from Storj DCS:', storjError.stack);
                // لا نوقف العملية هنا، فقط نسجل الخطأ ونستمر في حذف المنشور من قاعدة البيانات
            }
        }

        // حذف المنشور من قاعدة البيانات
        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        console.log(`INFO: Post ${postId} deleted from database.`);
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });

    } catch (error) {
        console.error('ERROR: Delete post error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المنشور.' });
    }
});


// --- وظائف API للمحادثات الخاصة والمجموعات ---

// إنشاء محادثة خاصة جديدة (أو جلبها إذا كانت موجودة)
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين وأسماء جهات الاتصال مطلوبة لإنشاء محادثة خاصة.' });
    }
    if (user1Id === user2Id) {
        return res.status(400).json({ error: 'لا يمكنك إنشاء محادثة خاصة مع نفسك.' });
    }

    try {
        // التحقق مما إذا كانت المحادثة موجودة بالفعل بين هذين المستخدمين
        // نبحث عن محادثة من نوع 'private' تحتوي على كلا المستخدمين
        const existingChatQuery = `
            SELECT id FROM chats
            WHERE type = 'private'
            AND (
                (participants @> '[{"uid": "${user1Id}"}]' AND participants @> '[{"uid": "${user2Id}"}]')
            )
        `;
        const existingChatResult = await pool.query(existingChatQuery);

        if (existingChatResult.rows.length > 0) {
            console.log(`INFO: Private chat already exists between ${user1Id} and ${user2Id}. Chat ID: ${existingChatResult.rows[0].id}`);
            // تحديث اسم جهة الاتصال للمستخدم الأول فقط إذا كان مختلفاً
            const updateContactNameQuery = `
                UPDATE chats SET
                participants = jsonb_set(participants, '{0, contact_name}', to_jsonb($3::text), true)
                WHERE id = $1 AND (participants->0->>'uid' = $2 OR participants->1->>'uid' = $2);
            `;
            // في حالة وجود محادثة، نحتاج إلى التأكد من تحديث contact_name فقط للمستخدم الذي بدأ المحادثة
            // هذا يتطلب تحديد أي من المشاركين هو user1Id في قاعدة البيانات.
            // لتبسيط الأمر، يمكننا جلب المحادثة وتحديثها بناءً على فهرس المشارك الصحيح.
            const chatToUpdateResult = await pool.query(`SELECT id, participants FROM chats WHERE id = $1`, [existingChatResult.rows[0].id]);
            const chatToUpdate = chatToUpdateResult.rows[0];
            if (chatToUpdate) {
                let updatedParticipants = chatToUpdate.participants.map(p => {
                    if (p.uid === user1Id) {
                        return { ...p, contact_name: contactName };
                    }
                    return p;
                });
                await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatToUpdate.id]);
            }
            
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChatResult.rows[0].id });
        }

        const newChatId = uuidv4();
        const timestamp = Date.now();

        // يجب تخزين بيانات المشاركين كـ JSONB يحتوي على uid و username و customId و contact_name
        // profile_bg_url يجب أن يتم جلبه من جدول المستخدمين
        const user1ProfileBgResult = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [user1Id]);
        const user1ProfileBg = user1ProfileBgResult.rows[0]?.profile_bg_url || null;

        const user2ProfileBgResult = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [user2Id]);
        const user2ProfileBg = user2ProfileBgResult.rows[0]?.profile_bg_url || null;


        const participants = [
            { uid: user1Id, username: user1Name, custom_id: user1CustomId, profile_bg_url: user1ProfileBg, contact_name: contactName },
            { uid: user2Id, username: user2Name, custom_id: user2CustomId, profile_bg_url: user2ProfileBg, contact_name: user1Name } // اسم المستخدم الحالي كاسم جهة اتصال للمستخدم الآخر
        ];

        const insertChatQuery = `
            INSERT INTO chats (id, type, participants, created_at, name, profile_bg_url, admin_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        const newChatResult = await pool.query(insertChatQuery, [
            newChatId,
            'private',
            JSON.stringify(participants),
            timestamp,
            user2Name, // اسم الطرف الآخر هو الاسم الافتراضي للمحادثة في قائمة الدردشات
            user2ProfileBg, // خلفية ملف الطرف الآخر للمحادثة
            null // لا يوجد مشرف للمحادثات الخاصة
        ]);

        console.log(`INFO: New private chat created: ${newChatId}`);
        res.status(201).json({ message: 'تم إنشاء المحادثة بنجاح!', chatId: newChatResult.rows[0].id });

    } catch (error) {
        console.error('ERROR: Create private chat error:', error.stack);
        res.status(500).json({ error: 'فشل في إنشاء المحادثة الخاصة.' });
    }
});


// جلب محادثات المستخدم (خاصة ومجموعات)
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, type, participants, created_at, name, profile_bg_url, admin_id, last_message_text, last_message_timestamp FROM chats WHERE $1 = ANY(ARRAY(SELECT (p->>'uid') FROM jsonb_array_elements(participants) p))`,
            [userId]
        );
        
        const chats = result.rows.map(chat => {
            let chatName = chat.name;
            let chatProfileBg = chat.profile_bg_url;
            let chatCustomId = null; // للمحادثات الفردية، سيكون معرف الطرف الآخر
            let adminId = chat.admin_id; // للمجموعات

            if (chat.type === 'private') {
                // للمحادثات الخاصة، تحديد اسم جهة الاتصال وخلفية الملف الشخصي من جانب المستخدم الحالي
                const currentUserParticipant = chat.participants.find(p => p.uid === userId);
                const otherParticipant = chat.participants.find(p => p.uid !== userId);

                if (currentUserParticipant && currentUserParticipant.contact_name) {
                    chatName = currentUserParticipant.contact_name;
                } else if (otherParticipant) {
                    chatName = otherParticipant.username; // Fallback to other user's username
                }

                if (otherParticipant) {
                    chatProfileBg = otherParticipant.profile_bg_url;
                    chatCustomId = otherParticipant.custom_id;
                }
            } else if (chat.type === 'group') {
                // للمجموعات، اسم المجموعة وخلفيتها هما ما تم تخزينه في حقول الدردشة
                chatName = chat.name;
                chatProfileBg = chat.profile_bg_url; // خلفية المجموعة
            }

            return {
                id: chat.id,
                type: chat.type,
                name: chatName,
                profileBg: chatProfileBg, // استخدم 'profileBg' ليتناسب مع الواجهة الأمامية
                customId: chatCustomId,
                timestamp: chat.last_message_timestamp || chat.created_at, // استخدام last_message_timestamp
                lastMessage: chat.last_message_text, // استخدام last_message_text
                adminId: adminId // إعادة adminId للمجموعات
            };
        });
        res.status(200).json(chats);
    } catch (error) {
        console.error('ERROR: Get user chats error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب محادثات المستخدم.' });
    }
});


// جلب رسائل محادثة معينة
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const since = req.query.since ? parseInt(req.query.since) : 0; // جلب الرسائل التي أُنشئت بعد هذا الطابع الزمني

    try {
        const messagesResult = await pool.query(
            `SELECT * FROM messages WHERE chat_id = $1 AND timestamp > $2 ORDER BY timestamp ASC`,
            [chatId, since]
        );

        res.status(200).json(messagesResult.rows.map(msg => ({
            id: msg.id,
            chatId: msg.chat_id,
            senderId: msg.sender_id,
            senderName: msg.sender_name,
            text: msg.text,
            mediaType: msg.media_type,
            mediaUrl: msg.media_url,
            timestamp: msg.timestamp,
            senderProfileBg: msg.sender_profile_bg // تمرير خلفية الملف الشخصي للمرسل
        })));
    } catch (error) {
        console.error('ERROR: Get chat messages error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب الرسائل.' });
    }
});

// إرسال رسالة جديدة (مع دعم الوسائط عبر Storj DCS)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;

    console.log("DEBUG: Received message send request for chatId:", chatId);
    console.log("DEBUG: req.file for message media:", req.file);
    console.log("DEBUG: Message text:", text);
    console.log("DEBUG: Message mediaType from body:", mediaType);

    if (!senderId || !senderName) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المرسل (senderId, senderName) مطلوبة.' });
    }
    if (!text && !req.file) {
        return res.status(400).json({ error: 'الرسالة لا يمكن أن تكون فارغة (يجب أن تحتوي على نص أو وسائط).' });
    }

    try {
        const chatResult = await pool.query('SELECT type FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];
        if (!chat) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }

        let mediaUrl = null;
        let finalMediaType = mediaType || 'text';

        if (req.file) {
            // التحقق من متغيرات Storj قبل محاولة الرفع
            if (!STORJ_ENDPOINT || !STORJ_ACCESS_KEY_ID || !STORJ_SECRET_ACCESS_KEY || !STORJ_BUCKET_NAME) {
                throw new Error('Storj DCS environment variables not set. Cannot upload media for message.');
            }

            const fileStats = await stat(req.file.path);
            const fileSize = fileStats.size;
            console.log(`DEBUG: File size for message media upload: ${fileSize}`); // DEBUG: Log file size

            const fileStream = fs.createReadStream(req.file.path);
            const objectKey = `chat-media/${chatId}/${uuidv4()}-${req.file.filename}`; // مسار فريد في Storj DCS

            const uploadParams = {
                Bucket: STORJ_BUCKET_NAME,
                Key: objectKey,
                Body: fileStream,
                ContentType: req.file.mimetype,
                ContentLength: fileSize
            };
            await s3Client.send(new PutObjectCommand(uploadParams));

            mediaUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${objectKey}`;
            finalMediaType = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'unknown');
            if (finalMediaType === 'unknown') {
                await s3Client.send(new DeleteObjectCommand({ Bucket: STORJ_BUCKET_NAME, Key: objectKey }));
                throw new Error('Unsupported media type for Storj upload in message.');
            }
            console.log(`INFO: Message media uploaded to Storj DCS. URL: ${mediaUrl}, mediaType: ${finalMediaType}`);
        } else {
            console.log("DEBUG: No media file attached to message.");
        }

        const messageId = uuidv4();
        const timestamp = Date.now();
        const insertMessageQuery = `
            INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
        const newMessageResult = await pool.query(insertMessageQuery, [
            messageId, chatId, senderId, senderName, text || '', finalMediaType, mediaUrl, timestamp, senderProfileBg || null
        ]);
        const newMessage = newMessageResult.rows[0];

        // تحديث آخر رسالة وطابعها الزمني في جدول المحادثات
        await pool.query(
            'UPDATE chats SET last_message_text = $1, last_message_timestamp = $2 WHERE id = $3',
            [text || (finalMediaType === 'image' ? 'صورة' : (finalMediaType === 'video' ? 'فيديو' : 'رسالة')), timestamp, chatId]
        );

        console.log(`INFO: Message sent in chat ${chatId}. Message ID: ${newMessage.id}`);
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', messageData: newMessage });

    } catch (error) {
        console.error('ERROR: Send message error:', error.stack);
        res.status(500).json({ error: 'فشل في إرسال الرسالة.' });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`DEBUG: Deleted temporary file: ${req.file.path}`);
        }
    }
});


// حذف محادثة لمستخدم واحد (خاصة أو مجموعة)
app.delete('/api/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body; // المستخدم الذي يريد حذف المحادثة من عنده

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    try {
        const chatResult = await pool.query('SELECT participants, type FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }

        let updatedParticipants = chat.participants.map(p => {
            if (p.uid === userId) {
                // تعيين علامة "محذوف" للمشارك في هذه المحادثة
                return { ...p, deleted_for_user: true };
            }
            return p;
        });

        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatId]);

        console.log(`INFO: Chat ${chatId} marked as deleted for user ${userId}.`);
        res.status(200).json({ message: 'تم حذف المحادثة من عندك.' });

    } catch (error) {
        console.error('ERROR: Delete chat for user error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المحادثة من عندك.' });
    }
});

// حذف محادثة خاصة من الطرفين (يجب أن يزيلها من كلا المستخدمين)
// هذه العملية أكثر تعقيداً، ستقوم حالياً بإزالتها من المستخدمين وتصفير الرسائل
app.delete('/api/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body; // المستخدم الذي بدأ الحذف

    if (!callerUid) {
        return res.status(400).json({ error: 'معرف المتصل (callerUid) مطلوب.' });
    }

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'private\'', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة الخاصة غير موجودة.' });
        }

        const participantUids = chat.participants.map(p => p.uid);
        if (!participantUids.includes(callerUid)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });
        }

        // حذف جميع الرسائل المتعلقة بهذه المحادثة
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        console.log(`INFO: All messages for private chat ${chatId} deleted.`);

        // حذف إدخال المحادثة نفسها
        await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
        console.log(`INFO: Private chat ${chatId} deleted for both users.`);

        res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });

    } catch (error) {
        console.error('ERROR: Delete private chat for both error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المحادثة من الطرفين.' });
    }
});


// تعديل اسم جهة اتصال في محادثة خاصة (من جانب مستخدم واحد)
app.put('/api/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    if (!userId || !newContactName) {
        return res.status(400).json({ error: 'معرف المستخدم واسم جهة الاتصال الجديد مطلوبان.' });
    }

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'private\'', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
        }

        let updatedParticipants = chat.participants.map(p => {
            if (p.uid === userId) {
                return { ...p, contact_name: newContactName };
            }
            return p;
        });

        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatId]);
        console.log(`INFO: Contact name for chat ${chatId} updated by user ${userId} to "${newContactName}".`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });

    } catch (error) {
        console.error('ERROR: Update contact name error:', error.stack);
        res.status(500).json({ error: 'فشل في تحديث اسم جهة الاتصال.' });
    }
});


// إنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body; // 'members' يجب أن تكون كائن { uid: role }

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، معرف المشرف، وعضوين على الأقل مطلوبان.' });
    }
    if (members[adminId] !== 'admin') {
        return res.status(400).json({ error: 'المشرف المحدد يجب أن يكون دوره "admin" في قائمة الأعضاء.' });
    }

    try {
        const newGroupId = uuidv4();
        const timestamp = Date.now();

        // جلب بيانات كاملة لكل عضو (بما في ذلك custom_id و profile_bg_url)
        const memberUids = Object.keys(members);
        const usersResult = await pool.query(
            `SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = ANY($1::uuid[])`,
            [memberUids]
        );
        const usersDataMap = new Map(usersResult.rows.map(u => [u.uid, u]));

        const groupParticipants = [];
        for (const uid of memberUids) {
            const userData = usersDataMap.get(uid);
            if (userData) {
                groupParticipants.push({
                    uid: userData.uid,
                    username: userData.username,
                    custom_id: userData.custom_id,
                    profile_bg_url: userData.profile_bg_url,
                    role: members[uid], // 'admin' أو 'member'
                    contact_name: userData.username // للمجموعات، اسم جهة الاتصال هو اسم المستخدم
                });
            } else {
                console.warn(`WARN: Member UID ${uid} not found in users table during group creation.`);
            }
        }

        if (groupParticipants.length < 2) {
            return res.status(400).json({ error: 'لا يمكن إنشاء المجموعة بأقل من عضوين صالحين.' });
        }

        const insertGroupQuery = `
            INSERT INTO chats (id, type, participants, created_at, name, description, profile_bg_url, admin_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
        
        const newGroupResult = await pool.query(insertGroupQuery, [
            newGroupId,
            'group',
            JSON.stringify(groupParticipants),
            timestamp,
            name,
            description || '',
            null, // خلفية المجموعة (يمكن إضافتها لاحقاً إذا لزم الأمر)
            adminId
        ]);

        console.log(`INFO: New group created: ${name}, ID: ${newGroupId}`);
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح!', groupId: newGroupResult.rows[0].id });

    } catch (error) {
        console.error('ERROR: Create group error:', error.stack);
        res.status(500).json({ error: 'فشل في إنشاء المجموعة.' });
    }
});


// جلب أعضاء مجموعة معينة
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = result.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json(group.participants || []);
    } catch (error) {
        console.error('ERROR: Get group members error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب أعضاء المجموعة.' });
    }
});

// جلب عدد أعضاء مجموعة معينة
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = result.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json({ count: (group.participants || []).length });
    } catch (error) {
        console.error('ERROR: Get group members count error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب عدد أعضاء المجموعة.' });
    }
});


// إضافة أعضاء إلى مجموعة
app.post('/api/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body; // callerUid هو المستخدم الذي يقوم بإضافة الأعضاء

    if (!Array.isArray(newMemberUids) || newMemberUids.length === 0 || !callerUid) {
        return res.status(400).json({ error: 'قائمة بمعرفات الأعضاء الجدد ومعرف المتصل مطلوبة.' });
    }

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        // التحقق مما إذا كان المتصل مشرفًا في المجموعة
        const currentParticipants = Array.isArray(group.participants) ? group.participants : [];
        const callerParticipant = currentParticipants.find(p => p.uid === callerUid);
        if (!callerParticipant || callerParticipant.role !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى هذه المجموعة.' });
        }

        // جلب بيانات الأعضاء الجدد كاملة (uid, username, custom_id, profile_bg_url)
        const usersResult = await pool.query(
            `SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = ANY($1::uuid[])`,
            [newMemberUids]
        );
        const newUsersDataMap = new Map(usersResult.rows.map(u => [u.uid, u]));

        let updatedParticipants = [...currentParticipants];
        let addedCount = 0;

        for (const uid of newMemberUids) {
            // التحقق مما إذا كان العضو موجوداً بالفعل في المجموعة لتجنب التكرار
            if (!currentParticipants.some(p => p.uid === uid)) {
                const userData = newUsersDataMap.get(uid);
                if (userData) {
                    updatedParticipants.push({
                        uid: userData.uid,
                        username: userData.username,
                        custom_id: userData.custom_id,
                        profile_bg_url: userData.profile_bg_url,
                        role: 'member', // الأعضاء المضافون افتراضيا يكونون 'member'
                        contact_name: userData.username
                    });
                    addedCount++;
                } else {
                    console.warn(`WARN: New member UID ${uid} not found in users table.`);
                }
            }
        }

        if (addedCount === 0) {
            return res.status(200).json({ message: 'جميع الأعضاء المحددين موجودون بالفعل في المجموعة أو غير صالحين.' });
        }

        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), groupId]);
        console.log(`INFO: Added ${addedCount} new members to group ${groupId}.`);
        res.status(200).json({ message: `تم إضافة ${addedCount} أعضاء جدد بنجاح إلى المجموعة.`, newMembersCount: addedCount });

    } catch (error) {
        console.error('ERROR: Add members to group error:', error.stack);
        res.status(500).json({ error: 'فشل في إضافة أعضاء إلى المجموعة.' });
    }
});


// تغيير دور عضو في مجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body; // callerUid هو المستخدم الذي يقوم بالتغيير

    if (!newRole || !['admin', 'member'].includes(newRole) || !callerUid) {
        return res.status(400).json({ error: 'الدور الجديد (admin أو member) ومعرف المتصل مطلوبان.' });
    }

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentParticipants = Array.isArray(group.participants) ? group.participants : [];
        const callerParticipant = currentParticipants.find(p => p.uid === callerUid);
        const targetParticipantIndex = currentParticipants.findIndex(p => p.uid === memberUid);

        if (!callerParticipant || callerParticipant.role !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير أدوار الأعضاء في هذه المجموعة.' });
        }
        if (targetParticipantIndex === -1) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }
        if (memberUid === callerUid && newRole === 'member') {
            return res.status(400).json({ error: 'لا يمكنك إزالة نفسك من الإشراف. إذا كنت تريد مغادرة المجموعة، استخدم خيار المغادرة.' });
        }
        // لا يمكن لغير المالك إزالة مشرف آخر من الإشراف، إلا إذا كان هو المالك نفسه
        if (currentParticipants[targetParticipantIndex].role === 'admin' && newRole === 'member' && callerUid !== group.admin_id) {
             return res.status(403).json({ error: 'فقط مالك المجموعة يمكنه إزالة المشرفين الآخرين.' });
        }
        // لا يمكن إزالة المالك من المجموعة أو تغيير دوره إلا إذا كان هو المالك نفسه
        if (memberUid === group.admin_id && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك تغيير دور مالك المجموعة.' });
        }

        currentParticipants[targetParticipantIndex].role = newRole;

        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(currentParticipants), groupId]);
        console.log(`INFO: Member ${memberUid} role changed to ${newRole} in group ${groupId}.`);
        res.status(200).json({ message: `تم تغيير دور العضو بنجاح إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });

    } catch (error) {
        console.error('ERROR: Change member role error:', error.stack);
        res.status(500).json({ error: 'فشل في تغيير دور العضو.' });
    }
});

// إزالة عضو من مجموعة
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body; // المستخدم الذي يقوم بالإزالة

    if (!callerUid) {
        return res.status(400).json({ error: 'معرف المتصل (callerUid) مطلوب.' });
    }

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentParticipants = Array.isArray(group.participants) ? group.participants : [];
        const callerParticipant = currentParticipants.find(p => p.uid === callerUid);
        const targetParticipant = currentParticipants.find(p => p.uid === memberUid);

        if (!callerParticipant || callerParticipant.role !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة أعضاء من هذه المجموعة.' });
        }
        if (!targetParticipant) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }
        if (memberUid === callerUid) {
            return res.status(400).json({ error: 'لا يمكنك إزالة نفسك من المجموعة بهذه الطريقة. استخدم خيار مغادرة المجموعة.' });
        }
        // لا يمكن إزالة المالك من المجموعة إلا إذا كان هو المالك نفسه
        if (memberUid === group.admin_id && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
        }

        // فلترة العضو المستهدف من قائمة المشاركين
        const updatedParticipants = currentParticipants.filter(p => p.uid !== memberUid);

        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), groupId]);
        console.log(`INFO: Member ${memberUid} removed from group ${groupId}.`);
        res.status(200).json({ message: 'تم إزالة العضو بنجاح من المجموعة.' });

    } catch (error) {
        console.error('ERROR: Remove member error:', error.stack);
        res.status(500).json({ error: 'فشل في إزالة العضو.' });
    }
});

// مغادرة المجموعة (يتم التعامل معها كحذف من جانب المستخدم في الواجهة الأمامية)
app.delete('/api/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body; // المستخدم الذي يغادر

    if (!memberUid) {
        return res.status(400).json({ error: 'معرف العضو (memberUid) مطلوب.' });
    }

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentParticipants = Array.isArray(group.participants) ? group.participants : [];
        const memberToLeave = currentParticipants.find(p => p.uid === memberUid);

        if (!memberToLeave) {
            return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
        }
        // إذا كان المستخدم هو المالك الوحيد، فيجب أن تظهر رسالة خطأ
        if (memberUid === group.admin_id && currentParticipants.length === 1) {
            // تحقق مما إذا كان المالك هو العضو الوحيد
            return res.status(400).json({ error: 'أنت المالك الوحيد للمجموعة والعضو الأخير. لا يمكنك مغادرة المجموعة.' });
        }
        
        // إذا كان المالك يغادر، يجب تعيين مشرف جديد تلقائيًا إذا كان هناك آخرون
        if (memberUid === group.admin_id) {
            const remainingAdmins = currentParticipants.filter(p => p.uid !== memberUid && p.role === 'admin');
            if (remainingAdmins.length > 0) {
                // تعيين أول مشرف متبقي كمالك جديد
                group.admin_id = remainingAdmins[0].uid;
                console.log(`INFO: Group ${groupId} new admin_id set to ${group.admin_id} after owner left.`);
            } else {
                // تعيين أول عضو متبقي كمشرف جديد
                const remainingMembers = currentParticipants.filter(p => p.uid !== memberUid);
                if (remainingMembers.length > 0) {
                    group.admin_id = remainingMembers[0].uid;
                    remainingMembers[0].role = 'admin'; // ترقية أول عضو إلى مشرف
                    console.log(`INFO: Group ${groupId} new admin_id set to ${group.admin_id} (promoted member) after owner left.`);
                } else {
                    // لا يوجد أعضاء متبقين، المجموعة ستصبح فارغة
                    // يمكن أن تختار حذف المجموعة هنا إذا أردت
                    await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                    console.log(`INFO: Group ${groupId} became empty and was deleted after owner left.`);
                    return res.status(200).json({ message: 'لقد غادرت المجموعة، وأصبحت فارغة وتم حذفها.' });
                }
            }
        }

        // إزالة العضو من قائمة المشاركين
        const updatedParticipants = currentParticipants.filter(p => p.uid !== memberUid);
        
        await pool.query(
            'UPDATE chats SET participants = $1, admin_id = $2 WHERE id = $3',
            [JSON.stringify(updatedParticipants), group.admin_id, groupId]
        );
        console.log(`INFO: User ${memberUid} left group ${groupId}.`);
        res.status(200).json({ message: 'لقد غادرت المجموعة بنجاح.' });

    } catch (error) {
        console.error('ERROR: Leave group error:', error.stack);
        res.status(500).json({ error: 'فشل في مغادرة المجموعة.' });
    }
});


// بدء الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
