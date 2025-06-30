// استيراد المكتبات الضرورية
const express = require('express');
const cors = require('cors');
const multer = require('multer'); // لمعالجة رفع الملفات
// **تغيير مهم**: استخدام الإصدار الثالث من AWS SDK
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid'); // لتوليد معرفات فريدة للملفات
// const { nanoid } = require('nanoid'); // إذا أردت استخدام nanoid بدلاً من uuid

// تهيئة تطبيق Express
const app = express();
const PORT = process.env.PORT || 3000; // Heroku/Railway سيعين متغير PORT تلقائياً

// Middleware
app.use(cors()); // تمكين CORS لتمكين الواجهة الأمامية من الاتصال
app.use(express.json()); // لتمكين تحليل JSON في جسم الطلبات

// ----------------------------------------------------
// معلومات اتصال Storj DCS - تم تحديث هذه القيم بمفاتيحك الحقيقية
// من ملف Storj-S3-Credentials- Watsaligram-App-Key-2025-06-29T11_08_36.629Z.txt
// ملاحظة: يُفضل استخدام متغيرات البيئة في الإنتاج، ولكن لأغراض الاختبار المباشر هنا.
const STORJ_ACCESS_KEY_ID = 'jwsutdemteo7a3odjeweckixb5oa';
const STORJ_SECRET_ACCESS_KEY = 'j3h3b4tvphprkdmfy7ntxw5el4wk46i6xhifxl573zuuogvfjorms';
const STORJ_ENDPOINT = 'https://gateway.storjshare.io';

// اسم الـ Bucket الذي حددته في الصورة
const STORJ_BUCKET_NAME = 'my-chat-uploads'; // اسم الـ Bucket الخاص بك

// **تغيير مهم**: تهيئة S3 Client باستخدام الإصدار الثالث من AWS SDK
const s3Client = new S3Client({
    region: 'us-east-1', // المنطقة لا تهم لـ Storj ولكنها مطلوبة
    endpoint: STORJ_ENDPOINT,
    credentials: {
        accessKeyId: STORJ_ACCESS_KEY_ID,
        secretAccessKey: STORJ_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // مهم لـ Storj DCS
});

// إعداد Multer لتخزين الملفات مؤقتًا في الذاكرة
const upload = multer({ storage: multer.memoryStorage() });

// ----------------------------------------------------
// بيانات مؤقتة في الذاكرة (للتوضيح فقط - في تطبيق حقيقي استخدم قاعدة بيانات دائمة)
// **تحذير: هذه البيانات ستفقد عند إعادة تشغيل الخادم.**
let users = [];
let posts = [];
let chats = [];

// لتوليد معرف مخصص من 8 أرقام
function generateCustomId() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// ----------------------------------------------------
// مسارات API - المصادقة (Authentication Routes)
// ----------------------------------------------------

// تسجيل المستخدم (Register)
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
    }

    const customId = generateCustomId();
    const newUser = {
        uid: uuidv4(),
        username,
        password, // في بيئة الإنتاج، يجب تشفير كلمة المرور (Hashing) باستخدام bcryptjs مثلاً
        customId,
        profileBgUrl: null, // لا توجد خلفية ملف شخصي افتراضية
        followers: [],
        following: []
    };
    users.push(newUser);
    console.log('مستخدم جديد مسجل:', newUser);
    res.status(201).json({ message: 'تم تسجيل المستخدم بنجاح.', user: { uid: newUser.uid, username: newUser.username, customId: newUser.customId } });
});

// تسجيل الدخول (Login)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password); // في بيئة الإنتاج، تحقق من كلمة المرور المشفرة
    if (!user) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    console.log('المستخدم قام بتسجيل الدخول:', user.username);
    res.json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBgUrl } });
});

// ----------------------------------------------------
// مسارات API - إدارة الملف الشخصي (Profile Management)
// ----------------------------------------------------

