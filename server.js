// استيراد المكتبات الضرورية
const express = require('express');
const cors = require('cors'); // تم تصحيح هذا السطر: require('cors') بدلاً من require = require('cors')
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // للتعامل مع نظام الملفات
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');

// تهيئة تطبيق Express
const app = express();
const PORT = process.env.PORT || 3000;

// تهيئة CORS
app.use(cors());

// تحليل طلبات JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- إعداد تخزين Multer للتخزين المحلي المؤقت ---
// هذا المجلد سيتم مسحه عند إعادة تشغيل الخادم على Render.
// لتخزين دائم، ستحتاج إلى خدمة تخزين سحابي مثل Cloudinary أو AWS S3.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log(`INFO: Created uploads directory at ${uploadsDir}`); // سجل جديد
} else {
    console.log(`INFO: Uploads directory already exists at ${uploadsDir}`); // سجل جديد
}

// توفير الملفات الثابتة من مجلد 'uploads'
app.use('/uploads', express.static(uploadsDir));
console.log(`INFO: Serving static files from /uploads to ${uploadsDir}`); // سجل جديد

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir); // مجلد الوجهة لرفع الملفات
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const newFileName = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        console.log(`DEBUG: Multer generated filename: ${newFileName}`); // سجل جديد
        cb(null, newFileName);
    }
});

const upload = multer({ storage: storage });

// --- قاعدة بيانات في الذاكرة (لأغراض العرض والتطوير) ---
// في بيئة الإنتاج، ستحتاج إلى قاعدة بيانات حقيقية مثل MongoDB, PostgreSQL, إلخ.
let users = []; // { uid, username, passwordHash, customId, profileBgUrl, followers:[], following:[] }
let posts = []; // { id, authorId, authorName, text, mediaType, mediaUrl, timestamp, likes:[], comments:[], views:[], authorProfileBg, followerCount }
let chats = []; // { id, type: 'private' | 'group', participants: [{ uid, name, customId, role (for groups), profileBgUrl }], messages: [], name (for group), description (for group) }
let messages = []; // { id, chatId, senderId, senderName, text, mediaType, mediaUrl, timestamp, senderProfileBg }

// دالة مساعدة لتوليد معرفات مستخدم مخصصة (8 أرقام)
const generateCustomId = customAlphabet('0123456789', 8);

// --- وظائف API للمصادقة ---

// التسجيل
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const customId = generateCustomId();
        const newUser = {
            uid: uuidv4(),
            username,
            passwordHash,
            customId,
            profileBgUrl: null,
            followers: [],
            following: []
        };
        users.push(newUser);
        console.log(`INFO: User registered: ${username}, Custom ID: ${customId}`); // سجل جديد
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح!', user: { uid: newUser.uid, username: newUser.username, customId: newUser.customId } });
    } catch (error) {
        console.error('ERROR: Registration error:', error); // سجل جديد
        res.status(500).json({ error: 'فشل في عملية التسجيل.' });
    }
});

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    try {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }
        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح!',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.customId,
                profileBg: user.profileBgUrl
            }
        });
        console.log(`INFO: User logged in: ${username}`); // سجل جديد
    } catch (error) {
        console.error('ERROR: Login error:', error); // سجل جديد
        res.status(500).json({ error: 'فشل في عملية تسجيل الدخول.' });
    }
});

// --- وظائف API للملفات الشخصية وخلفيات المستخدمين ---

// رفع خلفية الملف الشخصي (باستخدام التخزين المحلي)
app.post('/api/upload-profile-background', upload.single('file'), (req, res) => {
    console.log("DEBUG: Received request to upload profile background."); // سجل جديد
    console.log("DEBUG: req.file for profile background:", req.file); // سجل جديد

    if (!req.file) {
        console.warn("WARN: No file provided for profile background upload."); // سجل جديد
        return res.status(400).json({ error: 'لم يتم توفير ملف.' });
    }
    const { userId } = req.body;
    if (!userId) {
        console.warn("WARN: userId missing for profile background upload."); // سجل جديد
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    const user = users.find(u => u.uid === userId);
    if (!user) {
        console.warn(`WARN: User ${userId} not found for profile background upload.`); // سجل جديد
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    user.profileBgUrl = fileUrl;
    
    console.log(`INFO: Profile background uploaded for ${userId}. URL: ${fileUrl}`); // سجل جديد
    res.status(200).json({ message: 'تم تحديث خلفية الملف الشخصي بنجاح!', url: fileUrl });
});

// جلب خلفية الملف الشخصي للمستخدم
app.get('/api/user/:userId/profile-background', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.status(200).json({ url: user.profileBgUrl });
});

// جلب عدد متابعي مستخدم معين
app.get('/api/user/:userId/followers/count', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.status(200).json({ count: user.followers.length });
});

