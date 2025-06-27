// server.js (Backend)

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); // For handling file uploads (multipart/form-data)
const path = require('path'); // Node.js built-in module for path manipulation
const { Pool } = require('pg'); // PostgreSQL client for Node.js
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const fs = require('fs'); // Node.js File System module

const app = express();
const PORT = process.env.PORT || 10000; // Use process.env.PORT for Render, fallback to 10000 for local

// --- PostgreSQL Database Connection Pool ---
// Render will provide the DATABASE_URL environment variable.
// For local development, you can set it manually or use a local PostgreSQL instance.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // This is provided by Render automatically
    ssl: {
        rejectUnauthorized: false // Required for Render's PostgreSQL connection
    }
});

// Test PostgreSQL connection
pool.connect()
    .then(client => {
        console.log('Successfully connected to PostgreSQL database!');
        client.release(); // Release the client back to the pool
        // Initialize database schema (create tables if they don't exist)
        initializeDatabaseSchema();
    })
    .catch(err => {
        console.error('ERROR: Could not connect to PostgreSQL database:', err.message);
        process.exit(1); // Exit process if database connection fails
    });

// --- Initialize Database Schema ---
// هذا سيقوم بإنشاء الجداول إذا لم تكن موجودة.
// ستكون هذه الجداول في قاعدة بيانات PostgreSQL الخاصة بك على Render.
async function initializeDatabaseSchema() {
    try {
        const client = await pool.connect();
        await client.query(`
            -- جدول المستخدمين (Users Table)
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(225) PRIMARY KEY,
                username VARCHAR(225) UNIQUE NOT NULL,
                password VARCHAR(225) NOT NULL, -- يجب تشفيرها في تطبيق حقيقي!
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url VARCHAR(2048),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- جدول المتابعة (Follows Table)
            CREATE TABLE IF NOT EXISTS follows (
                follower_uid VARCHAR(225) NOT NULL,
                following_uid VARCHAR(225) NOT NULL,
                PRIMARY KEY (follower_uid, following_uid),
                FOREIGN KEY (follower_uid) REFERENCES users(uid) ON DELETE CASCADE,
                FOREIGN KEY (following_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول المحادثات (Chats Table)
            CREATE TABLE IF NOT EXISTS chats (
                id VARCHAR(225) PRIMARY KEY,
                type VARCHAR(50) NOT NULL, -- ENUM('private', 'group')
                name VARCHAR(225),
                description TEXT,
                admin_id VARCHAR(225),
                profile_bg_url VARCHAR(2048),
                last_message TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- جدول أعضاء المحادثات (ChatMembers Table)
            CREATE TABLE IF NOT EXISTS chat_members (
                chat_id VARCHAR(225) NOT NULL,
                member_uid VARCHAR(225) NOT NULL,
                role VARCHAR(50) DEFAULT 'member', -- ENUM('member', 'admin')
                contact_name VARCHAR(225),
                PRIMARY KEY (chat_id, member_uid),
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY (member_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول الرسائل (Messages Table)
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(225) PRIMARY KEY,
                chat_id VARCHAR(225) NOT NULL,
                sender_uid VARCHAR(225) NOT NULL,
                text TEXT,
                media_type VARCHAR(50), -- ENUM('image', 'video')
                media_url VARCHAR(2048),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(50) DEFAULT 'sent',
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY (sender_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول المنشورات (Posts Table)
            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(225) PRIMARY KEY,
                author_uid VARCHAR(225) NOT NULL,
                text TEXT,
                media_type VARCHAR(50), -- ENUM('image', 'video')
                media_url VARCHAR(2048),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (author_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول الإعجابات للمنشورات (PostLikes Table)
            CREATE TABLE IF NOT EXISTS post_likes (
                post_id VARCHAR(225) NOT NULL,
                user_uid VARCHAR(225) NOT NULL,
                PRIMARY KEY (post_id, user_uid),
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول التعليقات على المنشورات (Comments Table)
            CREATE TABLE IF NOT EXISTS comments (
                id VARCHAR(225) PRIMARY KEY,
                post_id VARCHAR(225) NOT NULL,
                user_uid VARCHAR(225) NOT NULL,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
            );

            -- جدول الإعجابات على التعليقات (CommentLikes Table)
            CREATE TABLE IF NOT EXISTS comment_likes (
                comment_id VARCHAR(225) NOT NULL,
                user_uid VARCHAR(225) NOT NULL,
                PRIMARY KEY (comment_id, user_uid),
                FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
                FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
            );
        `);
        console.log('PostgreSQL schema initialized successfully.');
    } catch (err) {
        console.error('ERROR: Failed to initialize PostgreSQL schema:', err);
    } finally {
        if (client) client.release();
    }
}

// --- CORS and Body Parser Middleware ---
app.use(cors()); // Allow all cross-origin requests
app.use(bodyParser.json()); // For parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// --- Multer for Local File Storage (Ephemeral on Render Free Tier) ---
// This storage will be CLEARED on every deploy/restart on Render's free tier.
// For persistent file storage, consider Render Disk or Cloudinary/Firebase Storage.
const uploadsDir = path.join(__dirname, 'uploads');
// إنشاء المجلد إذا لم يكن موجوداً
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
// إنشاء مجلدات فرعية للصور الشخصية والمنشورات والرسائل
const profileBgDir = path.join(uploadsDir, 'profile_backgrounds');
const postMediaDir = path.join(uploadsDir, 'post_media');
const chatMediaDir = path.join(uploadsDir, 'chat_media');
if (!fs.existsSync(profileBgDir)) fs.mkdirSync(profileBgDir);
if (!fs.existsSync(postMediaDir)) fs.mkdirSync(postMediaDir);
if (!fs.existsSync(chatMediaDir)) fs.mkdirSync(chatMediaDir);


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // تحديد مجلد الوجهة بناءً على نوع الرفع (يجب أن ترسله الواجهة الأمامية في formData.append('uploadType', '...'))
        if (req.body.uploadType === 'profileBg') {
            cb(null, profileBgDir);
        } else if (req.body.uploadType === 'postMedia') {
            cb(null, postMediaDir);
        } else if (req.body.uploadType === 'chatMedia') {
            cb(null, chatMediaDir);
        } else {
            cb(new Error('Invalid upload type specified for multer destination'), null);
        }
    },
    filename: (req, file, cb) => {
        // إنشاء اسم ملف فريد لمنع التعارض
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Serve Static Files ---
// هذا المسار سيجعل الملفات الموجودة في مجلد 'uploads' قابلة للوصول عبر الويب
// على سبيل المثال، إذا كان لديك ملف في uploads/profile_backgrounds/my_image.jpg
// فسيكون قابلاً للوصول عبر http://yourdomain.com/uploads/profile_backgrounds/my_image.jpg
app.use('/uploads', express.static(uploadsDir));

// --- Helper for generating custom IDs ---
async function generateCustomId() {
    let id;
    let userExists = true;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000).toString();
        const res = await pool.query('SELECT custom_id FROM users WHERE custom_id = $1 LIMIT 1', [id]);
        userExists = res.rows.length > 0;
    } while (userExists);
    return id;
}