// تحميل خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const file = req.file;

    if (!userId || !file) {
        return res.status(400).json({ error: 'المستخدم والملف مطلوبان.' });
    }

    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${userId}/profile_bg/${uuidv4()}.${fileExtension}`;

    // **تغيير مهم**: استخدام PutObjectCommand مع S3Client
    const uploadParams = {
        Bucket: STORJ_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.buffer.length, // التأكد من وجود ContentLength
        ACL: 'public-read'
    };

    try {
        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command); // إرسال الأمر
        const fileUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${fileName}`; // بناء URL يدوياً
        user.profileBgUrl = fileUrl;
        console.log(`تم تحميل خلفية الملف الشخصي لـ ${user.username}: ${user.profileBgUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: user.profileBgUrl });
    } catch (error) {
        console.error('خطأ في تحميل الملف إلى Storj DCS:', error);
        res.status(500).json({ error: `فشل تحميل الملف: ${error.message}` });
    }
});

// جلب خلفية الملف الشخصي
app.get('/api/user/:userId/profile-background', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.json({ url: user.profileBgUrl });
});


// ----------------------------------------------------
// مسارات API - إدارة المنشورات (Post Management)
// ----------------------------------------------------

// نشر منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;

    if (!authorId || !authorName) {
        return res.status(400).json({ error: 'معرف المؤلف واسم المؤلف مطلوبان.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        const fileExtension = mediaFile.originalname.split('.').pop();
        const fileName = `${authorId}/posts/${uuidv4()}.${fileExtension}`;

        // **تغيير مهم**: استخدام PutObjectCommand مع S3Client
        const uploadParams = {
            Bucket: STORJ_BUCKET_NAME,
            Key: fileName,
            Body: mediaFile.buffer,
            ContentType: mediaFile.mimetype,
            ContentLength: mediaFile.buffer.length, // التأكد من وجود ContentLength
            ACL: 'public-read'
        };

        try {
            const command = new PutObjectCommand(uploadParams);
            await s3Client.send(command); // إرسال الأمر
            mediaUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${fileName}`; // بناء URL يدوياً
            console.log(`تم تحميل ملف الوسائط للمنشور: ${mediaUrl}`);
        } catch (error) {
            console.error('خطأ في تحميل ملف الوسائط للمنشور إلى Storj DCS:', error);
            return res.status(500).json({ error: `فشل تحميل ملف الوسائط للمنشور: ${error.message}` });
        }
    }

    const newPost = {
        id: uuidv4(),
        authorId,
        authorName,
        text,
        timestamp: Date.now(),
        likes: [],
        comments: [],
        views: [],
        mediaUrl: mediaUrl,
        mediaType: mediaType || 'text',
        authorProfileBg: authorProfileBg || null
    };
    posts.push(newPost);
    console.log('تم نشر منشور جديد:', newPost);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
});

// جلب جميع المنشورات
app.get('/api/posts', (req, res) => {
    res.json(posts.sort((a, b) => b.timestamp - a.timestamp));
});

// جلب منشورات المستخدمين المتابعين
app.get('/api/posts/followed/:userId', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const followedPosts = posts.filter(post => user.following.includes(post.authorId));
    res.json(followedPosts.sort((a, b) => b.timestamp - a.timestamp));
});

// البحث في المنشورات
app.get('/api/posts/search', (req, res) => {
    const { q, filter, userId } = req.query;
    let filteredPosts = posts;

    if (filter === 'followed' && userId) {
        const currentUser = users.find(u => u.uid === userId);
        if (currentUser) {
            filteredPosts = filteredPosts.filter(post => currentUser.following.includes(post.authorId));
        } else {
            return res.status(404).json({ error: 'المستخدم غير موجود للفلترة.' });
        }
    }

    if (q) {
        const searchTerm = q.toLowerCase();
        filteredPosts = filteredPosts.filter(post =>
            post.text.toLowerCase().includes(searchTerm) ||
            post.authorName.toLowerCase().includes(searchTerm)
        );
    }
    res.json(filteredPosts.sort((a, b) => b.timestamp - a.timestamp));
});

// زيادة عدد المشاهدات للمنشور
app.post('/api/posts/:postId/view', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!Array.isArray(post.views)) {
        post.views = [];
    }

    if (!post.views.includes(userId)) {
        post.views.push(userId);
    }
    res.status(200).json({ message: 'تم زيادة عدد المشاهدات بنجاح.', viewsCount: post.views.length });
});

// الإعجاب/إلغاء الإعجاب بالمنشور
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!Array.isArray(post.likes)) {
        post.likes = [];
    }

    const index = post.likes.indexOf(userId);
    let isLiked = false;
    if (index > -1) {
        post.likes.splice(index, 1);
        isLiked = false;
    } else {
        post.likes.push(userId);
        isLiked = true;
    }
    res.json({ message: 'تم تحديث الإعجاب بنجاح.', isLiked, likesCount: post.likes.length });
});

