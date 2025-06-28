// استيراد المكتبات الضرورية
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const { Pool } = require('pg'); // استيراد مكتبة PostgreSQL

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
        rejectUnauthorized: false // مطلوب لـ Render PostgreSQL
    }
});

// اختبار الاتصال بقاعدة البيانات
pool.connect()
    .then(client => {
        console.log('INFO: Connected to PostgreSQL database successfully!');
        client.release(); // إطلاق العميل فوراً بعد الاختبار
    })
    .catch(err => {
        console.error('ERROR: Database connection failed!', err.stack);
        process.exit(1); // إنهاء التطبيق إذا فشل الاتصال بقاعدة البيانات
    });

// --- إعداد تخزين Multer للتخزين المحلي المؤقت ---
// هذا المجلد سيتم مسحه عند إعادة تشغيل الخادم على Render.
// لتخزين دائم، ستحتاج إلى خدمة تخزين سحابي مثل Cloudinary أو AWS S3.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log(`INFO: Created uploads directory at ${uploadsDir}`);
} else {
    console.log(`INFO: Uploads directory already exists at ${uploadsDir}`);
}

// توفير الملفات الثابتة من مجلد 'uploads'
app.use('/uploads', express.static(uploadsDir));
console.log(`INFO: Serving static files from /uploads to ${uploadsDir}`);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir); // مجلد الوجهة لرفع الملفات
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const newFileName = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        console.log(`DEBUG: Multer generated filename: ${newFileName}`);
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

// رفع خلفية الملف الشخصي (باستخدام التخزين المحلي المؤقت)
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
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE uid = $1', [userId]);
        const user = result.rows[0];

        if (!user) {
            console.warn(`WARN: User ${userId} not found for profile background upload.`);
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [fileUrl, userId]);
        
        console.log(`INFO: Profile background uploaded for ${userId}. URL: ${fileUrl}`);
        res.status(200).json({ message: 'تم تحديث خلفية الملف الشخصي بنجاح!', url: fileUrl });
    } catch (error) {
        console.error('ERROR: Profile background upload error:', error.stack);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'فشل في تحديث خلفية الملف الشخصي.' });
    }
});

// جلب خلفية الملف الشخصي للمستخدم
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
            const participants = chat.participants; // Assuming participants is jsonb array
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
    const { followerId, followingId } = req.params;

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
            await pool.query('UPDATE users SET following = $1 WHERE uid = $2', [followerFollowing, followerId]);
            await pool.query('UPDATE users SET followers = $1 WHERE uid = $2', [followingFollowers, followingId]);
            res.status(200).json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing: false });
        } else {
            followerFollowing.push(followingId);
            followingFollowers.push(followerId);
            await pool.query('UPDATE users SET following = $1 WHERE uid = $2', [followerFollowing, followerId]);
            await pool.query('UPDATE users SET followers = $1 WHERE uid = $2', [followingFollowers, followingId]);
            res.status(200).json({ message: 'تمت المتابعة بنجاح.', isFollowing: true });
        }
    } catch (error) {
        console.error('ERROR: Follow/unfollow error:', error.stack);
        res.status(500).json({ error: 'فشل في عملية المتابعة/إلغاء المتابعة.' });
    }
});

// التحقق مما إذا كان المستخدم يتابع آخر
app.get('/api/user/:followerId/following/:followingId', async (req, res) => {
    const { followerId, followingId } = req.params;
    try {
        const result = await pool.query('SELECT following FROM users WHERE uid = $1', [followerId]);
        const follower = result.rows[0];
        if (!follower) {
            return res.status(404).json({ error: 'المتابع غير موجود.' });
        }
        const isFollowing = (follower.following || []).includes(followingId);
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error('ERROR: Check following error:', error.stack);
        res.status(500).json({ error: 'فشل في التحقق من حالة المتابعة.' });
    }
});


// --- وظائف API للمنشورات ---