// --- API Endpoints ---

// 1. User Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[Register] Attempt for username: ${username}`);

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const resCheck = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
        if (resCheck.rows.length > 0) {
            return res.status(409).json({ error: 'اسم المستخدم هذا موجود بالفعل.' });
        }

        const uid = uuidv4(); // Generate a UUID for the user ID
        const customId = await generateCustomId(); // Generate unique custom ID

        await pool.query(
            'INSERT INTO users (uid, username, password, custom_id) VALUES ($1, $2, $3, $4)',
            [uid, username, password, customId]
        );

        console.log(`[Register] New user created: ${username} (UID: ${uid}, Custom ID: ${customId})`);
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح.', user: { uid: uid, username: username, customId: customId } });

    } catch (error) {
        console.error("ERROR: Registering user:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء التسجيل.' });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[Login] Attempt for username: ${username}`);

    try {
        const resUser = await pool.query('SELECT uid, username, custom_id, password, profile_bg_url FROM users WHERE username = $1 LIMIT 1', [username]);

        if (resUser.rows.length === 0) {
            console.log(`[Login] Failed for username: ${username} (User not found)`);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        const user = resUser.rows[0];

        if (user.password !== password) { // In a real app, hash this password! (e.g., using bcrypt and compare)
            console.log(`[Login] Failed for username: ${username} (Incorrect password)`);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        // Fetch followers and following separately as they are in join tables
        const resFollowers = await pool.query('SELECT follower_uid FROM follows WHERE following_uid = $1', [user.uid]);
        const followers = resFollowers.rows.map(row => row.follower_uid);

        const resFollowing = await pool.query('SELECT following_uid FROM follows WHERE follower_uid = $1', [user.uid]);
        const following = resFollowing.rows.map(row => row.following_uid);

        console.log(`[Login] Successful for user: ${user.username} (UID: ${user.uid})`);
        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح.',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_bg_url,
                followers: followers,
                following: following
            }
        });
    } catch (error) {
        console.error("ERROR: Login Error:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول.' });
    }
});

// 3. Get User by Custom ID (Crucial for private chat initiation)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    console.log(`[GetUser] By Custom ID: ${customId}`);
    try {
        const resUser = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE custom_id = $1 LIMIT 1', [customId]);
        if (resUser.rows.length === 0) {
            console.log(`[GetUser] User with Custom ID '${customId}' not found.`);
            return res.status(404).json({ error: 'لم يتم العثور على مستخدم بهذا المعرف.' });
        }
        const user = resUser.rows[0];
        console.log(`[GetUser] Found user: ${user.username} (UID: ${user.uid}) for Custom ID: ${customId}`);
        res.status(200).json({ uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url });
    } catch (error) {
        console.error("ERROR: Getting user by custom ID:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء البحث عن المستخدم.' });
    }
});

// 4. Upload Profile Background
// إضافة 'uploadType' إلى حقول multer (يجب أن ترسله الواجهة الأمامية)
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    console.log(`[UploadProfileBg] Attempt for user: ${userId}`);

    if (!req.file) {
        return res.status(400).json({ error: 'لا يوجد ملف تم رفعه.' });
    }

    try {
        const resUser = await pool.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [userId]);
        if (resUser.rows.length === 0) {
            // إذا لم يتم العثور على المستخدم، احذف الملف المرفوع لمنع الملفات اليتيمة
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting orphaned file:', err);
            });
            console.log(`[UploadProfileBg] User not found: ${userId}, uploaded file deleted.`);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        // بناء الـ URL للملف المخزن محليًا (قابل للوصول من الويب عبر Express.static)
        const imageUrl = `/uploads/profile_backgrounds/${req.file.filename}`;
        
        await pool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [imageUrl, userId]);
        console.log(`[UploadProfileBg] User ${userId} profile background updated to: ${imageUrl}`);
        res.status(200).json({ message: 'تم تعيين الخلفية بنجاح.', url: imageUrl });

    } catch (error) {
        // إذا حدث خطأ، احذف الملف المرفوع
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting orphaned file on error:', err);
            });
        }
        console.error("ERROR: Uploading profile background:", error);
        res.status(500).json({ error: 'فشل رفع الخلفية.' });
    }
});

// 5. Get User's Profile Background
app.get('/api/user/:userId/profile-background', async (req, res) => {
    const { userId } = req.params;
    console.log(`[GetProfileBg] Attempt for user: ${userId}`);
    try {
        const resUser = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1 LIMIT 1', [userId]);
        if (resUser.rows.length === 0) {
            console.log(`[GetProfileBg] User not found: ${userId}`);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ url: resUser.rows[0].profile_bg_url || null });
    } catch (error) {
        console.error("ERROR: Getting profile background:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الخلفية.' });
    }
});

// 6. Get User's Follower Count
app.get('/api/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    try {
        const resCount = await pool.query('SELECT COUNT(*) AS count FROM follows WHERE following_uid = $1', [userId]);
        res.status(200).json({ count: resCount.rows[0].count });
    } catch (error) {
        console.error("ERROR: Getting follower count:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب عدد المتابعين.' });
    }
});

// 7. Toggle Follow/Unfollow
app.post('/api/user/:followerId/follow/:targetId', async (req, res) => {
    const { followerId, targetId } = req.params;
    console.log(`[ToggleFollow] Follower: ${followerId}, Target: ${targetId}`);

    if (followerId === targetId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    const client = await pool.connect(); // Get a client from the pool
    try {
        await client.query('BEGIN'); // Start transaction

        const resFollower = await client.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [followerId]);
        const resTargetUser = await client.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [targetId]);

        if (resFollower.rows.length === 0 || resTargetUser.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المستخدم (المتابع أو المستهدف) غير موجود.' });
        }

        const resExistingFollow = await client.query('SELECT * FROM follows WHERE follower_uid = $1 AND following_uid = $2', [followerId, targetId]);

        let message;
        let isFollowing;

        if (resExistingFollow.rows.length > 0) {
            await client.query('DELETE FROM follows WHERE follower_uid = $1 AND following_uid = $2', [followerId, targetId]);
            message = 'تم إلغاء المتابعة.';
            isFollowing = false;
            console.log(`[ToggleFollow] User ${followerId} unfollowed ${targetId}`);
        } else {
            await client.query('INSERT INTO follows (follower_uid, following_uid) VALUES ($1, $2)', [followerId, targetId]);
            message = 'تمت المتابعة بنجاح.';
            isFollowing = true;
            console.log(`[ToggleFollow] User ${followerId} followed ${targetId}`);
        }

        await client.query('COMMIT'); // Commit transaction
        res.status(200).json({ message, isFollowing: isFollowing });

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error("ERROR: Toggling follow status:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث حالة المتابعة.' });
    } finally {
        client.release(); // Release client back to pool
    }
});