// إضافة تعليق على منشور
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!text) {
        return res.status(400).json({ error: 'نص التعليق لا يمكن أن يكون فارغاً.' });
    }

    if (!Array.isArray(post.comments)) {
        post.comments = [];
    }

    const user = users.find(u => u.uid === userId);
    const userProfileBg = user ? user.profileBgUrl : null;

    const newComment = {
        id: uuidv4(),
        userId,
        username,
        text,
        timestamp: Date.now(),
        likes: [],
        userProfileBg
    };
    post.comments.push(newComment);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', comment: newComment });
});

// جلب التعليقات لمنشور معين
app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const commentsToReturn = Array.isArray(post.comments) ? post.comments : [];
    res.json(commentsToReturn);
});

// الإعجاب/إلغاء الإعجاب بتعليق
app.post('/api/posts/:postId/comments/:commentId/like', (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!Array.isArray(post.comments)) {
        post.comments = [];
    }

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) {
        return res.status(404).json({ error: 'التعليق غير موجود.' });
    }
    if (!Array.isArray(comment.likes)) {
        comment.likes = [];
    }

    const index = comment.likes.indexOf(userId);
    let isLiked = false;
    if (index > -1) {
        comment.likes.splice(index, 1);
        isLiked = false;
    } else {
        comment.likes.push(userId);
        isLiked = true;
    }
    res.json({ message: 'تم تحديث الإعجاب بالتعليق بنجاح.', isLiked, likesCount: comment.likes.length });
});


// حذف منشور
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const initialLength = posts.length;
    posts = posts.filter(p => p.id !== postId);
    if (posts.length < initialLength) {
        res.json({ message: 'تم حذف المنشور بنجاح.' });
    } else {
        res.status(404).json({ error: 'المنشور غير موجود.' });
    }
});

// ----------------------------------------------------
// مسارات API - المتابعة (Following)
// ----------------------------------------------------

// متابعة/إلغاء متابعة مستخدم
app.post('/api/user/:followerId/follow/:followingId', (req, res) => {
    const { followerId, followingId } = req.params;

    const follower = users.find(u => u.uid === followerId);
    const following = users.find(u => u.uid === followingId);

    if (!follower || !following) {
        return res.status(404).json({ error: 'أحد المستخدمين غير موجود.' });
    }

    if (!Array.isArray(follower.following)) {
        follower.following = [];
    }
    if (!Array.isArray(following.followers)) {
        following.followers = [];
    }

    const index = follower.following.indexOf(followingId);
    let isFollowing = false;
    if (index > -1) {
        follower.following.splice(index, 1);
        following.followers = following.followers.filter(id => id !== followerId);
        isFollowing = false;
        res.json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing });
    } else {
        follower.following.push(followingId);
        following.followers.push(followerId);
        isFollowing = true;
        res.json({ message: 'تمت المتابعة بنجاح.', isFollowing });
    }
    console.log(`المستخدم ${follower.username} يتابع/يلغي متابعة ${following.username}.`);
});

// جلب عدد متابعي المستخدم
app.get('/api/user/:userId/followers/count', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.json({ count: user.followers ? user.followers.length : 0 });
});

// جلب حالة المتابعة بين مستخدمين
app.get('/api/user/:followerId/following/:followingId', (req, res) => {
    const { followerId, followingId } = req.params;
    const follower = users.find(u => u.uid === followerId);
    if (!follower) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    const isFollowing = Array.isArray(follower.following) && follower.following.includes(followingId);
    res.json({ isFollowing });
});


// ----------------------------------------------------
// مسارات API - الدردشات (Chat Routes)
// ----------------------------------------------------