// جلب مستخدم بواسطة المعرف المخصص (Custom ID)
app.get('/api/user/by-custom-id/:customId', (req, res) => {
    const { customId } = req.params;
    const user = users.find(u => u.customId === customId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود بهذا المعرف المخصص.' });
    }
    res.status(200).json({
        uid: user.uid,
        username: user.username,
        customId: user.customId,
        profileBg: user.profileBgUrl
    });
});

// جلب جهات الاتصال لمستخدم معين
app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const userChats = chats.filter(chat => chat.type === 'private' && chat.participants.some(p => p.uid === userId));

    const contacts = new Map();

    userChats.forEach(chat => {
        const otherParticipant = chat.participants.find(p => p.uid !== userId);
        if (otherParticipant) {
            const user = users.find(u => u.uid === otherParticipant.uid);
            if (user) {
                contacts.set(user.uid, {
                    uid: user.uid,
                    username: user.username,
                    customId: user.customId,
                    profileBg: user.profileBgUrl
                });
            }
        }
    });

    res.status(200).json(Array.from(contacts.values()));
});


// --- وظائف API للمتابعة ---

// متابعة/إلغاء متابعة مستخدم
app.post('/api/user/:followerId/follow/:followingId', (req, res) => {
    const { followerId, followingId } = req.params;

    const follower = users.find(u => u.uid === followerId);
    const following = users.find(u => u.uid === followingId);

    if (!follower || !following) {
        return res.status(404).json({ error: 'المستخدم (المتابع أو المتبوع) غير موجود.' });
    }
    if (followerId === followingId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    const isFollowing = follower.following.includes(followingId);

    if (isFollowing) {
        follower.following = follower.following.filter(id => id !== followingId);
        following.followers = following.followers.filter(id => id !== followerId);
        res.status(200).json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing: false });
    } else {
        follower.following.push(followingId);
        following.followers.push(followerId);
        res.status(200).json({ message: 'تمت المتابعة بنجاح.', isFollowing: true });
    }
});

// التحقق مما إذا كان المستخدم يتابع آخر
app.get('/api/user/:followerId/following/:followingId', (req, res) => {
    const { followerId, followingId } = req.params;
    const follower = users.find(u => u.uid === followerId);
    if (!follower) {
        return res.status(404).json({ error: 'المتابع غير موجود.' });
    }
    const isFollowing = follower.following.includes(followingId);
    res.status(200).json({ isFollowing });
});


// --- وظائف API للمنشورات ---

// نشر منشور جديد (باستخدام التخزين المحلي)
app.post('/api/posts', upload.single('mediaFile'), (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;

    // DEBUG: Log req.file to see if Multer processed the file
    console.log("DEBUG: req.file for post upload:", req.file);

    if (!authorId || !authorName) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); // Ensure cleanup
        return res.status(400).json({ error: 'بيانات المؤلف (authorId, authorName) مطلوبة.' });
    }
    if (!text && !req.file) {
        return res.status(400).json({ error: 'المنشور لا يمكن أن يكون فارغاً (يجب أن يحتوي على نص أو وسائط).' });
    }
    
    const author = users.find(u => u.uid === authorId);
    if (!author) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); // Ensure cleanup
        return res.status(404).json({ error: 'المؤلف غير موجود.' });
    }

    let mediaUrl = null;
    let finalMediaType = mediaType || 'text';

    if (req.file) {
        mediaUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        finalMediaType = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'unknown');
        if (finalMediaType === 'unknown') {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); // Ensure cleanup
            return res.status(400).json({ error: 'نوع ملف الوسائط غير مدعوم.' });
        }
        console.log(`DEBUG: Generated mediaUrl for post: ${mediaUrl}, mediaType: ${finalMediaType}`); // سجل جديد
    } else {
        console.log("DEBUG: No media file uploaded for post."); // سجل جديد
    }

    const newPost = {
        id: uuidv4(),
        authorId,
        authorName,
        text: text || '',
        mediaType: finalMediaType,
        mediaUrl: mediaUrl, // <--- هذا هو الرابط الذي سيتم حفظه
        timestamp: Date.now(),
        likes: [],
        comments: [],
        views: [],
        authorProfileBg: authorProfileBg || null,
        followerCount: author.followers.length
    };

    posts.push(newPost);
    console.log(`INFO: New post created. Post ID: ${newPost.id}, Media URL saved: ${newPost.mediaUrl || 'None'}`); // سجل جديد
    res.status(201).json({ message: 'تم نشر المنشور بنجاح!', post: newPost });
});