// 8. Check Follow Status
app.get('/api/user/:followerId/following/:targetId', async (req, res) => {
    const { followerId, targetId } = req.params;
    try {
        const resFollow = await pool.query('SELECT * FROM follows WHERE follower_uid = $1 AND following_uid = $2', [followerId, targetId]);
        const isFollowing = resFollow.rows.length > 0;
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error("ERROR: Checking follow status:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء التحقق من حالة المتابعة.' });
    }
});

// 9. Get User's Contacts (for group creation and other features)
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    console.log(`[GetContacts] Attempt for user: ${userId}`);
    try {
        const resUser = await pool.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [userId]);
        if (resUser.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const resChatMembers = await pool.query(
            `SELECT DISTINCT cm.member_uid
             FROM chat_members cm
             JOIN chats c ON cm.chat_id = c.id
             WHERE c.type = 'private' AND c.id IN (
                 SELECT chat_id FROM chat_members WHERE member_uid = $1
             ) AND cm.member_uid != $1`,
            [userId]
        );
        const privateChatPartnersUids = resChatMembers.rows.map(row => row.member_uid);

        const contactsToDisplay = [];
        if (privateChatPartnersUids.length > 0) {
            const resContactUsers = await pool.query(
                `SELECT uid, username, custom_id FROM users WHERE uid = ANY($1::text[])`, // PostgreSQL specific for array IN
                [privateChatPartnersUids]
            );
            resContactUsers.rows.forEach(user => {
                contactsToDisplay.push({ uid: user.uid, username: user.username, customId: user.custom_id });
            });
        }
        
        console.log(`[GetContacts] Returning ${contactsToDisplay.length} actual contacts for user ${userId}.`);
        res.status(200).json(contactsToDisplay);
    } catch (error) {
        console.error("ERROR: Getting contacts:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب جهات الاتصال.' });
    }
});

// 10. Create Private Chat
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    console.log(`[CreatePrivateChat] Attempt between ${user1Id} and ${user2Id}`);

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع حقول المستخدمين واسم جهة الاتصال مطلوبة لإنشاء محادثة خاصة.' });
    }
    if (user1Id === user2Id) {
        return res.status(400).json({ error: 'لا يمكنك بدء محادثة فردية مع نفسك.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resUser1 = await client.query('SELECT uid, profile_bg_url FROM users WHERE uid = $1 LIMIT 1', [user1Id]);
        const resUser2 = await client.query('SELECT uid, profile_bg_url FROM users WHERE uid = $1 LIMIT 1', [user2Id]);

        if (resUser1.rows.length === 0 || resUser2.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'أحد المستخدمين أو كلاهما غير موجود.' });
        }

        // Check for existing chat
        const resExistingChat = await client.query(
            `SELECT c.id FROM chats c
             JOIN chat_members cm1 ON c.id = cm1.chat_id
             JOIN chat_members cm2 ON c.id = cm2.chat_id
             WHERE c.type = 'private' AND cm1.member_uid = $1 AND cm2.member_uid = $2`,
            [user1Id, user2Id]
        );

        if (resExistingChat.rows.length > 0) {
            await client.query('ROLLBACK');
            console.log(`[CreatePrivateChat] Existing private chat found: ${resExistingChat.rows[0].id}`);
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: resExistingChat.rows[0].id });
        }

        const user1ProfileBg = resUser1.rows[0].profile_bg_url;
        const user2ProfileBg = resUser2.rows[0].profile_bg_url;

        const chatId = uuidv4();
        await client.query(
            'INSERT INTO chats (id, type) VALUES ($1, $2)',
            [chatId, 'private']
        );

        // Insert chat members
        await client.query(
            'INSERT INTO chat_members (chat_id, member_uid, contact_name) VALUES ($1, $2, $3)',
            [chatId, user1Id, contactName]
        );
        await client.query(
            'INSERT INTO chat_members (chat_id, member_uid, contact_name) VALUES ($1, $2, $3)',
            [chatId, user2Id, user1Name] // The other user's contact name for user2 is user1's username
        );

        await client.query('COMMIT');
        console.log(`[CreatePrivateChat] New private chat created: ${chatId}`);
        res.status(201).json({ message: 'تم إنشاء المحادثة الخاصة بنجاح.', chatId: chatId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Creating private chat:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إنشاء المحادثة الخاصة.' });
    } finally {
        client.release();
    }
});

// API endpoint to update contact name in a private chat
app.put('/api/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;
    console.log(`[UpdateContactName] Chat: ${chatId}, User: ${userId}, New Name: ${newContactName}`);

    if (!userId || !newContactName) {
        return res.status(400).json({ error: 'معرف المستخدم والاسم الجديد مطلوبان.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resChat = await client.query('SELECT type FROM chats WHERE id = $1 LIMIT 1', [chatId]);
        if (resChat.rows.length === 0 || resChat.rows[0].type !== 'private') {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
        }

        const resMember = await client.query('SELECT * FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [chatId, userId]);
        if (resMember.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه المحادثة.' });
        }

        await client.query('UPDATE chat_members SET contact_name = $1 WHERE chat_id = $2 AND member_uid = $3', [newContactName, chatId, userId]);
        
        await client.query('COMMIT');
        console.log(`[UpdateContactName] Contact name for chat ${chatId} updated by user ${userId} to: ${newContactName}`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Updating contact name:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث اسم جهة الاتصال.' });
    } finally {
        client.release();
    }
});


// 11. Create Group Chat
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;
    console.log(`[CreateGroup] Attempt for group: ${name}, Admin: ${adminId}`);

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، المشرف، وعضوين على الأقل مطلوبون لإنشاء المجموعة.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
         return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً في المجموعة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const groupId = uuidv4();
        await client.query(
            'INSERT INTO chats (id, type, name, description, admin_id) VALUES ($1, $2, $3, $4, $5)',
            [groupId, 'group', name, description || null, adminId]
        );

        for (const memberUid in members) {
            await client.query(
                'INSERT INTO chat_members (chat_id, member_uid, role) VALUES ($1, $2, $3)',
                [groupId, memberUid, members[memberUid]]
            );
        }

        await client.query('COMMIT');
        console.log(`[CreateGroup] New group created: ${groupId} (Name: ${name})`);
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: groupId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Creating group:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إنشاء المجموعة.' });
    } finally {
        client.release();
    }
});