// جلب قائمة الدردشات للمستخدم
app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;
    const userChats = chats.filter(chat =>
        chat.type === 'private' && (chat.user1Id === userId || chat.user2Id === userId) ||
        chat.type === 'group' && chat.participants.some(p => p.uid === userId)
    ).map(chat => {
        if (chat.type === 'private') {
            const otherParticipantId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
            const otherParticipantName = chat.user1Id === userId ? chat.user2Name : chat.user1Name;
            const otherParticipantCustomId = chat.user1Id === userId ? chat.user2CustomId : chat.user1CustomId;
            const otherParticipantProfileBg = chat.user1Id === userId ? users.find(u => u.uid === chat.user2Id)?.profileBgUrl : users.find(u => u.uid === chat.user1Id)?.profileBgUrl;

            const contactName = chat.contactName; 
            
            const lastMessage = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
            const lastMessageText = lastMessage ? (lastMessage.text || lastMessage.mediaType === 'image' ? '🖼️ صورة' : lastMessage.mediaType === 'video' ? '🎥 فيديو' : '') : '';
            const lastMessageTimestamp = lastMessage ? lastMessage.timestamp : 0;


            return {
                id: chat.id,
                type: 'private',
                name: contactName || otherParticipantName,
                lastMessage: lastMessageText,
                timestamp: lastMessageTimestamp,
                customId: otherParticipantCustomId,
                profileBg: otherParticipantProfileBg
            };
        } else if (chat.type === 'group') {
            const lastMessage = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
            const lastMessageText = lastMessage ? (lastMessage.text || lastMessage.mediaType === 'image' ? '🖼️ صورة' : lastMessage.mediaType === 'video' ? '🎥 فيديو' : '') : '';
            const lastMessageTimestamp = lastMessage ? lastMessage.timestamp : 0;

            return {
                id: chat.id,
                type: 'group',
                name: chat.name,
                description: chat.description,
                adminId: chat.adminId,
                lastMessage: lastMessageText,
                timestamp: lastMessageTimestamp,
                profileBg: chat.profileBg || null
            };
        }
    });

    userChats.sort((a, b) => b.timestamp - a.timestamp);
    res.json(userChats);
});

// جلب جهات الاتصال (المستخدمين الذين أجرى معهم المستخدم الحالي محادثات فردية)
app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const contacts = new Map();

    chats.forEach(chat => {
        if (chat.type === 'private') {
            if (chat.user1Id === userId) {
                const otherUser = users.find(u => u.uid === chat.user2Id);
                if (otherUser && !contacts.has(otherUser.uid)) {
                    contacts.set(otherUser.uid, {
                        uid: otherUser.uid,
                        username: otherUser.username,
                        customId: otherUser.customId,
                        profileBgUrl: otherUser.profileBgUrl
                    });
                }
            } else if (chat.user2Id === userId) {
                const otherUser = users.find(u => u.uid === chat.user1Id);
                if (otherUser && !contacts.has(otherUser.uid)) {
                    contacts.set(otherUser.uid, {
                        uid: otherUser.uid,
                        username: otherUser.username,
                        customId: otherUser.customId,
                        profileBgUrl: otherUser.profileBgUrl
                    });
                }
            }
        }
    });

    if (Array.isArray(user.following)) {
        user.following.forEach(followedUid => {
            const followedUser = users.find(u => u.uid === followedUid);
            if (followedUser && !contacts.has(followedUser.uid)) {
                contacts.set(followedUser.uid, {
                    uid: followedUser.uid,
                    username: followedUser.username,
                    customId: followedUser.customId,
                    profileBgUrl: followedUser.profileBgUrl
                });
            }
        });
    }

    res.json(Array.from(contacts.values()));
});


// بدء محادثة خاصة (Private Chat)
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.user1Id === user1Id && chat.user2Id === user2Id) ||
         (chat.user1Id === user2Id && chat.user2Id === user1Id))
    );

    if (existingChat) {
        if (existingChat.user1Id === user1Id) {
            existingChat.contactName = contactName;
        }
        return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
    }

    const newChat = {
        id: uuidv4(),
        type: 'private',
        user1Id,
        user2Id,
        user1Name,
        user2Name,
        user1CustomId,
        user2CustomId,
        contactName,
        messages: []
    };
    chats.push(newChat);
    console.log('تم إنشاء محادثة خاصة جديدة:', newChat);
    res.status(201).json({ message: 'تم إنشاء المحادثة بنجاح.', chatId: newChat.id });
});

// تحديث اسم جهة الاتصال في محادثة خاصة
app.put('/api/chats/private/:chatId/contact-name', (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    const chat = chats.find(c => c.id === chatId && c.type === 'private');
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
    }

    if (chat.user1Id === userId) {
        chat.contactName = newContactName;
        res.json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } else if (chat.user2Id === userId) {
        res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الاسم.' });
    } else {
        res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه المحادثة.' });
    }
});


