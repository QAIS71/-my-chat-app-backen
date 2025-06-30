// استيراد المكتبات الضرورية
const express = require('express');
const cors = require('cors');
const multer = require('multer'); // لمعالجة رفع الملفات
const AWS = require('aws-sdk'); // للتفاعل مع Storj DCS (المتوافق مع S3 API)
const { v4: uuidv4 } = require('uuid'); // لتوليد معرفات فريدة للملفات

// تهيئة تطبيق Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // تمكين CORS لتمكين الواجهة الأمامية من الاتصال
app.use(express.json()); // لتمكين تحليل JSON في جسم الطلبات

// ----------------------------------------------------
// معلومات اتصال Storj DCS - تم تحديث هذه القيم بمفاتيحك الحقيقية
// من ملف Storj-S3-Credentials- Watsaligram-App-Key-2025-06-29T11_08_36.629Z.txt
[cite_start]const STORJ_ACCESS_KEY_ID = 'jwsutdemteo7a3odjeweckixb5oa'; [cite: 1]
[cite_start]const STORJ_SECRET_ACCESS_KEY = 'j3h3b4tvphprkdmfy7ntxw5el4wk46i6xhifxl573zuuogvfjorms'; [cite: 1]
[cite_start]const STORJ_ENDPOINT = 'https://gateway.storjshare.io'; [cite: 1]

// اسم الـ Bucket الذي حددته في الصورة
const STORJ_BUCKET_NAME = 'my-chat-uploads'; // اسم الـ Bucket الخاص بك

// تهيئة AWS S3 SDK للاتصال بـ Storj DCS
const s3 = new AWS.S3({
    accessKeyId: STORJ_ACCESS_KEY_ID,
    secretAccessKey: STORJ_SECRET_ACCESS_KEY,
    endpoint: new AWS.Endpoint(STORJ_ENDPOINT), // نقطة النهاية يجب أن تكون كائن Endpoint
    s3ForcePathStyle: true, // مهم لـ Storj DCS
    signatureVersion: 'v4',
    region: 'us-east-1' // المنطقة ليست مهمة لـ Storj DCS ولكنها مطلوبة من AWS SDK
});