// API endpoint to update group name
app.put('/api/groups/:groupId/name', async (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;
    console.log(`[UpdateGroupName] Group: ${groupId}, New Name: ${newName}, Caller: ${callerUid}`);

    if (!newName) {
        return res.status(400).json({ error: 'الاسم الجديد للمجموعة مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT type FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resCallerRole = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, callerUid]);
        if (resCallerRole.rows.length === 0 || resCallerRole.rows[0].role !== 'admin') {
            await client.query('ROLLBACK');
            console.log(`[UpdateGroupName] Caller ${callerUid} is not an admin for group ${groupId}`);
            return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير اسم المجموعة.' });
        }

        await client.query('UPDATE chats SET name = $1 WHERE id = $2', [newName, groupId]);
        
        await client.query('COMMIT');
        console.log(`[UpdateGroupName] Group ${groupId} name updated to: ${newName}`);
        res.status(200).json({ message: 'تم تحديث اسم المجموعة بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Updating group name:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث اسم المجموعة.' });
    } finally {
        client.release();
    }
});

// API endpoint to add members to a group
app.post('/api/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;
    console.log(`[AddGroupMembers] Group: ${groupId}, New Members: ${newMemberUids}, Caller: ${callerUid}`);

    if (!newMemberUids || !Array.isArray(newMemberUids) || newMemberUids.length === 0) {
        return res.status(400).json({ error: 'معرفات الأعضاء الجدد مطلوبة.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT type FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resCallerRole = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, callerUid]);
        if (resCallerRole.rows.length === 0 || resCallerRole.rows[0].role !== 'admin') {
            await client.query('ROLLBACK');
            console.log(`[AddGroupMembers] Caller ${callerUid} is not an admin for group ${groupId}`);
            return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى المجموعة.' });
        }

        const addedMembers = [];
        for (const memberUid of newMemberUids) {
            const resMemberExists = await client.query('SELECT * FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, memberUid]);
            if (resMemberExists.rows.length === 0) {
                await client.query('INSERT INTO chat_members (chat_id, member_uid, role) VALUES ($1, $2, $3)', [groupId, memberUid, 'member']);
                addedMembers.push(memberUid);
                console.log(`[AddGroupMembers] Added member ${memberUid} to group ${groupId}`);
            }
        }

        if (addedMembers.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'جميع الأعضاء المحددين موجودون بالفعل في المجموعة.' });
        }

        await client.query('COMMIT');
        console.log(`[AddGroupMembers] Successfully added ${addedMembers.length} members to group ${groupId}.`);
        res.status(200).json({ message: 'تم إضافة الأعضاء بنجاح.', addedMembersUids: addedMembers });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Adding group members:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إضافة أعضاء إلى المجموعة.' });
    } finally {
        client.release();
    }
});


// 12. Get User's Chat List
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    console.log(`[GetUserChats] Attempt for user: ${userId}`);
    try {
        const resUser = await pool.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [userId]);
        if (resUser.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const resChats = await pool.query(
            `SELECT c.id, c.type, c.name, c.profile_bg_url, c.last_message, c.timestamp, cm.contact_name
             FROM chats c
             JOIN chat_members cm ON c.id = cm.chat_id
             WHERE cm.member_uid = $1
             ORDER BY c.timestamp DESC`,
            [userId]
        );

        const formattedChats = [];
        for (const chatRow of resChats.rows) {
            let chatNameForDisplay;
            let chatCustomIdForDisplay = null;
            let chatProfileBgForDisplay = chatRow.profile_bg_url; // Default for groups

            if (chatRow.type === 'private') {
                const resOtherMember = await pool.query(
                    `SELECT u.username, u.custom_id, u.profile_bg_url
                     FROM chat_members cm
                     JOIN users u ON cm.member_uid = u.uid
                     WHERE cm.chat_id = $1 AND cm.member_uid != $2 LIMIT 1`,
                    [chatRow.id, userId]
                );
                const otherUser = resOtherMember.rows[0];

                chatNameForDisplay = chatRow.contact_name || otherUser?.username || 'مستخدم غير معروف';
                chatCustomIdForDisplay = otherUser?.custom_id || null;
                chatProfileBgForDisplay = otherUser?.profile_bg_url || null; // For private chats, use other user's profile bg

            } else { // Group chat
                chatNameForDisplay = chatRow.name;
            }

            formattedChats.push({
                id: chatRow.id,
                type: chatRow.type,
                name: chatNameForDisplay,
                customId: chatCustomIdForDisplay,
                lastMessage: chatRow.last_message || 'لا توجد رسائل بعد.',
                timestamp: chatRow.timestamp ? new Date(chatRow.timestamp).getTime() : 0, // Convert PostgreSQL timestamp to JS timestamp
                profileBg: chatProfileBgForDisplay
            });
        }

        console.log(`[GetUserChats] Returning ${formattedChats.length} chats for user ${userId}.`);
        res.status(200).json(formattedChats);

    } catch (error) {
        console.error("ERROR: Getting user chats:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب قائمة المحادثات.' });
    }
});

// 13. Get Messages for a Chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0;
    console.log(`[GetMessages] Chat: ${chatId}, Since: ${since}`);

    try {
        const resMessages = await pool.query(
            `SELECT m.id, m.chat_id, m.sender_uid, u.username AS senderName, m.text, m.media_type, m.media_url, m.timestamp, m.status, u.profile_bg_url AS senderProfileBg
             FROM messages m
             JOIN users u ON m.sender_uid = u.uid
             WHERE m.chat_id = $1 AND m.timestamp > to_timestamp($2 / 1000.0)
             ORDER BY m.timestamp ASC`,
            [chatId, since] // since is already in milliseconds from frontend
        );

        const chatMessages = resMessages.rows.map(msg => ({
            id: msg.id,
            chatId: msg.chat_id,
            senderId: msg.sender_uid,
            senderName: msg.sendername, // PostgreSQL converts to lowercase by default
            text: msg.text,
            mediaType: msg.media_type,
            mediaUrl: msg.media_url ? `${req.protocol}://${req.get('host')}${msg.media_url}` : null, // Full URL for media
            senderProfileBg: msg.senderprofilebg || null, // PostgreSQL converts to lowercase
            timestamp: new Date(msg.timestamp).getTime(), // Convert PostgreSQL timestamp to JS timestamp
            status: msg.status
        }));
        
        console.log(`[GetMessages] Returning ${chatMessages.length} messages for chat ${chatId}.`);
        res.status(200).json(chatMessages);

    } catch (error) {
        console.error("ERROR: Getting messages:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الرسائل.' });
    }
});