// حذف محادثة لمستخدم واحد
app.delete('/api/chats/:chatId/delete-for-user', (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;

    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];

    if (chat.type === 'private') {
        if (chat.user1Id === userId || chat.user2Id === userId) {
            chats.splice(chatIndex, 1);
            return res.json({ message: 'تم حذف المحادثة من عندك.' });
        }
        res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });

    } else if (chat.type === 'group') {
        const participantIndex = chat.participants.findIndex(p => p.uid === userId);
        if (participantIndex === -1) {
            return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
        }

        if (chat.participants.length === 1) {
            chats.splice(chatIndex, 1);
            return res.json({ message: 'تم حذف المجموعة بالكامل (كنت آخر عضو).' });
        }

        if (chat.adminId === userId && chat.participants.filter(p => p.role === 'admin').length === 1) {
            const newAdmin = chat.participants.find(p => p.uid !== userId);
            if (newAdmin) {
                newAdmin.role = 'admin';
                chat.adminId = newAdmin.uid;
                chat.participants.splice(participantIndex, 1);
                return res.json({ message: 'تم مغادرة المجموعة وتعيين مشرف جديد.' });
            } else {
                return res.status(400).json({ error: 'لا يمكن مغادرة المجموعة: يجب تعيين مشرف جديد أولاً.' });
            }
        }
        
        chat.participants.splice(participantIndex, 1);
        res.json({ message: 'تم مغادرة المجموعة بنجاح وحذف المحادثة من عندك.' });
    }
});


// حذف محادثة من الطرفين (خاصة فقط)
app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;

    const chatIndex = chats.findIndex(chat => chat.id === chatId && chat.type === 'private');
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
    }

    const chat = chats[chatIndex];

    if (chat.user1Id !== callerUid && chat.user2Id !== callerUid) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });
    }

    chats.splice(chatIndex, 1);
    res.json({ message: 'تم حذف المحادثة من الطرفين.' });
});


// إرسال رسالة في الدردشة (تدعم النصوص، الصور، والفيديو)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    if (chat.type === 'private' && !(chat.user1Id === senderId || chat.user2Id === senderId)) {
        return res.status(403).json({ error: 'أنت لست جزءًا من هذه المحادثة.' });
    }
    if (chat.type === 'group' && !chat.participants.some(p => p.uid === senderId)) {
        return res.status(403).json({ error: 'أنت لست جزءًا من هذه المجموعة.' });
    }

    if (!text && !mediaFile) {
        return res.status(400).json({ error: 'الرسالة لا يمكن أن تكون فارغة (نص أو ملف).' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        const fileExtension = mediaFile.originalname.split('.').pop();
        const fileName = `${senderId}/chat_media/${uuidv4()}.${fileExtension}`;

        // **تغيير مهم**: استخدام PutObjectCommand مع S3Client
        const uploadParams = {
            Bucket: STORJ_BUCKET_NAME,
            Key: fileName,
            Body: mediaFile.buffer,
            ContentType: mediaFile.mimetype,
            ContentLength: mediaFile.buffer.length, // التأكد من وجود ContentLength
            ACL: 'public-read'
        };

        try {
            const command = new PutObjectCommand(uploadParams);
            await s3Client.send(command); // إرسال الأمر
            mediaUrl = `${STORJ_ENDPOINT}/${STORJ_BUCKET_NAME}/${fileName}`; // بناء URL يدوياً
            console.log(`تم تحميل ملف الدردشة: ${mediaUrl}`);
        } catch (error) {
            console.error('خطأ في تحميل ملف الوسائط للدردشة إلى Storj DCS:', error);
            return res.status(500).json({ error: `فشل تحميل ملف الوسائط للدردشة: ${error.message}` });
        }
    }

    const newMessage = {
        id: uuidv4(),
        senderId,
        senderName,
        text,
        timestamp: Date.now(),
        mediaUrl: mediaUrl,
        mediaType: mediaType || 'text',
        sender_profile_bg: senderProfileBg || null
    };
    
    if (!Array.isArray(chat.messages)) {
        chat.messages = [];
    }

    chat.messages.push(newMessage);
    console.log(`رسالة جديدة في الدردشة ${chatId} من ${senderName}:`, newMessage);
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', message: newMessage });
});


// جلب رسائل الدردشة
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since || '0');

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    const messagesToReturn = Array.isArray(chat.messages) ? chat.messages.filter(msg => msg.timestamp > since) : [];
    res.json(messagesToReturn);
});

// ----------------------------------------------------
// مسارات API - المجموعات (Group Routes)
// ----------------------------------------------------

// إنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، معرف المشرف، وعضوين على الأقل مطلوبون.' });
    }

    const adminUser = users.find(u => u.uid === adminId);
    if (!adminUser) {
        return res.status(404).json({ error: 'المشرف غير موجود.' });
    }

    const participants = [];
    for (const uid in members) {
        const user = users.find(u => u.uid === uid);
        if (user) {
            participants.push({
                uid: user.uid,
                username: user.username,
                customId: user.customId,
                profileBgUrl: user.profileBgUrl,
                role: members[uid]
            });
        }
    }

    if (participants.length < 2) {
        return res.status(400).json({ error: 'المجموعة تحتاج عضوين على الأقل (بما في ذلك المشرف).' });
    }

    const newGroup = {
        id: uuidv4(),
        type: 'group',
        name,
        description,
        adminId,
        participants,
        messages: [],
        profileBg: null
    };
    chats.push(newGroup);
    console.log('تم إنشاء مجموعة جديدة:', newGroup);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroup.id });
});

// إضافة أعضاء إلى مجموعة (فقط للمشرفين)
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerParticipant = group.participants.find(p => p.uid === callerUid);
    if (!callerParticipant || callerParticipant.role !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى هذه المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(newUid => {
        const userToAdd = users.find(u => u.uid === newUid);
        if (userToAdd && !group.participants.some(p => p.uid === newUid)) {
            group.participants.push({
                uid: userToAdd.uid,
                username: userToAdd.username,
                customId: userToAdd.customId,
                profileBgUrl: userToAdd.profileBgUrl,
                role: 'member'
            });
            addedMembers.push(userToAdd.username);
        }
    });

    if (addedMembers.length > 0) {
        res.json({ message: `تم إضافة الأعضاء: ${addedMembers.join(', ')} إلى المجموعة.` });
    } else {
        res.status(400).json({ error: 'لم تتم إضافة أي أعضاء جدد (ربما موجودون بالفعل).' });
    }
});


// جلب أعضاء المجموعة
app.get('/api/group/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.json(group.participants);
});

// جلب عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.json({ count: group.participants ? group.participants.length : 0 });
});

// تغيير دور عضو في المجموعة (فقط للمشرفين)
app.put('/api/group/:groupId/members/:memberUid/role', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    const targetMember = group.participants.find(p => p.uid === memberUid);

    if (!caller || caller.role !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير دور الأعضاء.' });
    }
    if (!targetMember) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    if (targetMember.uid === group.adminId && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكن للمشرفين غير المالكين تغيير دور مالك المجموعة.' });
    }

    if (targetMember.uid === callerUid && newRole === 'member') {
        const adminsCount = group.participants.filter(p => p.role === 'admin').length;
        if (adminsCount === 1 && targetMember.uid === group.adminId) {
            return res.status(400).json({ error: 'لا يمكنك إزالة نفسك من الإشراف إذا كنت المالك والمشرف الوحيد. قم بتعيين مشرف آخر أولاً.' });
        }
    }

    targetMember.role = newRole;
    res.json({ message: `تم تغيير دور ${targetMember.username} إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });
});

// إزالة عضو من المجموعة (فقط للمشرفين)
app.delete('/api/group/:groupId/members/:memberUid', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    const targetMemberIndex = group.participants.findIndex(p => p.uid === memberUid);

    if (!caller || caller.role !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة أعضاء من هذه المجموعة.' });
    }
    if (targetMemberIndex === -1) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    const targetMember = group.participants[targetMemberIndex];

    if (targetMember.uid === group.adminId && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }

    if (targetMember.uid === group.adminId && group.participants.length === 1) {
        chats = chats.filter(c => c.id !== groupId);
        return res.json({ message: `تم إزالة ${targetMember.username} وتم حذف المجموعة بالكامل.` });
    }

    group.participants.splice(targetMemberIndex, 1);
    res.json({ message: `تم إزالة ${targetMember.username} من المجموعة.` });
});


// تغيير اسم المجموعة (فقط للمشرفين)
app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    if (!newName) {
        return res.status(400).json({ error: 'اسم المجموعة الجديد مطلوب.' });
    }

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    if (!caller || caller.role !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير اسم المجموعة.' });
    }

    group.name = newName;
    res.json({ message: 'تم تحديث اسم المجموعة بنجاح.' });
});


// بدء تشغيل الخادم
app.listen(PORT, () => {
    console.log(`خادم وتسليجرم يعمل على http://localhost:${PORT}`);
    console.log('تأكد من تحديث backendUrl في الواجهة الأمامية إلى هذا الرابط.');
    console.log('**تحذير هام: جميع بيانات المستخدمين والمنشورات والمحادثات ستفقد عند إعادة تشغيل الخادم لأنها مخزنة في الذاكرة. لتطبيق حقيقي، يجب دمج قاعدة بيانات دائمة (مثل PostgreSQL).**');
});