// نشر منشور جديد (باستخدام التخزين المحلي المؤقت)
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
            mediaUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
            finalMediaType = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'unknown');
            if (finalMediaType === 'unknown') {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'نوع ملف الوسائط غير مدعوم.' });
            }
            console.log(`DEBUG: Generated mediaUrl for post: ${mediaUrl}, mediaType: ${finalMediaType}`);
        } else {
            console.log("DEBUG: No media file uploaded for post.");
        }

        const newPost = {
            id: uuidv4(),
            authorId,
            authorName,
            text: text || '',
            mediaType: finalMediaType,
            mediaUrl: mediaUrl,
            timestamp: Date.now(),
            likes: [],
            comments: [],
            views: [],
            authorProfileBg: authorProfileBg || null,
            followerCount: (author.followers || []).length
        };

        const insertQuery = `
            INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`;
        const postResult = await pool.query(insertQuery, [
            newPost.id, newPost.authorId, newPost.authorName, newPost.text, newPost.mediaType,
            newPost.mediaUrl, newPost.timestamp, newPost.likes, newPost.comments, newPost.views,
            newPost.authorProfileBg, newPost.followerCount
        ]);
        const createdPost = postResult.rows[0];

        console.log(`INFO: New post created. Post ID: ${createdPost.id}, Media URL saved: ${createdPost.media_url || 'None'}`);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح!', post: createdPost });
    } catch (error) {
        console.error('ERROR: Post creation error:', error.stack);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'فشل في نشر المنشور.' });
    }
});

// جلب جميع المنشورات
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

        const followedUids = user.following || [];
        if (followedUids.length === 0) {
            return res.status(200).json([]); // لا توجد منشورات لمتابعين إذا لم يكن يتابع أحداً
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
            if (user && (user.following || []).length > 0) {
                const followedUids = user.following;
                whereClauses.push(`author_id = ANY($${queryParams.length + 1}::uuid[])`);
                queryParams.push(followedUids);
            } else if (user) {
                // If filter is 'followed' but user follows no one, return empty results
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
            await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [currentLikes, postId]);
            res.status(200).json({ message: 'تم إلغاء الإعجاب.', isLiked: false, likesCount: currentLikes.length });
        } else {
            currentLikes.push(userId);
            await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [currentLikes, postId]);
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

        await pool.query('UPDATE posts SET comments = $1 WHERE id = $2', [currentComments, postId]);
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
        await pool.query('UPDATE posts SET comments = $1 WHERE id = $2', [currentComments, postId]);
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
            await pool.query('UPDATE posts SET views = $1 WHERE id = $2', [currentViews, postId]);
            res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: currentViews.length });
        } else {
            res.status(200).json({ message: 'تمت مشاهدة المنشور بالفعل بواسطة هذا المستخدم.', viewsCount: currentViews.length });
        }
    } catch (error) {
        console.error('ERROR: Post view error:', error.stack);
        res.status(500).json({ error: 'فشل في تسجيل المشاهدة.' });
    }
});

// حذف منشور (مع حذف الملف المحلي إذا كان موجوداً)
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    
    try {
        const postResult = await pool.query('SELECT media_url FROM posts WHERE id = $1', [postId]);
        const postToDelete = postResult.rows[0];

        if (postToDelete && postToDelete.media_url) {
            const filename = path.basename(postToDelete.media_url);
            const filePath = path.join(uploadsDir, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`INFO: Deleted local media file: ${filePath}`);
            }
        }

        const deleteResult = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [postId]);
        if (deleteResult.rows.length > 0) {
            res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
        } else {
            res.status(404).json({ error: 'المنشور غير موجود.' });
        }
    } catch (error) {
        console.error('ERROR: Delete post error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المنشور.' });
    }
});


// --- وظائف API للمحادثات ---

// جلب جميع المحادثات لمستخدم معين
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    try {
        // جلب المحادثات التي يشارك فيها المستخدم
        const chatsResult = await pool.query(
            `SELECT id, type, participants, created_at, name, profile_bg_url, admin_id FROM chats 
             WHERE $1 = ANY(ARRAY(SELECT (p->>'uid') FROM jsonb_array_elements(participants) p)) 
             ORDER BY created_at DESC`, // ستُفرز لاحقاً بالرسالة الأخيرة
            [userId]
        );

        const userChatsPromises = chatsResult.rows.map(async chat => {
            let chatName = '';
            let profileBgUrl = null;
            let customId = null;
            let adminId = null;

            if (chat.type === 'private') {
                const otherParticipant = chat.participants.find(p => p.uid !== userId);
                let contactUser = null;
                if (otherParticipant) {
                    const userResult = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [otherParticipant.uid]);
                    contactUser = userResult.rows[0];
                }
                
                const currentUserChatEntry = chat.participants.find(p => p.uid === userId);
                chatName = currentUserChatEntry.contactName || (contactUser ? contactUser.username : 'Unknown User');
                profileBgUrl = contactUser ? contactUser.profile_bg_url : null;
                customId = contactUser ? contactUser.custom_id : null;
            } else if (chat.type === 'group') {
                chatName = chat.name;
                profileBgUrl = chat.profile_bg_url || null;
                adminId = chat.admin_id;
            }

            // جلب آخر رسالة
            const lastMessageResult = await pool.query(
                `SELECT text, timestamp FROM messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1`,
                [chat.id]
            );
            const lastMessage = lastMessageResult.rows[0];

            return {
                id: chat.id,
                type: chat.type,
                name: chatName,
                lastMessage: lastMessage ? lastMessage.text : null,
                timestamp: lastMessage ? lastMessage.timestamp : (chat.created_at || 0),
                profileBg: profileBgUrl,
                customId: customId,
                adminId: adminId
            };
        });
        
        const userChats = await Promise.all(userChatsPromises);
        userChats.sort((a, b) => b.timestamp - a.timestamp); // فرز حسب الطابع الزمني لآخر رسالة

        res.status(200).json(userChats);
    } catch (error) {
        console.error('ERROR: Get user chats error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب المحادثات.' });
    }
});