// جلب جميع المنشورات
app.get('/api/posts', (req, res) => {
    res.status(200).json(posts);
});

// جلب منشورات المستخدمين الذين يتابعهم مستخدم معين
app.get('/api/posts/followed/:userId', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const followedPosts = posts.filter(post => user.following.includes(post.authorId));
    res.status(200).json(followedPosts);
});

// البحث في المنشورات
app.get('/api/posts/search', (req, res) => {
    const { q, filter, userId } = req.query;
    const searchTerm = q ? q.toLowerCase() : '';

    let filteredPosts = [];

    if (filter === 'followed' && userId) {
        const user = users.find(u => u.uid === userId);
        if (user) {
            filteredPosts = posts.filter(post => user.following.includes(post.authorId));
        }
    } else {
        filteredPosts = [...posts];
    }

    if (searchTerm) {
        filteredPosts = filteredPosts.filter(post =>
            post.text.toLowerCase().includes(searchTerm) ||
            post.authorName.toLowerCase().includes(searchTerm)
        );
    }
    res.status(200).json(filteredPosts);
});

// الإعجاب بمنشور / إلغاء الإعجاب
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    const hasLiked = post.likes.includes(userId);
    if (hasLiked) {
        post.likes = post.likes.filter(id => id !== userId);
        res.status(200).json({ message: 'تم إلغاء الإعجاب.', isLiked: false, likesCount: post.likes.length });
    } else {
        post.likes.push(userId);
        res.status(200).json({ message: 'تم الإعجاب بالمنشور!', isLiked: true, likesCount: post.likes.length });
    }
});

// إضافة تعليق على منشور
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'معرف المستخدم، اسم المستخدم، والنص مطلوبان للتعليق.' });
    }

    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const newComment = {
        id: uuidv4(),
        userId,
        username,
        text,
        timestamp: Date.now(),
        likes: [],
        userProfileBg: user.profileBgUrl
    };
    post.comments.push(newComment);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح!', comment: newComment });
});

// جلب تعليقات منشور معين
app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    res.status(200).json(post.comments);
});

// الإعجاب بتعليق / إلغاء الإعجاب
app.post('/api/posts/:postId/comments/:commentId/like', (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) {
        return res.status(404).json({ error: 'التعليق غير موجود.' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    const hasLiked = comment.likes.includes(userId);
    if (hasLiked) {
        comment.likes = comment.likes.filter(id => id !== userId);
        res.status(200).json({ message: 'تم إلغاء الإعجاب بالتعليق.', isLiked: false, likesCount: comment.likes.length });
    } else {
        comment.likes.push(userId);
        res.status(200).json({ message: 'تم الإعجاب بالتعليق!', isLiked: true, likesCount: comment.likes.length });
    }
});


// زيادة عداد مشاهدات منشور
app.post('/api/posts/:postId/view', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    if (!post.views.includes(userId)) {
        post.views.push(userId);
        res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: post.views.length });
    } else {
        res.status(200).json({ message: 'تمت مشاهدة المنشور بالفعل بواسطة هذا المستخدم.', viewsCount: post.views.length });
    }
});

// حذف منشور (مع حذف الملف المحلي إذا كان موجوداً)
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const initialLength = posts.length;
    
    const postToDelete = posts.find(p => p.id === postId);
    if (postToDelete && postToDelete.mediaUrl) {
        const filename = path.basename(postToDelete.mediaUrl);
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`INFO: Deleted local media file: ${filePath}`); // سجل جديد
        }
    }

    posts = posts.filter(p => p.id !== postId);
    if (posts.length < initialLength) {
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    } else {
        res.status(404).json({ error: 'المنشور غير موجود.' });
    }
});


// --- وظائف API للمحادثات ---