// 14. Send Message to a Chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, text, mediaType } = req.body; // senderName and senderProfileBg will be fetched from DB
    const mediaFile = req.file;
    console.log(`[SendMessage] Chat: ${chatId}, SenderId: ${senderId}, Text length: ${text?.length || 0}, Media: ${mediaFile ? 'Yes' : 'No'}`);

    if (!senderId || (text === undefined && !mediaFile)) {
        // If file was uploaded, delete it
        if (mediaFile) fs.unlinkSync(mediaFile.path);
        return res.status(400).json({ error: 'معرف المرسل أو نص الرسالة أو ملف الوسائط مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resChat = await client.query('SELECT id, type FROM chats WHERE id = $1 LIMIT 1', [chatId]);
        if (resChat.rows.length === 0) {
            await client.query('ROLLBACK');
            // If file was uploaded, delete it
            if (mediaFile) fs.unlinkSync(mediaFile.path);
            console.log(`[SendMessage] Chat not found: ${chatId}`);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }
        
        let mediaUrl = null;
        if (mediaFile) {
            mediaUrl = `/uploads/chat_media/${mediaFile.filename}`;
        }

        const messageId = uuidv4();
        await client.query(
            'INSERT INTO messages (id, chat_id, sender_uid, text, media_type, media_url, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [messageId, chatId, senderId, text || null, mediaType || null, mediaUrl, 'sent']
        );

        // Update last_message and timestamp in chats table
        await client.query(
            'UPDATE chats SET last_message = $1, timestamp = CURRENT_TIMESTAMP WHERE id = $2',
            [text || (mediaType === 'image' ? 'صورة' : 'فيديو'), chatId]
        );

        await client.query('COMMIT');
        console.log(`[SendMessage] Message sent to chat ${chatId} by ${senderId}.`);
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageId: messageId });

    } catch (error) {
        await client.query('ROLLBACK');
        // If file was uploaded, delete it on error
        if (mediaFile) {
            fs.unlink(mediaFile.path, (err) => {
                if (err) console.error('Error deleting orphaned media file on error:', err);
            });
        }
        console.error("ERROR: Sending message:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة.' });
    } finally {
        client.release();
    }
});

// 15. DELETE Chat / Leave Group Endpoints (PostgreSQL adapted)

// Delete a post
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    console.log(`[DeletePost] Attempting to delete post: ${postId}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get media URL before deleting the post
        const resPost = await client.query('SELECT media_url FROM posts WHERE id = $1 LIMIT 1', [postId]);
        const mediaUrlToDelete = resPost.rows.length > 0 ? resPost.rows[0].media_url : null;

        const resDelete = await client.query('DELETE FROM posts WHERE id = $1', [postId]);

        if (resDelete.rowCount > 0) {
            // Delete associated comments and likes will cascade due to FOREIGN KEY ON DELETE CASCADE

            // Delete media file from local storage if it exists
            if (mediaUrlToDelete && mediaUrlToDelete.startsWith('/uploads/post_media/')) {
                const filePath = path.join(__dirname, mediaUrlToDelete);
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting post media file:', err);
                    else console.log(`Deleted file: ${filePath}`);
                });
            }
            await client.query('COMMIT');
            console.log(`[DeletePost] Post ${postId} deleted successfully.`);
            res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
        } else {
            await client.query('ROLLBACK');
            console.log(`[DeletePost] Post ${postId} not found.`);
            res.status(404).json({ error: 'المنشور غير موجود.' });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Deleting post:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف المنشور.' });
    } finally {
        client.release();
    }
});


// Delete private chat for a specific user (client-side simulation for in-memory DB)
app.delete('/api/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;
    console.log(`[DeleteChat] Attempting to delete chat ${chatId} for user ${userId} only.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resChatMembers = await client.query('SELECT * FROM chat_members WHERE chat_id = $1 AND member_uid = $2', [chatId, userId]);
        if (resChatMembers.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليس لديك صلاحية الوصول إليها.' });
        }

        // Remove the member from the chat_members table
        await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND member_uid = $2', [chatId, userId]);

        // Check if the chat still has members (for private chats, if 0 or 1 left)
        const resRemainingMembers = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1', [chatId]);
        
        if (resRemainingMembers.rows[0].count === '0') { // PostgreSQL returns count as string
            // No members left, delete the chat and its messages
            // ON DELETE CASCADE on chat_members table for chat_id will handle this
            const resMedia = await client.query('SELECT media_url FROM messages WHERE chat_id = $1 AND media_url IS NOT NULL', [chatId]);
            await client.query('DELETE FROM chats WHERE id = $1', [chatId]);

            resMedia.rows.forEach(row => {
                if (row.media_url && row.media_url.startsWith('/uploads/chat_media/')) {
                    const filePath = path.join(__dirname, row.media_url);
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting chat media file:', err);
                    });
                }
            });

            await client.query('COMMIT');
            console.log(`[DeleteChat] Chat ${chatId} deleted because no members left after user ${userId} deleted.`);
            res.status(200).json({ message: 'تم حذف المحادثة من عندك وتم حذفها بالكامل لعدم وجود أعضاء.' });
        } else {
            await client.query('COMMIT');
            console.log(`[DeleteChat] Acknowledged "delete for me" request for chat ${chatId} by user ${userId}. (User removed from chat, chat still exists)`);
            res.status(200).json({ message: 'تم حذف المحادثة من عندك فقط (لن تراها بعد الآن).' });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Deleting chat for user:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف المحادثة من عندك.' });
    } finally {
        client.release();
    }
});

// Delete private chat for both users
app.delete('/api/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;
    console.log(`[DeleteChat] Attempting to delete private chat ${chatId} for both, caller: ${callerUid}.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resChat = await client.query('SELECT type FROM chats WHERE id = $1 AND type = \'private\' LIMIT 1', [chatId]);
        if (resChat.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
        }

        // Check if caller is a member of this chat
        const resMember = await client.query('SELECT * FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [chatId, callerUid]);
        if (resMember.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });
        }

        // Get all media URLs from messages in this chat before deleting messages
        const resMedia = await client.query('SELECT media_url FROM messages WHERE chat_id = $1 AND media_url IS NOT NULL', [chatId]);
        
        // Delete chat and all related data (members, messages, etc.) due to ON DELETE CASCADE
        await client.query('DELETE FROM chats WHERE id = $1', [chatId]);

        // Delete associated media files from local storage
        resMedia.rows.forEach(row => {
            if (row.media_url && row.media_url.startsWith('/uploads/chat_media/')) {
                const filePath = path.join(__dirname, row.media_url);
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting chat media file:', err);
                    else console.log(`Deleted chat file: ${filePath}`);
                });
            }
        });

        await client.query('COMMIT');
        console.log(`[DeleteChat] Deleted private chat ${chatId} for both users.`);
        res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Deleting private chat for both:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف المحادثة من الطرفين.' });
    } finally {
        client.release();
    }
});

// Leave group chat
app.delete('/api/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;
    console.log(`[LeaveGroup] User ${memberUid} attempting to leave group ${groupId}.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT admin_id FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        
        const resMemberInGroup = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, memberUid]);
        if (resMemberInGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'العضو ليس جزءًا من هذه المجموعة.' });
        }

        // Prevent leaving if it's the only admin
        if (resMemberInGroup.rows[0].role === 'admin') {
            const resAdminCount = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1 AND role = \'admin\'', [groupId]);
            if (resAdminCount.rows[0].count === '1') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكن للمشرف الوحيد مغادرة المجموعة مباشرة دون تعيين مشرف آخر أو حذف المجموعة.' });
            }
        }

        // Remove member from chat_members
        await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND member_uid = $2', [groupId, memberUid]);
        console.log(`[LeaveGroup] User ${memberUid} removed from group ${groupId}.`);

        // Check if group should be deleted (no members left)
        const resRemainingMembersCount = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1', [groupId]);

        if (resRemainingMembersCount.rows[0].count === '0') {
            const resMedia = await client.query('SELECT media_url FROM messages WHERE chat_id = $1 AND media_url IS NOT NULL', [groupId]);
            await client.query('DELETE FROM chats WHERE id = $1', [groupId]); // Deletes messages and members via CASCADE
            
            resMedia.rows.forEach(row => {
                if (row.media_url && row.media_url.startsWith('/uploads/chat_media/')) {
                    const filePath = path.join(__dirname, row.media_url);
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting chat media file:', err);
                    });
                }
            });

            await client.query('COMMIT');
            console.log(`[LeaveGroup] Group ${groupId} deleted because no members left.`);
            return res.status(200).json({ message: 'لقد غادرت المجموعة وتم حذفها لعدم وجود أعضاء.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'لقد غادرت المجموعة بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Leaving group:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء مغادرة المجموعة.' });
    } finally {
        client.release();
    }
});