// إنشاء محادثة فردية جديدة (أو جلب محادثة موجودة)
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    try {
        // التحقق مما إذا كانت المحادثة موجودة بالفعل
        const existingChatResult = await pool.query(
            `SELECT id FROM chats WHERE type = 'private' 
             AND (
                 (participants @> '[{"uid": $1}]' AND participants @> '[{"uid": $2}]')
             )`,
            [user1Id, user2Id]
        );
        const existingChat = existingChatResult.rows[0];

        if (existingChat) {
            // إذا كانت موجودة، نقوم بتحديث اسم جهة الاتصال للمستخدم الحالي
            const chatParticipantsResult = await pool.query(
                `SELECT participants FROM chats WHERE id = $1`, [existingChat.id]
            );
            let participants = chatParticipantsResult.rows[0].participants;

            const currentUserParticipantIndex = participants.findIndex(p => p.uid === user1Id);
            if (currentUserParticipantIndex !== -1) {
                participants[currentUserParticipantIndex].contactName = contactName;
            }
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), existingChat.id]);

            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
        }

        const user1Result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [user1Id]);
        const user1 = user1Result.rows[0];
        const user2Result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [user2Id]);
        const user2 = user2Result.rows[0];

        if (!user1 || !user2) {
            return res.status(404).json({ error: 'أحد المستخدمين غير موجود.' });
        }

        const newChatId = uuidv4();
        const newParticipants = [
            { uid: user1.uid, name: user1.username, customId: user1.custom_id, profileBgUrl: user1.profile_bg_url, contactName: contactName },
            { uid: user2.uid, name: user2.username, customId: user2.custom_id, profileBgUrl: user2.profile_bg_url, contactName: user1.username }
        ];

        const insertQuery = `
            INSERT INTO chats (id, type, participants, created_at)
            VALUES ($1, $2, $3, $4) RETURNING id`;
        const newChatResult = await pool.query(insertQuery, [newChatId, 'private', JSON.stringify(newParticipants), Date.now()]);
        
        res.status(201).json({ message: 'تم إنشاء المحادثة بنجاح!', chatId: newChatResult.rows[0].id });
    } catch (error) {
        console.error('ERROR: Create private chat error:', error.stack);
        res.status(500).json({ error: 'فشل في إنشاء محادثة فردية.' });
    }
});

// تعديل اسم جهة الاتصال في محادثة فردية
app.put('/api/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'private\'', [chatId]);
        const chat = chatResult.rows[0];
        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة فردية.' });
        }

        let participants = chat.participants;
        const participantIndex = participants.findIndex(p => p.uid === userId);
        if (participantIndex === -1) {
            return res.status(403).json({ error: 'المستخدم ليس مشاركاً في هذه المحادثة.' });
        }

        participants[participantIndex].contactName = newContactName;
        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), chatId]);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } catch (error) {
        console.error('ERROR: Update contact name error:', error.stack);
        res.status(500).json({ error: 'فشل في تحديث اسم جهة الاتصال.' });
    }
});

// حذف محادثة فردية من طرف واحد (من عند المستخدم فقط)
app.delete('/api/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1', [chatId]);
        let chat = chatResult.rows[0];
        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }

        let participants = chat.participants;
        const participantIndex = participants.findIndex(p => p.uid === userId);

        if (participantIndex === -1) {
            return res.status(403).json({ error: 'المستخدم غير مصرح له بحذف هذه المحادثة.' });
        }

        participants.splice(participantIndex, 1);

        if (participants.length === 0) {
            await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
            await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
            res.status(200).json({ message: 'تم حذف المحادثة نهائياً.' });
        } else {
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), chatId]);
            res.status(200).json({ message: 'تم حذف المحادثة من طرفك فقط.' });
        }
    } catch (error) {
        console.error('ERROR: Delete chat for user error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المحادثة.' });
    }
});