// جلب جميع المحادثات لمستخدم معين
app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;
    const userChats = chats
        .filter(chat => chat.participants.some(p => p.uid === userId))
        .map(chat => {
            let chatName = '';
            let profileBgUrl = null;
            let customId = null;
            let adminId = null;

            if (chat.type === 'private') {
                const otherParticipant = chat.participants.find(p => p.uid !== userId);
                const contactUser = users.find(u => u.uid === otherParticipant.uid);
                const currentUserChatEntry = chat.participants.find(p => p.uid === userId);
                chatName = currentUserChatEntry.contactName || (contactUser ? contactUser.username : 'Unknown User');
                profileBgUrl = contactUser ? contactUser.profileBgUrl : null;
                customId = contactUser ? contactUser.customId : null;
            } else if (chat.type === 'group') {
                chatName = chat.name;
                profileBgUrl = chat.profileBgUrl || null;
                adminId = chat.adminId;
            }

            const lastMessage = messages
                .filter(msg => msg.chatId === chat.id)
                .sort((a, b) => b.timestamp - a.timestamp)[0];

            return {
                id: chat.id,
                type: chat.type,
                name: chatName,
                lastMessage: lastMessage ? lastMessage.text : null,
                timestamp: lastMessage ? lastMessage.timestamp : (chat.createdAt || 0),
                profileBg: profileBgUrl,
                customId: customId,
                adminId: adminId
            };
        });
    
    userChats.sort((a, b) => b.timestamp - a.timestamp);

    res.status(200).json(userChats);
});

// إنشاء محادثة فردية جديدة (أو جلب محادثة موجودة)
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.participants[0].uid === user1Id && chat.participants[1].uid === user2Id) ||
         (chat.participants[0].uid === user2Id && chat.participants[1].uid === user1Id))
    );

    if (existingChat) {
        const currentUserParticipant = existingChat.participants.find(p => p.uid === user1Id);
        if (currentUserParticipant) {
            currentUserParticipant.contactName = contactName;
        }
        return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
    }

    const user1 = users.find(u => u.uid === user1Id);
    const user2 = users.find(u => u.uid === user2Id);

    if (!user1 || !user2) {
        return res.status(404).json({ error: 'أحد المستخدمين غير موجود.' });
    }

    const newChat = {
        id: uuidv4(),
        type: 'private',
        participants: [
            { uid: user1.uid, name: user1.username, customId: user1.customId, profileBgUrl: user1.profileBgUrl, contactName: contactName },
            { uid: user2.uid, name: user2.username, customId: user2.customId, profileBgUrl: user2.profileBgUrl, contactName: user1.username }
        ],
        createdAt: Date.now()
    };
    chats.push(newChat);
    res.status(201).json({ message: 'تم إنشاء المحادثة بنجاح!', chatId: newChat.id });
});

// تعديل اسم جهة الاتصال في محادثة فردية
app.put('/api/chats/private/:chatId/contact-name', (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    const chat = chats.find(c => c.id === chatId && c.type === 'private');
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة فردية.' });
    }

    const participant = chat.participants.find(p => p.uid === userId);
    if (!participant) {
        return res.status(403).json({ error: 'المستخدم ليس مشاركاً في هذه المحادثة.' });
    }

    participant.contactName = newContactName;
    res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
});

// حذف محادثة فردية من طرف واحد (من عند المستخدم فقط)
app.delete('/api/chats/:chatId/delete-for-user', (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;

    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];
    const participantIndex = chat.participants.findIndex(p => p.uid === userId);

    if (participantIndex === -1) {
        return res.status(403).json({ error: 'المستخدم غير مصرح له بحذف هذه المحادثة.' });
    }

    chat.participants.splice(participantIndex, 1);

    if (chat.participants.length === 0) {
        chats.splice(chatIndex, 1);
        messages = messages.filter(msg => msg.chatId !== chatId);
        res.status(200).json({ message: 'تم حذف المحادثة نهائياً.' });
    } else {
        res.status(200).json({ message: 'تم حذف المحادثة من طرفك فقط.' });
    }
});

// حذف محادثة فردية من الطرفين
app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;

    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private');
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة فردية.' });
    }

    const chat = chats[chatIndex];
    if (!chat.participants.some(p => p.uid === callerUid)) {
        return res.status(403).json({ error: 'أنت غير مخول بحذف هذه المحادثة.' });
    }

    chats.splice(chatIndex, 1);
    messages = messages.filter(msg => msg.chatId !== chatId);
    res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
});