// Delete group chat (admin action)
app.delete('/api/group/:groupId/delete', async (req, res) => {
    const { groupId } = req.params;
    const { callerUid } = req.body;
    console.log(`[DeleteGroup] Admin ${callerUid} attempting to delete group ${groupId}.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT admin_id FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resCallerRole = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, callerUid]);
        if (resCallerRole.rows.length === 0 || resCallerRole.rows[0].role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المجموعة.' });
        }

        // Get all media URLs from messages in this group chat before deleting messages
        const resMedia = await client.query('SELECT media_url FROM messages WHERE chat_id = $1 AND media_url IS NOT NULL', [groupId]);
        
        // Delete chat and all related data (members, messages, etc.) due to ON DELETE CASCADE
        await client.query('DELETE FROM chats WHERE id = $1', [groupId]);

        // Delete associated media files from local storage
        resMedia.rows.forEach(row => {
            if (row.media_url && row.media_url.startsWith('/uploads/chat_media/')) {
                const filePath = path.join(__dirname, row.media_url);
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting chat media file:', err);
                });
            }
        });

        await client.query('COMMIT');
        console.log(`[DeleteGroup] Group ${groupId} and its associated data deleted by admin ${callerUid}.`);
        res.status(200).json({ message: 'تم حذف المجموعة بالكامل بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Deleting group:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف المجموعة.' });
    } finally {
        client.release();
    }
});


// 16. Get Group Members (and their roles)
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    console.log(`[GetGroupMembers] Group: ${groupId}`);
    try {
        const resGroup = await pool.query('SELECT type FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resMembers = await pool.query(
            `SELECT cm.member_uid AS uid, u.username, u.custom_id, cm.role
             FROM chat_members cm
             JOIN users u ON cm.member_uid = u.uid
             WHERE cm.chat_id = $1`,
            [groupId]
        );
        const membersInfo = resMembers.rows.map(row => ({
            uid: row.uid,
            username: row.username,
            customId: row.custom_id,
            role: row.role
        }));
        console.log(`[GetGroupMembers] Returning ${membersInfo.length} members for group ${groupId}.`);
        res.status(200).json(membersInfo);

    } catch (error) {
        console.error("ERROR: Getting group members:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب أعضاء المجموعة.' });
    }
});

// 17. Change Group Member Role (Admin only)
app.put('/api/group/:groupId/members/:memberId/role', async (req, res) => {
    const { groupId, memberId } = req.params;
    const { newRole, callerUid } = req.body;
    console.log(`[ChangeMemberRole] Group: ${groupId}, Member: ${memberId}, New Role: ${newRole}, Caller: ${callerUid}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT id FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resCallerRole = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, callerUid]);
        if (resCallerRole.rows.length === 0 || resCallerRole.rows[0].role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير أدوار الأعضاء.' });
        }

        const resMemberInGroup = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, memberId]);
        if (resMemberInGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        // Prevent demoting the only admin if there's only one left
        if (newRole === 'member' && resMemberInGroup.rows[0].role === 'admin') {
            const resAdminCount = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1 AND role = \'admin\'', [groupId]);
            if (resAdminCount.rows[0].count === '1') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
            }
        }

        await client.query('UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND member_uid = $3', [newRole, groupId, memberId]);
        
        await client.query('COMMIT');
        console.log(`[ChangeMemberRole] Member ${memberId} role changed to ${newRole} in group ${groupId}.`);
        res.status(200).json({ message: `تم تغيير دور العضو إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Changing member role:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تغيير دور العضو.' });
    } finally {
        client.release();
    }
});

// 18. Remove Group Member (Admin only)
app.delete('/api/group/:groupId/members/:memberId', async (req, res) => {
    const { groupId, memberId } = req.params;
    const { callerUid } = req.body;
    console.log(`[RemoveGroupMember] Group: ${groupId}, Member: ${memberId}, Caller: ${callerUid}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resGroup = await client.query('SELECT id FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const resCallerRole = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, callerUid]);
        if (resCallerRole.rows.length === 0 || resCallerRole.rows[0].role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة الأعضاء.' });
        }

        const resMemberInGroup = await client.query('SELECT role FROM chat_members WHERE chat_id = $1 AND member_uid = $2 LIMIT 1', [groupId, memberId]);
        if (resMemberInGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        // Prevent removing the only admin if there's only one left
        if (resMemberInGroup.rows[0].role === 'admin') {
            const resAdminCount = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1 AND role = \'admin\'', [groupId]);
            if (resAdminCount.rows[0].count === '1') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
            }
        }

        await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND member_uid = $2', [groupId, memberId]);
        console.log(`[RemoveGroupMember] Member ${memberId} removed from group ${groupId}.`);

        const resRemainingMembersCount = await client.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1', [groupId]);
        
        if (resRemainingMembersCount.rows[0].count === '0') {
            const resMedia = await client.query('SELECT media_url FROM messages WHERE chat_id = $1 AND media_url IS NOT NULL', [groupId]);
            await client.query('DELETE FROM chats WHERE id = $1', [groupId]); // Deletes messages via CASCADE
            
            resMedia.rows.forEach(row => {
                if (row.media_url && row.media_url.startsWith('/uploads/chat_media/')) {
                    const filePath = path.join(__dirname, row.media_url);
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting chat media file:', err);
                    });
                }
            });

            await client.query('COMMIT');
            console.log(`[RemoveGroupMember] Group ${groupId} deleted due to no members left.`);
            return res.status(200).json({ message: 'تمت إزالة العضو وتم حذف المجموعة لعدم وجود أعضاء.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'تمت إزالة العضو بنجاح.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Removing group member:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إزالة العضو.' });
    } finally {
        client.release();
    }
});