// حذف محادثة فردية من الطرفين (أو مغادرة مجموعة)
app.delete('/api/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'private\'', [chatId]);
        const chat = chatResult.rows[0];
        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة فردية.' });
        }

        if (!chat.participants.some(p => p.uid === callerUid)) {
            return res.status(403).json({ error: 'أنت غير مخول بحذف هذه المحادثة.' });
        }

        await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
    } catch (error) {
        console.error('ERROR: Delete chat for both error:', error.stack);
        res.status(500).json({ error: 'فشل في حذف المحادثة من الطرفين.' });
    }
});


// --- وظائف API للرسائل ---

// إرسال رسالة (نص أو وسائط) (باستخدام التخزين المحلي المؤقت)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;

    console.log("DEBUG: req.file for message upload:", req.file);

    if (!senderId || !senderName) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المرسل (senderId, senderName) مطلوبة.' });
    }

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];
        if (!chat) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }
        if (!chat.participants.some(p => p.uid === senderId)) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'المرسل ليس مشاركاً في هذه المحادثة.' });
        }

        let mediaUrl = null;
        let finalMediaType = mediaType || 'text';

        if (req.file) {
            mediaUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
            finalMediaType = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'unknown');
            if (finalMediaType === 'unknown') {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'نوع ملف الوسائط غير مدعوم.' });
            }
            console.log(`DEBUG: Generated mediaUrl for message: ${mediaUrl}, mediaType: ${finalMediaType}`);
        } else {
            console.log("DEBUG: No media file uploaded for message.");
        }

        const newMessageId = uuidv4();
        const insertQuery = `
            INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
        const messageResult = await pool.query(insertQuery, [
            newMessageId, chatId, senderId, senderName, text || '', finalMediaType,
            mediaUrl, Date.now(), senderProfileBg || null
        ]);
        const createdMessage = messageResult.rows[0];

        console.log(`INFO: New message created. Message ID: ${createdMessage.id}, Media URL saved: ${createdMessage.media_url || 'None'}`);
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', message: createdMessage });
    } catch (error) {
        console.error('ERROR: Send message error:', error.stack);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'فشل في إرسال الرسالة.' });
    }
});

// جلب رسائل محادثة معينة
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0; // جلب الرسائل الأحدث من هذا الطابع الزمني

    try {
        const result = await pool.query('SELECT * FROM messages WHERE chat_id = $1 AND timestamp > $2 ORDER BY timestamp ASC', [chatId, since]);
        res.status(200).json(result.rows.map(msg => ({
            id: msg.id,
            chatId: msg.chat_id,
            senderId: msg.sender_id,
            senderName: msg.sender_name,
            text: msg.text,
            mediaType: msg.media_type,
            mediaUrl: msg.media_url,
            timestamp: msg.timestamp,
            senderProfileBg: msg.sender_profile_bg
        })));
    } catch (error) {
        console.error('ERROR: Get chat messages error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب الرسائل.' });
    }
});


// --- وظائف API للمجموعات ---

// إنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة والمشرف وعضوان على الأقل مطلوبان.' });
    }

    try {
        const adminUserResult = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [adminId]);
        const adminUser = adminUserResult.rows[0];
        if (!adminUser) {
            return res.status(404).json({ error: 'المشرف المحدد غير موجود.' });
        }

        const participants = [];
        for (const uid in members) {
            const userResult = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [uid]);
            const user = userResult.rows[0];
            if (user) {
                participants.push({
                    uid: user.uid,
                    name: user.username,
                    customId: user.custom_id,
                    role: members[uid],
                    profileBgUrl: user.profile_bg_url
                });
            }
        }

        if (participants.length < 2) {
            return res.status(400).json({ error: 'يجب أن تحتوي المجموعة على عضوين على الأقل.' });
        }

        const newGroupId = uuidv4();
        const insertQuery = `
            INSERT INTO chats (id, type, name, description, admin_id, participants, created_at, profile_bg_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
        const newGroupResult = await pool.query(insertQuery, [
            newGroupId, 'group', name, description, adminId, JSON.stringify(participants), Date.now(), null
        ]);
        
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح!', groupId: newGroupResult.rows[0].id });
    } catch (error) {
        console.error('ERROR: Create group error:', error.stack);
        res.status(500).json({ error: 'فشل في إنشاء المجموعة.' });
    }
});

// جلب أعضاء المجموعة
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = result.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json(group.participants.map(p => ({
            uid: p.uid,
            username: p.name,
            customId: p.customId,
            role: p.role,
            profileBgUrl: p.profileBgUrl
        })));
    } catch (error) {
        console.error('ERROR: Get group members error:', error.stack);
        res.status(500).json({ error: 'فشل في جلب أعضاء المجموعة.' });
    }
});