// --- وظائف API للرسائل ---

// إرسال رسالة (نص أو وسائط) (باستخدام التخزين المحلي)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;

    console.log("DEBUG: req.file for message upload:", req.file); // سجل جديد

    if (!senderId || !senderName) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المرسل (senderId, senderName) مطلوبة.' });
    }

    const chat = chats.find(c => c.id === chatId);
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
        console.log(`DEBUG: Generated mediaUrl for message: ${mediaUrl}, mediaType: ${finalMediaType}`); // سجل جديد
    } else {
        console.log("DEBUG: No media file uploaded for message."); // سجل جديد
    }

    const newMessage = {
        id: uuidv4(),
        chatId,
        senderId,
        senderName,
        text: text || '',
        mediaType: finalMediaType,
        mediaUrl: mediaUrl,
        timestamp: Date.now(),
        senderProfileBg: senderProfileBg || null
    };

    messages.push(newMessage);
    console.log(`INFO: New message created. Message ID: ${newMessage.id}, Media URL saved: ${newMessage.mediaUrl || 'None'}`); // سجل جديد
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', message: newMessage });
});

// جلب رسائل محادثة معينة
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0;

    const chatMessages = messages.filter(msg => msg.chatId === chatId && msg.timestamp > since);
    res.status(200).json(chatMessages);
});


// --- وظائف API للمجموعات ---

// إنشاء مجموعة جديدة
app.post('/api/groups', (req, res) => {
    const { name, description, adminId, members } = req.body;

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة والمشرف وعضوان على الأقل مطلوبان.' });
    }

    const adminUser = users.find(u => u.uid === adminId);
    if (!adminUser) {
        return res.status(404).json({ error: 'المشرف المحدد غير موجود.' });
    }

    const participants = [];
    for (const uid in members) {
        const user = users.find(u => u.uid === uid);
        if (user) {
            participants.push({
                uid: user.uid,
                name: user.username,
                customId: user.customId,
                role: members[uid],
                profileBgUrl: user.profileBgUrl
            });
        }
    }

    if (participants.length < 2) {
        return res.status(400).json({ error: 'يجب أن تحتوي المجموعة على عضوين على الأقل.' });
    }

    const newGroup = {
        id: uuidv4(),
        type: 'group',
        name,
        description,
        adminId,
        participants,
        createdAt: Date.now(),
        profileBgUrl: null
    };
    chats.push(newGroup);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح!', groupId: newGroup.id });
});

// جلب أعضاء المجموعة
app.get('/api/group/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
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
});

// جلب عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.status(200).json({ count: group.participants.length });
});

// إضافة أعضاء إلى مجموعة موجودة
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerIsAdmin = group.participants.some(p => p.uid === callerUid && p.role === 'admin');
    if (!callerIsAdmin) {
        return res.status(403).json({ error: 'أنت غير مخول بإضافة أعضاء إلى هذه المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(uid => {
        if (!group.participants.some(p => p.uid === uid)) {
            const user = users.find(u => u.uid === uid);
            if (user) {
                group.participants.push({
                    uid: user.uid,
                    name: user.username,
                    customId: user.customId,
                    role: 'member',
                    profileBgUrl: user.profileBgUrl
                });
                addedMembers.push(user.username);
            }
        }
    });

    if (addedMembers.length > 0) {
        res.status(200).json({ message: `تم إضافة الأعضاء: ${addedMembers.join(', ')} بنجاح.` });
    } else {
        res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
    }
});

// تغيير دور عضو في المجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    const targetMember = group.participants.find(p => p.uid === memberUid);

    if (!caller || !targetMember) {
        return res.status(404).json({ error: 'المستخدم الذي يقوم بالعملية أو العضو المستهدف غير موجود في هذه المجموعة.' });
    }

    if (caller.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح لك بتغيير أدوار الأعضاء.' });
    }

    if (targetMember.uid === group.adminId && newRole === 'member' && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة إشراف مالك المجموعة.' });
    }

    if (targetMember.role === 'admin' && newRole === 'member' && caller.uid !== group.adminId && targetMember.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة إشراف مشرف آخر.' });
    }

    targetMember.role = newRole;
    res.status(200).json({ message: `تم تغيير دور ${targetMember.name} إلى ${newRole}.` });
});

// إزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    const targetMemberIndex = group.participants.findIndex(p => p.uid === memberUid);

    if (!caller || targetMemberIndex === -1) {
        return res.status(404).json({ error: 'المستخدم الذي يقوم بالعملية أو العضو المستهدف غير موجود في هذه المجموعة.' });
    }

    if (caller.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح لك بإزالة الأعضاء.' });
    }

    const targetMember = group.participants[targetMemberIndex];

    if (targetMember.uid === group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }

    if (targetMember.role === 'admin' && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'المشرف العادي لا يمكنه إزالة مشرف آخر.' });
    }

    group.participants.splice(targetMemberIndex, 1);
    res.status(200).json({ message: `تم إزالة ${targetMember.name} من المجموعة بنجاح.` });
});

// مغادرة المجموعة
app.delete('/api/group/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const memberIndex = group.participants.findIndex(p => p.uid === memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    const leavingMember = group.participants[memberIndex];

    if (leavingMember.uid === group.adminId) {
        if (group.participants.length > 1) {
            const newAdmin = group.participants.find(p => p.uid !== memberUid && p.role === 'admin');
            if (newAdmin) {
                group.adminId = newAdmin.uid;
            } else {
                const firstAvailableMember = group.participants.find(p => p.uid !== memberUid);
                if (firstAvailableMember) {
                    group.adminId = firstAvailableMember.uid;
                    firstAvailableMember.role = 'admin';
                } else {
                    chats = chats.filter(chat => chat.id !== groupId);
                    messages = messages.filter(msg => msg.chatId !== groupId);
                    return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
                }
            }
        } else {
            chats = chats.filter(chat => chat.id !== groupId);
            messages = messages.filter(msg => msg.chatId !== groupId);
            return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
        }
    }

    group.participants.splice(memberIndex, 1);

    if (group.participants.length === 0) {
        chats = chats.filter(chat => chat.id !== groupId);
        messages = messages.filter(msg => msg.chatId !== groupId);
    }
    
    res.status(200).json({ message: 'غادرت المجموعة بنجاح.' });
});

// تغيير اسم المجموعة
app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    if (!caller || caller.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح لك بتغيير اسم المجموعة.' });
    }

    group.name = newName;
    res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
});


// بدء الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
    console.log('--- Initial Data Status ---');
    console.log('Users:', users.length);
    console.log('Posts:', posts.length);
    console.log('Chats:', chats.length);
    console.log('Messages:', messages.length);
});