// 19. Get Group Member Count
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const resGroup = await pool.query('SELECT id FROM chats WHERE id = $1 AND type = \'group\' LIMIT 1', [groupId]);
        if (resGroup.rows.length === 0) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        const resCount = await pool.query('SELECT COUNT(*) AS count FROM chat_members WHERE chat_id = $1', [groupId]);
        res.status(200).json({ count: resCount.rows[0].count });
    } catch (error) {
        console.error("ERROR: Getting group member count:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب عدد أعضاء المجموعة.' });
    }
});

// --- Posts API (PostgreSQL adapted) ---

// Get all posts or filtered posts
app.get('/api/posts', async (req, res) => {
    try {
        const resPosts = await pool.query(
            `SELECT p.id, p.author_uid, u.username AS authorName, p.text, p.media_type, p.media_url, p.timestamp, u.profile_bg_url AS authorProfileBg,
                    (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS likes_count,
                    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
                    (SELECT COUNT(*) FROM follows WHERE following_uid = p.author_uid) AS follower_count
             FROM posts p
             JOIN users u ON p.author_uid = u.uid
             ORDER BY p.timestamp DESC`
        );

        const formattedPosts = resPosts.rows.map(p => ({
            id: p.id,
            authorId: p.author_uid,
            authorName: p.authorname, // PostgreSQL converts to lowercase by default
            text: p.text,
            mediaType: p.media_type,
            mediaUrl: p.media_url ? `${req.protocol}://${req.get('host')}${p.media_url}` : null, // Full URL for media
            authorProfileBg: p.authorprofilebg || null, // PostgreSQL converts to lowercase
            timestamp: new Date(p.timestamp).getTime(), // Convert PostgreSQL timestamp to JS timestamp
            likes: parseInt(p.likes_count),
            comments: parseInt(p.comments_count),
            views: 0, // Views are not tracked in DB yet, keep as 0 or implement
            followerCount: parseInt(p.follower_count) || 0
        }));

        console.log(`[GetPosts] Returning ${formattedPosts.length} total posts.`);
        res.status(200).json(formattedPosts);

    } catch (error) {
        console.error("ERROR: Getting posts:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب المنشورات.' });
    }
});

// Get posts from followed users
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const resUser = await pool.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [userId]);
        if (resUser.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const resFollowedPosts = await pool.query(
            `SELECT p.id, p.author_uid, u.username AS authorName, p.text, p.media_type, p.media_url, p.timestamp, u.profile_bg_url AS authorProfileBg,
                    (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS likes_count,
                    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
                    (SELECT COUNT(*) FROM follows WHERE following_uid = p.author_uid) AS follower_count
             FROM posts p
             JOIN users u ON p.author_uid = u.uid
             JOIN follows f ON p.author_uid = f.following_uid
             WHERE f.follower_uid = $1
             ORDER BY p.timestamp DESC`,
            [userId]
        );

        const formattedPosts = resFollowedPosts.rows.map(p => ({
            id: p.id,
            authorId: p.author_uid,
            authorName: p.authorname,
            text: p.text,
            mediaType: p.media_type,
            mediaUrl: p.media_url ? `${req.protocol}://${req.get('host')}${p.media_url}` : null,
            authorProfileBg: p.authorprofilebg || null,
            timestamp: new Date(p.timestamp).getTime(),
            likes: parseInt(p.likes_count),
            comments: parseInt(p.comments_count),
            views: 0,
            followerCount: parseInt(p.follower_count) || 0
        }));

        console.log(`[GetFollowedPosts] Returning ${formattedPosts.length} posts for followed users of ${userId}.`);
        res.status(200).json(formattedPosts);

    } catch (error) {
        console.error("ERROR: Getting followed posts:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب منشورات المتابعين.' });
    }
});


// Add a new post
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, text, mediaType } = req.body;
    const mediaFile = req.file;
    console.log(`[AddPost] AuthorId: ${authorId}, Text length: ${text?.length || 0}, Media: ${mediaFile ? 'Yes' : 'No'}`);

    if (!authorId || (!text && !mediaFile)) {
        // If file was uploaded, delete it
        if (mediaFile) fs.unlinkSync(mediaFile.path);
        return res.status(400).json({ error: 'معرف الكاتب ونص المنشور أو ملف الوسائط مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resUser = await client.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [authorId]);
        if (resUser.rows.length === 0) {
            await client.query('ROLLBACK');
            if (mediaFile) fs.unlinkSync(mediaFile.path); // Delete uploaded file if user not found
            return res.status(404).json({ error: 'المؤلف غير موجود.' });
        }

        let mediaUrl = null;
        if (mediaFile) {
            mediaUrl = `/uploads/post_media/${mediaFile.filename}`;
        }

        const postId = uuidv4();
        await client.query(
            'INSERT INTO posts (id, author_uid, text, media_type, media_url) VALUES ($1, $2, $3, $4, $5)',
            [postId, authorId, text || null, mediaType || null, mediaUrl]
        );

        await client.query('COMMIT');
        console.log(`[AddPost] New post created: ${postId}`);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح.', postId: postId });

    } catch (error) {
        await client.query('ROLLBACK');
        if (mediaFile) {
            fs.unlink(mediaFile.path, (err) => { // Delete uploaded file on error
                if (err) console.error('Error deleting orphaned post media file on error:', err);
            });
        }
        console.error("ERROR: Adding post:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء نشر المنشور.' });
    } finally {
        client.release();
    }
});

// Toggle post like
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    console.log(`[ToggleLike] Post: ${postId}, User: ${userId}`);

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resPost = await client.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
        if (resPost.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const resExistingLike = await client.query('SELECT * FROM post_likes WHERE post_id = $1 AND user_uid = $2', [postId, userId]);

        let isLiked;
        if (resExistingLike.rows.length > 0) {
            await client.query('DELETE FROM post_likes WHERE post_id = $1 AND user_uid = $2', [postId, userId]);
            isLiked = false;
            console.log(`[ToggleLike] User ${userId} unliked post ${postId}.`);
        } else {
            await client.query('INSERT INTO post_likes (post_id, user_uid) VALUES ($1, $2)', [postId, userId]);
            isLiked = true;
            console.log(`[ToggleLike] User ${userId} liked post ${postId}.`);
        }

        const resLikesCount = await client.query('SELECT COUNT(*) AS count FROM post_likes WHERE post_id = $1', [postId]);
        const likesCount = parseInt(resLikesCount.rows[0].count);

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', isLiked, likesCount: likesCount });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Toggling post like:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث الإعجاب بالمنشور.' });
    } finally {
        client.release();
    }
});