// جلب عدد أعضاء المجموعة
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

// إضافة أعضاء إلى مجموعة موجودة
app.post('/api/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let participants = group.participants;
        const callerIsAdmin = participants.some(p => p.uid === callerUid && p.role === 'admin');
        if (!callerIsAdmin) {
            return res.status(403).json({ error: 'أنت غير مخول بإضافة أعضاء إلى هذه المجموعة.' });
        }

        const addedMembers = [];
        for (const uid of newMemberUids) {
            if (!participants.some(p => p.uid === uid)) {
                const userResult = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid = $1', [uid]);
                const user = userResult.rows[0];
                if (user) {
                    participants.push({
                        uid: user.uid,
                        name: user.username,
                        customId: user.custom_id,
                        role: 'member',
                        profileBgUrl: user.profile_bg_url
                    });
                    addedMembers.push(user.username);
                }
            }
        }

        if (addedMembers.length > 0) {
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), groupId]);
            res.status(200).json({ message: `تم إضافة الأعضاء: ${addedMembers.join(', ')} بنجاح.` });
        } else {
            res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
        }
    } catch (error) {
        console.error('ERROR: Add group members error:', error.stack);
        res.status(500).json({ error: 'فشل في إضافة أعضاء المجموعة.' });
    }
});

// تغيير دور عضو في المجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let participants = group.participants;
        const caller = participants.find(p => p.uid === callerUid);
        const targetMember = participants.find(p => p.uid === memberUid);

        if (!caller || !targetMember) {
            return res.status(404).json({ error: 'المستخدم الذي يقوم بالعملية أو العضو المستهدف غير موجود في هذه المجموعة.' });
        }

        if (caller.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بتغيير أدوار الأعضاء.' });
        }

        if (targetMember.uid === group.admin_id && newRole === 'member' && caller.uid !== group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة إشراف مالك المجموعة.' });
        }

        if (targetMember.role === 'admin' && newRole === 'member' && caller.uid !== group.admin_id && targetMember.uid !== group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة إشراف مشرف آخر.' });
        }

        targetMember.role = newRole;
        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), groupId]);
        res.status(200).json({ message: `تم تغيير دور ${targetMember.name} إلى ${newRole}.` });
    } catch (error) {
        console.error('ERROR: Change member role error:', error.stack);
        res.status(500).json({ error: 'فشل في تغيير دور العضو.' });
    }
});

// إزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let participants = group.participants;
        const caller = participants.find(p => p.uid === callerUid);
        const targetMemberIndex = participants.findIndex(p => p.uid === memberUid);

        if (!caller || targetMemberIndex === -1) {
            return res.status(404).json({ error: 'المستخدم الذي يقوم بالعملية أو العضو المستهدف غير موجود في هذه المجموعة.' });
        }

        if (caller.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بإزالة الأعضاء.' });
        }

        const targetMember = participants[targetMemberIndex];

        if (targetMember.uid === group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
        }

        if (targetMember.role === 'admin' && caller.uid !== group.admin_id) {
            return res.status(403).json({ error: 'المشرف العادي لا يمكنه إزالة مشرف آخر.' });
        }

        participants.splice(targetMemberIndex, 1);
        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), groupId]);
        res.status(200).json({ message: `تم إزالة ${targetMember.name} من المجموعة بنجاح.` });
    } catch (error) {
        console.error('ERROR: Remove group member error:', error.stack);
        res.status(500).json({ error: 'فشل في إزالة العضو.' });
    }
});

// مغادرة المجموعة
app.delete('/api/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants, admin_id FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let participants = group.participants;
        const memberIndex = participants.findIndex(p => p.uid === memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        const leavingMember = participants[memberIndex];

        if (leavingMember.uid === group.admin_id) {
            if (participants.length > 1) {
                const newAdmin = participants.find(p => p.uid !== memberUid && p.role === 'admin');
                if (newAdmin) {
                    group.admin_id = newAdmin.uid;
                } else {
                    const firstAvailableMember = participants.find(p => p.uid !== memberUid);
                    if (firstAvailableMember) {
                        group.admin_id = firstAvailableMember.uid;
                        firstAvailableMember.role = 'admin';
                    } else {
                        await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                        await pool.query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
                        return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
                    }
                }
                await pool.query('UPDATE chats SET admin_id = $1 WHERE id = $2', [group.admin_id, groupId]);
            } else {
                await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                await pool.query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
                return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
            }
        }

        participants.splice(memberIndex, 1);
        await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(participants), groupId]);

        if (participants.length === 0) {
            await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
            await pool.query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
        }
        
        res.status(200).json({ message: 'غادرت المجموعة بنجاح.' });
    } catch (error) {
        console.error('ERROR: Leave group error:', error.stack);
        res.status(500).json({ error: 'فشل في مغادرة المجموعة.' });
    }
});