// إعداد Multer لتخزين الملفات مؤقتًا في الذاكرة
// هذا مهم لأننا سنقوم بتحميلها إلى Storj DCS من الذاكرة
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
        password, // في بيئة الإنتاج، يجب تشفير كلمة المرور (Hashing)
        customId,
        profileBgUrl: null, // لا توجد خلفية ملف شخصي افتراضية
        followers: [], // لا يوجد متابعون في البداية
        following: [] // لا يتابع أحداً في البداية
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
    // إرجاع كائن المستخدم بأسماء خصائص camelCase
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
    const fileName = `${userId}/profile_bg/${uuidv4()}.${fileExtension}`; // مسار تخزين الملف في Bucket

    const params = {
        Bucket: STORJ_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read' // لجعل الملف متاحاً للعامة عبر URL
    };

    try {
        const data = await s3.upload(params).promise();
        user.profileBgUrl = data.Location; // حفظ URL العام للملف
        console.log(`تم تحميل خلفية الملف الشخصي لـ ${user.username}: ${user.profileBgUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: user.profileBgUrl });
    } catch (error) {
        console.error('خطأ في تحميل الملف إلى Storj DCS:', error);
        res.status(500).json({ error: 'فشل تحميل الملف.' });
    }
});

// جلب خلفية الملف الشخصي (إذا لزم الأمر، يمكن جلبها من كائن المستخدم مباشرة)
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
        const fileName = `${authorId}/posts/${uuidv4()}.${fileExtension}`; // مسار تخزين الملف في Bucket

        const params = {
            Bucket: STORJ_BUCKET_NAME,
            Key: fileName,
            Body: mediaFile.buffer,
            ContentType: mediaFile.mimetype,
            ACL: 'public-read' // لجعل الملف متاحاً للعامة
        };

        try {
            const data = await s3.upload(params).promise();
            mediaUrl = data.Location;
            console.log(`تم تحميل ملف الوسائط: ${mediaUrl}`);
        } catch (error) {
            console.error('خطأ في تحميل ملف الوسائط إلى Storj DCS:', error);
            return res.status(500).json({ error: 'فشل تحميل ملف الوسائط.' });
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
        mediaType: mediaType || 'text', // 'image', 'video', 'text'
        authorProfileBg: authorProfileBg || null // إضافة خلفية الملف الشخصي للمؤلف
    };
    posts.push(newPost);
    console.log('تم نشر منشور جديد:', newPost);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
});

// جلب جميع المنشورات
app.get('/api/posts', (req, res) => {
    // إرجاع المنشورات بترتيب زمني عكسي (الأحدث أولاً)
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
    const { q, filter, userId } = req.query; // q هو نص البحث، filter يمكن أن يكون 'all' أو 'followed'
    let filteredPosts = posts;

    // تطبيق الفلتر أولاً
    if (filter === 'followed' && userId) {
        const currentUser = users.find(u => u.uid === userId);
        if (currentUser) {
            filteredPosts = filteredPosts.filter(post => currentUser.following.includes(post.authorId));
        } else {
            return res.status(404).json({ error: 'المستخدم غير موجود للفلترة.' });
        }
    }

    // ثم تطبيق البحث
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
    const { userId } = req.body; // معرف المستخدم الذي شاهد المنشور

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    // تأكد أن post.views هو مصفوفة قبل الإضافة
    if (!Array.isArray(post.views)) {
        post.views = [];
    }

    // زيادة المشاهدات فقط إذا لم يشاهدها المستخدم من قبل (في هذه الجلسة/التخزين المؤقت)
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
    // تأكد أن post.likes هو مصفوفة قبل الإضافة
    if (!Array.isArray(post.likes)) {
        post.likes = [];
    }

    const index = post.likes.indexOf(userId);
    let isLiked = false;
    if (index > -1) {
        post.likes.splice(index, 1); // إزالة الإعجاب
        isLiked = false;
    } else {
        post.likes.push(userId); // إضافة إعجاب
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

    // تأكد أن post.comments هو مصفوفة قبل الإضافة
    if (!Array.isArray(post.comments)) {
        post.comments = [];
    }

    // جلب معلومات الملف الشخصي للمستخدم الذي يعلق
    const user = users.find(u => u.uid === userId);
    const userProfileBg = user ? user.profileBgUrl : null;

    const newComment = {
        id: uuidv4(),
        userId,
        username,
        text,
        timestamp: Date.now(),
        likes: [],
        userProfileBg // إضافة خلفية الملف الشخصي للتعليق
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
    // تأكد أن post.comments هو مصفوفة قبل الإرجاع
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
    // تأكد أن post.comments هو مصفوفة
    if (!Array.isArray(post.comments)) {
        post.comments = [];
    }

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) {
        return res.status(404).json({ error: 'التعليق غير موجود.' });
    }
    // تأكد أن comment.likes هو مصفوفة
    if (!Array.isArray(comment.likes)) {
        comment.likes = [];
    }

    const index = comment.likes.indexOf(userId);
    let isLiked = false;
    if (index > -1) {
        comment.likes.splice(index, 1); // إزالة الإعجاب
        isLiked = false;
    } else {
        comment.likes.push(userId); // إضافة إعجاب
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

    // تأكد أن القوائم هي مصفوفات
    if (!Array.isArray(follower.following)) {
        follower.following = [];
    }
    if (!Array.isArray(following.followers)) {
        following.followers = [];
    }

    const index = follower.following.indexOf(followingId);
    let isFollowing = false;
    if (index > -1) {
        follower.following.splice(index, 1); // إلغاء المتابعة
        following.followers = following.followers.filter(id => id !== followerId); // إزالة من قائمة المتابعين
        isFollowing = false;
        res.json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing });
    } else {
        follower.following.push(followingId); // متابعة
        following.followers.push(followerId); // إضافة إلى قائمة المتابعين
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
        // تجهيز بيانات الدردشة لإرسالها للواجهة الأمامية
        if (chat.type === 'private') {
            const otherParticipantId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
            const otherParticipantName = chat.user1Id === userId ? chat.user2Name : chat.user1Name;
            const otherParticipantCustomId = chat.user1Id === userId ? chat.user2CustomId : chat.user1CustomId;
            const otherParticipantProfileBg = chat.user1Id === userId ? users.find(u => u.uid === chat.user2Id)?.profileBgUrl : users.find(u => u.uid === chat.user1Id)?.profileBgUrl;

            // استخدام contactName إذا كان متاحًا، وإلا اسم الطرف الآخر
            const contactName = chat.contactName; 
            
            // جلب آخر رسالة للطابع الزمني (timestamp)
            const lastMessage = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
            const lastMessageText = lastMessage ? (lastMessage.text || lastMessage.mediaType === 'image' ? '🖼️ صورة' : lastMessage.mediaType === 'video' ? '🎥 فيديو' : '') : '';
            const lastMessageTimestamp = lastMessage ? lastMessage.timestamp : 0;


            return {
                id: chat.id,
                type: 'private',
                name: contactName || otherParticipantName, // اسم جهة الاتصال أو اسم الطرف الآخر
                lastMessage: lastMessageText,
                timestamp: lastMessageTimestamp,
                customId: otherParticipantCustomId,
                profileBg: otherParticipantProfileBg // ملف تعريف الطرف الآخر
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
                adminId: chat.adminId, // معرف المالك (المنشئ)
                lastMessage: lastMessageText,
                timestamp: lastMessageTimestamp,
                profileBg: chat.profileBg || null // خلفية المجموعة إن وجدت
            };
        }
    });

    // فرز المحادثات حسب آخر طابع زمني (الأحدث أولاً)
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

    const contacts = new Map(); // لتجنب التكرار

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

    // إضافة المستخدمين الذين يتابعهم المستخدم الحالي إلى قائمة جهات الاتصال المحتملة
    // هذا يسمح بإضافة أعضاء إلى مجموعة حتى لو لم يكن هناك دردشة فردية سابقة
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

    // التحقق مما إذا كانت المحادثة موجودة بالفعل
    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.user1Id === user1Id && chat.user2Id === user2Id) ||
         (chat.user1Id === user2Id && chat.user2Id === user1Id))
    );

    if (existingChat) {
        // إذا كانت المحادثة موجودة، قم بتحديث contactName للمستخدم الحالي
        if (existingChat.user1Id === user1Id) {
            existingChat.contactName = contactName;
        }
        // لا نحتاج لتحديث contactName2 هنا، فقط contactName للمستخدم الذي بدأ المحادثة
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
        contactName, // الاسم الذي يحفظ به user1 هذا الاتصال
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

    // تأكد أن المستخدم الذي يطلب التعديل هو أحد طرفي المحادثة
    if (chat.user1Id === userId) {
        chat.contactName = newContactName;
        res.json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } else if (chat.user2Id === userId) {
        // إذا كان المستخدم الثاني هو من يطلب التغيير، قم بتحديث الاسم الخاص به
        // (افتراضياً ليس لدينا حقل contactName منفصل لـ user2 في هيكل البيانات هذا
        //  لذا سنفترض أن التغيير ينطبق على contactName للمحادثة بشكل عام أو يتم تجاهله لـ user2)
        // في تطبيق حقيقي، ستحتاج إلى حقل contactName لكل مستخدم يرى هذه المحادثة
        // على سبيل المثال: chat.user1ContactName, chat.user2ContactName
        res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الاسم.' });
    } else {
        res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه المحادثة.' });
    }
});


// حذف محادثة لمستخدم واحد
app.delete('/api/chats/:chatId/delete-for-user', (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body; // معرف المستخدم الذي يطلب الحذف

    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];

    if (chat.type === 'private') {
        // للمحادثات الخاصة، لا يمكن حذفها "من عندي فقط" إلا إذا كان هناك دعم لذلك.
        // في هذا النموذج البسيط، حذف محادثة يعني حذفها من ذاكرة الخادم.
        // لتطبيق "حذف من عندي فقط"، ستحتاج إلى قاعدة بيانات لكل مستخدم تحدد المحادثات المرئية له.
        // للتوضيح، سنقوم بإزالتها مؤقتًا من القائمة إذا كان المستخدم هو user1 أو user2
        if (chat.user1Id === userId || chat.user2Id === userId) {
            // هذا المنطق سيؤدي إلى حذفها للجميع في النهاية
            // For a "delete for me" in a real app, you would mark the chat as hidden/deleted
            // for that specific user in a user-specific chat list in a persistent DB.
            chats.splice(chatIndex, 1);
            return res.json({ message: 'تم حذف المحادثة من عندك.' });
        }
        res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });

    } else if (chat.type === 'group') {
        // لمغادرة المجموعة
        const participantIndex = chat.participants.findIndex(p => p.uid === userId);
        if (participantIndex === -1) {
            return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
        }

        // إذا كان المستخدم هو آخر عضو، قم بحذف المجموعة بالكامل
        if (chat.participants.length === 1) {
            chats.splice(chatIndex, 1);
            return res.json({ message: 'تم حذف المجموعة بالكامل (كنت آخر عضو).' });
        }

        // إذا كان المستخدم هو المشرف الوحيد، قم بتعيين مشرف جديد أو منع المغادرة
        if (chat.adminId === userId && chat.participants.filter(p => p.role === 'admin').length === 1) {
            // ابحث عن عضو آخر لجعله مشرفًا، أو اطلب من المستخدم تعيين مشرف قبل المغادرة
            const newAdmin = chat.participants.find(p => p.uid !== userId);
            if (newAdmin) {
                newAdmin.role = 'admin'; // تعيين مشرف جديد
                chat.adminId = newAdmin.uid; // تحديث معرف المشرف
                chat.participants.splice(participantIndex, 1); // إزالة المستخدم الحالي
                return res.json({ message: 'تم مغادرة المجموعة وتعيين مشرف جديد.' });
            } else {
                // هذا السيناريو لا ينبغي أن يحدث إذا تم التعامل مع آخر عضو بشكل منفصل
                return res.status(400).json({ error: 'لا يمكن مغادرة المجموعة: يجب تعيين مشرف جديد أولاً.' });
            }
        }
        
        // إزالة المستخدم من قائمة المشاركين في المجموعة
        chat.participants.splice(participantIndex, 1);
        res.json({ message: 'تم مغادرة المجموعة بنجاح وحذف المحادثة من عندك.' });
    }
});


// حذف محادثة من الطرفين (خاصة فقط)
app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body; // معرف المستخدم الذي يطلب الحذف

    const chatIndex = chats.findIndex(chat => chat.id === chatId && chat.type === 'private');
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
    }

    const chat = chats[chatIndex];

    // تحقق مما إذا كان callerUid هو أحد المشاركين
    if (chat.user1Id !== callerUid && chat.user2Id !== callerUid) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });
    }

    // في هذا النموذج البسيط، "الحذف من الطرفين" يعني حذف المحادثة بالكامل
    // في تطبيق حقيقي، هذا سيتطلب منطقًا أكثر تعقيدًا لحذف الرسائل من قاعدة البيانات لكل مستخدم.
    chats.splice(chatIndex, 1);
    res.json({ message: 'تم حذف المحادثة من الطرفين.' });
});


// إرسال رسالة في الدردشة (تدعم النصوص، الصور، والفيديو)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body; // senderProfileBg هو URL
    const mediaFile = req.file; // ملف الوسائط إذا تم إرساله

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    // تحقق من أن المرسل هو مشارك في المحادثة (خاصة أو مجموعة)
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
        const fileName = `${senderId}/chat_media/${uuidv4()}.${fileExtension}`; // مسار تخزين الملف في Bucket

        const params = {
            Bucket: STORJ_BUCKET_NAME,
            Key: fileName,
            Body: mediaFile.buffer,
            ContentType: mediaFile.mimetype,
            ACL: 'public-read'
        };

        try {
            const data = await s3.upload(params).promise();
            mediaUrl = data.Location;
            console.log(`تم تحميل ملف الدردشة: ${mediaUrl}`);
        } catch (error) {
            console.error('خطأ في تحميل ملف الوسائط للدردشة إلى Storj DCS:', error);
            return res.status(500).json({ error: 'فشل تحميل ملف الوسائط للدردشة.' });
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
        sender_profile_bg: senderProfileBg || null // إضافة خلفية الملف الشخصي للمرسل
    };
    
    // تأكد أن chat.messages هو مصفوفة قبل الإضافة
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
    const since = parseInt(req.query.since || '0'); // جلب الرسائل الأحدث من هذا الطابع الزمني

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    // تأكد أن chat.messages هو مصفوفة قبل التصفية
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
                role: members[uid] // 'admin' أو 'member'
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
        adminId, // معرف المستخدم الذي قام بإنشاء المجموعة (المالك)
        participants,
        messages: [],
        profileBg: null // يمكن إضافة خلفية للمجموعة لاحقاً
    };
    chats.push(newGroup);
    console.log('تم إنشاء مجموعة جديدة:', newGroup);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroup.id });
});

// إضافة أعضاء إلى مجموعة (فقط للمشرفين)
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body; // معرفات UID للأعضاء الجدد، وUID للمستخدم الذي يطلب الإضافة

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // تحقق مما إذا كان المستخدم الذي يطلب الإضافة هو مشرف
    const callerParticipant = group.participants.find(p => p.uid === callerUid);
    if (!callerParticipant || callerParticipant.role !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى هذه المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(newUid => {
        const userToAdd = users.find(u => u.uid === newUid);
        // تحقق مما إذا كان المستخدم موجوداً بالفعل في المجموعة
        if (userToAdd && !group.participants.some(p => p.uid === newUid)) {
            group.participants.push({
                uid: userToAdd.uid,
                username: userToAdd.username,
                customId: userToAdd.customId,
                profileBgUrl: userToAdd.profileBgUrl,
                role: 'member' // الأعضاء المضافون افتراضياً هم "أعضاء" وليسوا "مشرفين"
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
    const { newRole, callerUid } = req.body; // newRole: 'admin' or 'member', callerUid: UID of user performing action

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

    // لا يمكن للمشرف العادي تغيير دور المالك
    if (targetMember.uid === group.adminId && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكن للمشرفين غير المالكين تغيير دور مالك المجموعة.' });
    }

    // لا يمكن لأحد أن يزيل نفسه من الإشراف إذا كان هو المشرف الوحيد
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
    const { callerUid } = req.body; // UID of user performing action

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

    // المشرف لا يمكنه إزالة مالك المجموعة (إلا إذا كان هو المالك نفسه ويقوم بإزالة نفسه كآخر عضو)
    if (targetMember.uid === group.adminId && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }

    // إذا كان العضو المستهدف هو المالك وآخر عضو في المجموعة
    if (targetMember.uid === group.adminId && group.participants.length === 1) {
        // إذا كان المالك هو نفسه الذي يطلب الإزالة، ومعه آخر عضو، فيمكن حذف المجموعة بالكامل
        chats = chats.filter(c => c.id !== groupId); // حذف المجموعة
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
    console.log('**تحذير هام: جميع بيانات المستخدمين والمنشورات والمحادثات ستفقد عند إعادة تشغيل الخادم لأنها مخزنة في الذاكرة. لتطبيق حقيقي، يجب دمج قاعدة بيانات دائمة (مثل MongoDB أو PostgreSQL).**');
});