// Increment post view count (Requires a new 'post_views' table if truly tracking distinct views)
// For simplicity, this is not fully implemented in schema, but can be added.
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    console.log(`[IncrementView] Post: ${postId}, User: ${userId}`);

    try {
        const resPost = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
        if (resPost.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }
        // In a real app, you'd insert/update a `post_views` table here
        // For now, returning dummy data
        res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح (محاكاة).', viewCount: 0 });
    } catch (error) {
        console.error("ERROR: Incrementing view:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث المشاهدات.' });
    }
});

// Add comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    console.log(`[AddComment] Post: ${postId}, User: ${username}, Text length: ${text?.length || 0}`);

    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'معرف المستخدم، اسم المستخدم، ونص التعليق مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resPost = await client.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
        if (resPost.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const resUser = await client.query('SELECT profile_bg_url FROM users WHERE uid = $1 LIMIT 1', [userId]);
        const userProfileBg = resUser.rows.length > 0 ? resUser.rows[0].profile_bg_url : null;

        const commentId = uuidv4();
        await client.query(
            'INSERT INTO comments (id, post_id, user_uid, text) VALUES ($1, $2, $3, $4)',
            [commentId, postId, userId, text]
        );
        
        await client.query('COMMIT');
        console.log(`[AddComment] New comment added to post ${postId}.`);
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', commentId: commentId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Adding comment:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء إضافة التعليق.' });
    } finally {
        client.release();
    }
});

// Get comments for a post
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    console.log(`[GetComments] Post: ${postId}`);
    try {
        const resPost = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
        if (resPost.rows.length === 0) {
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const resComments = await pool.query(
            `SELECT c.id, c.post_id, c.user_uid AS "userId", u.username AS "user", u.profile_bg_url AS "userProfileBg", c.text, c.timestamp,
                    (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS likes_count
             FROM comments c
             JOIN users u ON c.user_uid = u.uid
             WHERE c.post_id = $1
             ORDER BY c.timestamp ASC`,
            [postId]
        );

        const comments = resComments.rows.map(comment => ({
            id: comment.id,
            postId: comment.post_id,
            userId: comment.userId,
            user: comment.user,
            userProfileBg: comment.userProfileBg || null,
            text: comment.text,
            timestamp: new Date(comment.timestamp).getTime(),
            likes: parseInt(comment.likes_count)
        }));

        console.log(`[GetComments] Returning ${comments.length} comments for post ${postId}.`);
        res.status(200).json(comments);

    } catch (error) {
        console.error("ERROR: Getting comments:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب التعليقات.' });
    }
});

// Toggle comment like
app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    console.log(`[ToggleCommentLike] Post: ${postId}, Comment: ${commentId}, User: ${userId}`);

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const resComment = await client.query('SELECT id FROM comments WHERE id = $1 AND post_id = $2 LIMIT 1', [commentId, postId]);
        if (resComment.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        const resExistingLike = await client.query('SELECT * FROM comment_likes WHERE comment_id = $1 AND user_uid = $2', [commentId, userId]);

        let isLiked;
        if (resExistingLike.rows.length > 0) {
            await client.query('DELETE FROM comment_likes WHERE comment_id = $1 AND user_uid = $2', [commentId, userId]);
            isLiked = false;
            console.log(`[ToggleCommentLike] User ${userId} unliked comment ${commentId}.`);
        } else {
            await client.query('INSERT INTO comment_likes (comment_id, user_uid) VALUES ($1, $2)', [commentId, userId]);
            isLiked = true;
            console.log(`[ToggleCommentLike] User ${userId} liked comment ${commentId}.`);
        }

        const resLikesCount = await client.query('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = $1', [commentId]);
        const likesCount = parseInt(resLikesCount.rows[0].count);

        await client.query('COMMIT');
        res.status(200).json({ message: 'تم تحديث إعجاب التعليق بنجاح.', isLiked, likesCount: likesCount });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERROR: Toggling comment like:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث إعجاب التعليق.' });
    } finally {
        client.release();
    }
});

// Search posts
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query; // q is query, filter is 'all' or 'followed'
    const searchTerm = q ? `%${q.toLowerCase()}%` : ''; // Use % for LIKE operator
    console.log(`[SearchPosts] Query: "${q}", Filter: "${filter}", User: ${userId}`);

    try {
        let query = `
            SELECT p.id, p.author_uid, u.username AS authorName, p.text, p.media_type, p.media_url, p.timestamp, u.profile_bg_url AS authorProfileBg,
                   (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS likes_count,
                   (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
                   (SELECT COUNT(*) FROM follows WHERE following_uid = p.author_uid) AS follower_count
            FROM posts p
            JOIN users u ON p.author_uid = u.uid
        `;
        let params = [];
        let whereClauses = [];

        if (filter === 'followed' && userId) {
            const resUser = await pool.query('SELECT uid FROM users WHERE uid = $1 LIMIT 1', [userId]);
            if (resUser.rows.length === 0) {
                return res.status(404).json({ error: 'المستخدم غير موجود.' });
            }
            query += ` JOIN follows f ON p.author_uid = f.following_uid `;
            whereClauses.push(`f.follower_uid = $${params.length + 1}`);
            params.push(userId);
        }

        if (searchTerm) {
            whereClauses.push(`(LOWER(p.text) LIKE $${params.length + 1} OR LOWER(u.username) LIKE $${params.length + 2})`);
            params.push(searchTerm, searchTerm);
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ` + whereClauses.join(' AND ');
        }
        query += ` ORDER BY p.timestamp DESC`;

        const resPosts = await pool.query(query, params);
        
        const formattedPosts = resPosts.rows.map(p => ({
            id: p.id,
            authorId: p.author_uid,
            authorName: p.authorname,
            text: p.text,
            mediaType: p.media_type,
            mediaUrl: p.media_url ? `${req.protocol}://${req.get('host')}${p.media_url}` : null,
            authorProfileBg: p.authorprofilebg || null,
            timestamp: new Date(p.timestamp).getTime(),
            likes: parseInt(p.likes_count),
            comments: parseInt(p.comments_count),
            views: 0,
            followerCount: parseInt(p.follower_count) || 0
        }));

        console.log(`[SearchPosts] Returning ${formattedPosts.length} search results.`);
        res.status(200).json(formattedPosts);

    } catch (error) {
        console.error("ERROR: Searching posts:", error);
        res.status(500).json({ error: 'حدث خطأ أثناء البحث عن المنشورات.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log(`Access the server at: http://localhost:${PORT}`);
});