// تغيير اسم المجموعة
app.put('/api/groups/:groupId/name', async (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    try {
        const groupResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const caller = group.participants.find(p => p.uid === callerUid);
        if (!caller || caller.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بتغيير اسم المجموعة.' });
        }

        await pool.query('UPDATE chats SET name = $1 WHERE id = $2', [newName, groupId]);
        res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
    } catch (error) {
        console.error('ERROR: Change group name error:', error.stack);
        res.status(500).json({ error: 'فشل في تغيير اسم المجموعة.' });
    }
});


// بدء الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});

// --- وظائف PostgreSQL لإنشاء الجداول (يجب تشغيلها مرة واحدة فقط) ---
async function createTables() {
    try {
        // جدول المستخدمين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                uid UUID PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url TEXT,
                followers JSONB DEFAULT '[]'::jsonb,
                following JSONB DEFAULT '[]'::jsonb
            );
        `);
        console.log('INFO: Table "users" ensured to exist.');

        // جدول المنشورات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id UUID PRIMARY KEY,
                author_id UUID NOT NULL REFERENCES users(uid),
                author_name VARCHAR(255) NOT NULL,
                text TEXT,
                media_type VARCHAR(50),
                media_url TEXT,
                timestamp BIGINT NOT NULL,
                likes JSONB DEFAULT '[]'::jsonb,
                comments JSONB DEFAULT '[]'::jsonb,
                views JSONB DEFAULT '[]'::jsonb,
                author_profile_bg TEXT,
                follower_count INTEGER DEFAULT 0
            );
        `);
        console.log('INFO: Table "posts" ensured to exist.');

        // جدول المحادثات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id UUID PRIMARY KEY,
                type VARCHAR(50) NOT NULL, -- 'private' or 'group'
                name VARCHAR(255), -- for groups
                description TEXT, -- for groups
                admin_id UUID REFERENCES users(uid), -- for groups, admin of the group
                participants JSONB NOT NULL, -- array of {uid, name, customId, role, profileBgUrl, contactName}
                created_at BIGINT NOT NULL,
                profile_bg_url TEXT -- for group profile pic
            );
        `);
        console.log('INFO: Table "chats" ensured to exist.');

        // جدول الرسائل
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY,
                chat_id UUID NOT NULL REFERENCES chats(id),
                sender_id UUID NOT NULL REFERENCES users(uid),
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                media_type VARCHAR(50),
                media_url TEXT,
                timestamp BIGINT NOT NULL,
                sender_profile_bg TEXT
            );
        `);
        console.log('INFO: Table "messages" ensured to exist.');

        // إضافة بيانات تجريبية (إذا كانت الجداول فارغة)
        await setupInitialData();

    } catch (error) {
        console.error('ERROR: Error creating tables or setting up initial data:', error.stack);
        process.exit(1);
    }
}