// بيانات اختبار مبدئية (اختياري، يمكنك إزالتها في الإنتاج)
const setupInitialData = async () => {
    // إنشاء مستخدمين افتراضيين
    if (users.length === 0) {
        const passwordHash1 = await bcrypt.hash('password123', 10);
        const passwordHash2 = await bcrypt.hash('password456', 10);
        const passwordHash3 = await bcrypt.hash('password789', 10);

        const user1 = { uid: uuidv4(), username: 'محمد', passwordHash: passwordHash1, customId: '12345678', profileBgUrl: null, followers: [], following: [] };
        const user2 = { uid: uuidv4(), username: 'أحمد', passwordHash: passwordHash2, customId: '87654321', profileBgUrl: null, followers: [], following: [] };
        const user3 = { uid: uuidv4(), username: 'فاطمة', passwordHash: password3, customId: '11223344', profileBgUrl: null, followers: [], following: [] };
        
        users.push(user1, user2, user3);
        console.log('INFO: Added initial users.'); // سجل جديد

        // جعل محمد يتابع أحمد وفاطمة
        user1.following.push(user2.uid, user3.uid);
        user2.followers.push(user1.uid);
        user3.followers.push(user1.uid);

        // جعل أحمد يتابع محمد
        user2.following.push(user1.uid);
        user1.followers.push(user2.uid);

        // إضافة صور وفيديوهات مؤقتة (للتجربة)
        // هذا الجزء سيعتمد على `req.protocol` و `req.get('host')` بشكل صحيح من البيئة التي يعمل فيها الخادم
        // يجب أن تقوم Render بتعيين `process.env.RENDER_EXTERNAL_URL` لكي يعمل هذا بشكل صحيح
        // أو بدلاً من ذلك، يمكنك تعيين متغير بيئة اسمه `BACKEND_URL` يدوياً في Render
        const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `http://localhost:${PORT}`;

        const dummyImageUrl = `${baseUrl}/uploads/dummy-image.jpg`;
        const dummyVideoUrl = `${baseUrl}/uploads/dummy-video.mp4`;

        // إنشاء ملفات وهمية (dummy) في مجلد uploads (لأغراض التجربة)
        const dummyImagePath = path.join(uploadsDir, 'dummy-image.jpg');
        const dummyVideoPath = path.join(uploadsDir, 'dummy-video.mp4');

        if (!fs.existsSync(dummyImagePath)) {
            // قم بإنشاء ملف صورة فارغ أو انسخ صورة موجودة
            fs.writeFileSync(dummyImagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", 'base64')); // بكسل واحد شفاف
            console.log('INFO: Created dummy-image.jpg in uploads.'); // سجل جديد
        }
        if (!fs.existsSync(dummyVideoPath)) {
            // قم بإنشاء ملف فيديو فارغ أو صغير جداً
            fs.writeFileSync(dummyVideoPath, Buffer.from("")); // ملف فارغ
            console.log('INFO: Created dummy-video.mp4 in uploads.'); // سجل جديد
        }


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
            followerCount: user1.followers.length
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
            followerCount: user3.followers.length
        };


        posts.push(post1, post2, post3, post4);
        console.log('INFO: Added initial posts.'); // سجل جديد

        // إضافة محادثات افتراضية
        const chat1to2 = {
            id: uuidv4(),
            type: 'private',
            participants: [
                { uid: user1.uid, name: user1.username, customId: user1.customId, profileBgUrl: user1.profileBgUrl, contactName: user2.username },
                { uid: user2.uid, name: user2.username, customId: user2.customId, profileBgUrl: user2.profileBgUrl, contactName: user1.username }
            ],
            createdAt: Date.now() - 60000
        };
        chats.push(chat1to2);

        // رسائل في المحادثة الفردية
        messages.push({
            id: uuidv4(),
            chatId: chat1to2.id,
            senderId: user1.uid,
            senderName: user1.username,
            text: 'مرحباً أحمد! كيف حالك؟',
            mediaType: 'text',
            mediaUrl: null,
            timestamp: Date.now() - 59000,
            senderProfileBg: user1.profileBgUrl
        });
        messages.push({
            id: uuidv4(),
            chatId: chat1to2.id,
            senderId: user2.uid,
            senderName: user2.username,
            text: 'أهلاً محمد! أنا بخير، شكراً لك. ماذا عنك؟',
            mediaType: 'text',
            mediaUrl: null,
            timestamp: Date.now() - 58000,
            senderProfileBg: user2.profileBgUrl
        });

        // إنشاء مجموعة افتراضية
        const group1 = {
            id: uuidv4(),
            type: 'group',
            name: 'مجموعة الأصدقاء',
            description: 'مجموعة للتحدث مع الأصدقاء المقربين.',
            adminId: user1.uid,
            participants: [
                { uid: user1.uid, name: user1.username, customId: user1.customId, role: 'admin', profileBgUrl: user1.profileBgUrl },
                { uid: user2.uid, name: user2.username, customId: user2.customId, role: 'member', profileBgUrl: user2.profileBgUrl },
                { uid: user3.uid, name: user3.username, customId: user3.customId, role: 'member', profileBgUrl: user3.profileBgUrl }
            ],
            createdAt: Date.now() - 70000,
            profileBgUrl: null
        };
        chats.push(group1);

        // رسائل في المجموعة
        messages.push({
            id: uuidv4(),
            chatId: group1.id,
            senderId: user1.uid,
            senderName: user1.username,
            text: 'مرحباً بالجميع في المجموعة!',
            mediaType: 'text',
            mediaUrl: null,
            timestamp: Date.now() - 69000,
            senderProfileBg: user1.profileBgUrl
        });
        messages.push({
            id: uuidv4(),
            chatId: group1.id,
            senderId: user3.uid,
            senderName: user3.username,
            text: 'أهلاً محمد! كيف حالكم جميعاً؟',
            mediaType: 'text',
            mediaUrl: null,
            timestamp: Date.now() - 68000,
            senderProfileBg: user3.profileBgUrl
        });
        console.log('INFO: Added initial chats and messages.'); // سجل جديد
    }
};

// تشغيل دالة إعداد البيانات الأولية
setupInitialData();