// دالة لإضافة بيانات تجريبية (الآن ستضاف إلى PostgreSQL)
async function setupInitialData() {
    try {
        const userCountResult = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCountResult.rows[0].count) === 0) {
            const passwordHash1 = await bcrypt.hash('password123', 10);
            const passwordHash2 = await bcrypt.hash('password456', 10);
            const passwordHash3 = await bcrypt.hash('password789', 10);

            const user1 = { uid: uuidv4(), username: 'محمد', passwordHash: passwordHash1, customId: '12345678', profileBgUrl: null, followers: [], following: [] };
            const user2 = { uid: uuidv4(), username: 'أحمد', passwordHash: passwordHash2, customId: '87654321', profileBgUrl: null, followers: [], following: [] };
            const user3 = { uid: uuidv4(), username: 'فاطمة', passwordHash: passwordHash3, customId: '11223344', profileBgUrl: null, followers: [], following: [] };
            
            await pool.query(
                `INSERT INTO users (uid, username, password_hash, custom_id, profile_bg_url, followers, following) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [user1.uid, user1.username, user1.passwordHash, user1.customId, user1.profileBgUrl, JSON.stringify(user1.followers), JSON.stringify(user1.following)]
            );
            await pool.query(
                `INSERT INTO users (uid, username, password_hash, custom_id, profile_bg_url, followers, following) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [user2.uid, user2.username, user2.passwordHash, user2.customId, user2.profileBgUrl, JSON.stringify(user2.followers), JSON.stringify(user2.following)]
            );
            await pool.query(
                `INSERT INTO users (uid, username, password_hash, custom_id, profile_bg_url, followers, following) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [user3.uid, user3.username, user3.passwordHash, user3.customId, user3.profileBgUrl, JSON.stringify(user3.followers), JSON.stringify(user3.following)]
            );
            console.log('INFO: Added initial users to PostgreSQL.');

            // تحديث المتابعة (يجب جلب المستخدمين أولاً لتحديثهم)
            const usersInDbResult = await pool.query('SELECT uid, followers, following FROM users');
            const usersInDb = usersInDbResult.rows.reduce((acc, u) => { acc[u.uid] = u; return acc; }, {});

            // جعل محمد يتابع أحمد وفاطمة
            usersInDb[user1.uid].following = [...(usersInDb[user1.uid].following || []), user2.uid, user3.uid];
            usersInDb[user2.uid].followers = [...(usersInDb[user2.uid].followers || []), user1.uid];
            usersInDb[user3.uid].followers = [...(usersInDb[user3.uid].followers || []), user1.uid];

            // جعل أحمد يتابع محمد
            usersInDb[user2.uid].following = [...(usersInDb[user2.uid].following || []), user1.uid];
            usersInDb[user1.uid].followers = [...(usersInDb[user1.uid].followers || []), user2.uid];

            // تحديث المستخدمين بعد تغييرات المتابعة
            await pool.query('UPDATE users SET following = $1, followers = $2 WHERE uid = $3', [JSON.stringify(usersInDb[user1.uid].following), JSON.stringify(usersInDb[user1.uid].followers), user1.uid]);
            await pool.query('UPDATE users SET following = $1, followers = $2 WHERE uid = $3', [JSON.stringify(usersInDb[user2.uid].following), JSON.stringify(usersInDb[user2.uid].followers), user2.uid]);
            await pool.query('UPDATE users SET following = $1, followers = $2 WHERE uid = $3', [JSON.stringify(usersInDb[user3.uid].following), JSON.stringify(usersInDb[user3.uid].followers), user3.uid]);
            console.log('INFO: Updated user followings in PostgreSQL.');


            // إضافة منشورات افتراضية
            const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `http://localhost:${PORT}`;
            const dummyImageUrl = `${baseUrl}/uploads/dummy-image.jpg`;
            const dummyVideoUrl = `${baseUrl}/uploads/dummy-video.mp4`;

            const dummyImagePath = path.join(uploadsDir, 'dummy-image.jpg');
            const dummyVideoPath = path.join(uploadsDir, 'dummy-video.mp4');

            if (!fs.existsSync(dummyImagePath)) {
                fs.writeFileSync(dummyImagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", 'base64'));
                console.log('INFO: Created dummy-image.jpg in uploads.');
            }
            if (!fs.existsSync(dummyVideoPath)) {
                fs.writeFileSync(dummyVideoPath, Buffer.from(""));
                console.log('INFO: Created dummy-video.mp4 in uploads.');
            }

            const post1 = {
                id: uuidv4(),
                authorId: user1.uid,
                authorName: user1.username,
                text: 'أول منشور لي على وتسليجرم! 👋',
                mediaType: 'text',
                mediaUrl: null,
                timestamp: Date.now() - 50000,
                likes: [user2.uid],
                comments: [],
                views: [],
                authorProfileBg: user1.profileBgUrl,
                followerCount: (usersInDb[user1.uid].followers || []).length
            };

            const post2 = {
                id: uuidv4(),
                authorId: user2.uid,
                authorName: user2.username,
                text: 'يوم جميل في المدينة 🏙️',
                mediaType: 'text',
                mediaUrl: null,
                timestamp: Date.now() - 40000,
                likes: [],
                comments: [],
                views: [],
                authorProfileBg: user2.profileBgUrl,
                followerCount: (usersInDb[user2.uid].followers || []).length
            };

            const post3 = {
                id: uuidv4(),
                authorId: user1.uid,
                authorName: user1.username,
                text: 'صورة من رحلتي الأخيرة! 🏞️ (مؤقتة)',
                mediaType: 'image',
                mediaUrl: dummyImageUrl,
                timestamp: Date.now() - 30000,
                likes: [user2.uid, user3.uid],
                comments: [],
                views: [],
                authorProfileBg: user1.profileBgUrl,
                followerCount: (usersInDb[user1.uid].followers || []).length
            };
            const post4 = {
                id: uuidv4(),
                authorId: user3.uid,
                authorName: user3.username,
                text: 'فيديو رائع للطبيعة 🎥 (مؤقت)',
                mediaType: 'video',
                mediaUrl: dummyVideoUrl,
                timestamp: Date.now() - 20000,
                likes: [user1.uid],
                comments: [],
                views: [],
                authorProfileBg: user3.profileBgUrl,
                followerCount: (usersInDb[user3.uid].followers || []).length
            };

            await pool.query(
                `INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [post1.id, post1.authorId, post1.authorName, post1.text, post1.mediaType, post1.mediaUrl, post1.timestamp, JSON.stringify(post1.likes), JSON.stringify(post1.comments), JSON.stringify(post1.views), post1.authorProfileBg, post1.followerCount]
            );
            await pool.query(
                `INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [post2.id, post2.authorId, post2.authorName, post2.text, post2.mediaType, post2.mediaUrl, post2.timestamp, JSON.stringify(post2.likes), JSON.stringify(post2.comments), JSON.stringify(post2.views), post2.authorProfileBg, post2.followerCount]
            );
            await pool.query(
                `INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [post3.id, post3.authorId, post3.authorName, post3.text, post3.mediaType, post3.mediaUrl, post3.timestamp, JSON.stringify(post3.likes), JSON.stringify(post3.comments), JSON.stringify(post3.views), post3.authorProfileBg, post3.followerCount]
            );
            await pool.query(
                `INSERT INTO posts (id, author_id, author_name, text, media_type, media_url, timestamp, likes, comments, views, author_profile_bg, follower_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [post4.id, post4.authorId, post4.authorName, post4.text, post4.mediaType, post4.mediaUrl, post4.timestamp, JSON.stringify(post4.likes), JSON.stringify(post4.comments), JSON.stringify(post4.views), post4.authorProfileBg, post4.followerCount]
            );
            console.log('INFO: Added initial posts to PostgreSQL.');

            // إضافة محادثات افتراضية
            const chat1to2Id = uuidv4();
            const chat1to2Participants = [
                { uid: user1.uid, name: user1.username, customId: user1.customId, profileBgUrl: user1.profileBgUrl, contactName: user2.username },
                { uid: user2.uid, name: user2.username, customId: user2.customId, profileBgUrl: user2.profileBgUrl, contactName: user1.username }
            ];
            await pool.query(
                `INSERT INTO chats (id, type, participants, created_at) VALUES ($1, $2, $3, $4)`,
                [chat1to2Id, 'private', JSON.stringify(chat1to2Participants), Date.now() - 60000]
            );

            await pool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [uuidv4(), chat1to2Id, user1.uid, user1.username, 'مرحباً أحمد! كيف حالك؟', 'text', null, Date.now() - 59000, user1.profileBgUrl]
            );
            await pool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [uuidv4(), chat1to2Id, user2.uid, user2.username, 'أهلاً محمد! أنا بخير، شكراً لك. ماذا عنك؟', 'text', null, Date.now() - 58000, user2.profileBgUrl]
            );

            const group1Id = uuidv4();
            const group1Participants = [
                { uid: user1.uid, name: user1.username, customId: user1.customId, role: 'admin', profileBgUrl: user1.profileBgUrl },
                { uid: user2.uid, name: user2.username, customId: user2.customId, role: 'member', profileBgUrl: user2.profileBgUrl },
                { uid: user3.uid, name: user3.username, customId: user3.customId, role: 'member', profileBgUrl: user3.profileBgUrl }
            ];
            await pool.query(
                `INSERT INTO chats (id, type, name, description, admin_id, participants, created_at, profile_bg_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [group1Id, 'group', 'مجموعة الأصدقاء', 'مجموعة للتحدث مع الأصدقاء المقربين.', user1.uid, JSON.stringify(group1Participants), Date.now() - 70000, null]
            );

            await pool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [uuidv4(), group1Id, user1.uid, user1.username, 'مرحباً بالجميع في المجموعة!', 'text', null, Date.now() - 69000, user1.profileBgUrl]
            );
            await pool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, media_type, media_url, timestamp, sender_profile_bg) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [uuidv4(), group1Id, user3.uid, user3.username, 'أهلاً محمد! كيف حالكم جميعاً؟', 'text', null, Date.now() - 68000, user3.profileBgUrl]
            );
            console.log('INFO: Added initial chats and messages to PostgreSQL.');
        } else {
            console.log('INFO: PostgreSQL already contains data, skipping initial data setup.');
        }
    } catch (error) {
        console.error('ERROR: Error setting up initial data for PostgreSQL:', error.stack);
    }
}

// تشغيل دالة إنشاء الجداول والبيانات الأولية عند بدء تشغيل الخادم
createTables();
