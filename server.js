// استيراد المكتبات المطلوبة
const express = require('express'); // إطار عمل Express لإنشاء الخادم
const bodyParser = require('body-parser'); // لتحليل نصوص طلبات HTTP
const cors = require('cors'); // للتعامل مع سياسات CORS (Cross-Origin Resource Sharing)
const multer = require('multer'); // للتعامل مع تحميل الملفات (الصور والفيديوهات)
const { v4: uuidv4 } = require('uuid'); // لإنشاء معرفات فريدة عالمياً (UUIDs)
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'); // عميل Storj DCS S3
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner'); // لإنشاء روابط مؤقتة للملفات
const path = require('path'); // للتعامل مع مسارات الملفات
const fs = require('fs'); // للتعامل مع نظام الملفات (للملفات المؤقتة)

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000; // استخدام المنفذ المحدد بواسطة البيئة (مثلاً Render) أو المنفذ 3000 افتراضياً

// ----------------------------------------------------------------------------------------------------
// مفاتيح Storj DCS - تم تضمينها مباشرة هنا بناءً على طلبك
// ملاحظة: في بيئة إنتاج حقيقية، يفضل استخدام متغيرات البيئة لأسباب أمنية.
// ----------------------------------------------------------------------------------------------------
const STORJ_ENDPOINT = "https://gateway.storjshare.io";
const STORJ_REGION = "us-east-1"; // يمكن أن يكون أي شيء لـ Storj
const STORJ_ACCESS_KEY_ID = "jwsutdemteo7a3odjeweckixb5oa";
const STORJ_SECRET_ACCESS_KEY = "j3h3b4tvphprkdmfy7ntxw5el4wk46i6xhifxl573zuuogfjorms"; // تأكد من صحة هذا المفتاح السري
const STORJ_BUCKET_NAME = "my-chat-uploads"; // تم تصحيح هذا الاسم ليتطابق مع الصورة

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
// Middleware (البرمجيات الوسيطة)
// ----------------------------------------------------------------------------------------------------

// تمكين CORS لجميع الطلبات
// هذا يسمح للواجهة الأمامية (Netlify) بالاتصال بالخادم الخلفي (Render)
app.use(cors());

// تحليل نصوص JSON في طلبات HTTP
app.use(bodyParser.json());

// ----------------------------------------------------------------------------------------------------
// قاعدة بيانات مؤقتة في الذاكرة (لأغراض العرض التوضيحي)
// في تطبيق حقيقي، ستستخدم قاعدة بيانات دائمة مثل MongoDB أو PostgreSQL
// ----------------------------------------------------------------------------------------------------

let users = []; // لتخزين بيانات المستخدمين (username, password, uid, customId, profileBgUrl)
let posts = []; // لتخزين المنشورات (text, mediaUrl, mediaType, authorId, authorName, likes, comments, views, timestamp)
let chats = []; // لتخزين المحادثات (id, type, participants, messages, lastMessage, timestamp)

// ----------------------------------------------------------------------------------------------------
// وظائف المساعدة (Helper Functions)
// ----------------------------------------------------------------------------------------------------

// وظيفة لإنشاء معرف مستخدم فريد مكون من 8 أرقام
function generateCustomId() {
    let id;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 أرقام
    } while (users.some(user => user.customId === id)); // التأكد من أنه فريد
    return id;
}

// ----------------------------------------------------------------------------------------------------
// نقاط نهاية API (API Endpoints)
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية تسجيل المستخدم
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    if (users.some(user => user.username === username)) {
        return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
    }

    const uid = uuidv4(); // إنشاء معرف فريد للمستخدم
    const customId = generateCustomId(); // إنشاء معرف مخصص من 8 أرقام
    const newUser = {
        uid,
        username,
        password, // في تطبيق حقيقي، يجب تشفير كلمة المرور
        customId,
        profileBg: null // لا توجد خلفية ملف شخصي افتراضياً
    };
    users.push(newUser);
    console.log('User registered:', newUser.username, 'UID:', newUser.uid, 'Custom ID:', newUser.customId);
    res.status(201).json({ message: 'تم التسجيل بنجاح.', user: { uid, username, customId, profileBg: null } });
});

// نقطة نهاية تسجيل الدخول
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const user = users.find(u => u.username === username && u.password === password); // في تطبيق حقيقي، تحقق من كلمة المرور المشفرة

    if (!user) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    console.log('User logged in:', user.username);
    res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg } });
});

// نقطة نهاية للحصول على معلومات المستخدم بواسطة customId
app.get('/api/user/by-custom-id/:customId', (req, res) => {
    const { customId } = req.params;
    const user = users.find(u => u.customId === customId);
    if (user) {
        // لا ترسل كلمة المرور
        res.status(200).json({ uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg });
    } else {
        res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
});

// نقطة نهاية لرفع خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const uploadedFile = req.file; // تم تصحيح: استخدام uploadedFile بدلاً من file

    if (!userId || !uploadedFile) { // تم تصحيح: استخدام uploadedFile
        return res.status(400).json({ error: 'معرف المستخدم والملف مطلوبان.' });
    }

    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const fileExtension = path.extname(uploadedFile.originalname); // تم تصحيح: استخدام uploadedFile
    const fileName = `${uuidv4()}${fileExtension}`;
    const filePath = `profile_bg/${fileName}`; // مسار التخزين في الباكت

    const params = {
        Bucket: bucketName,
        Key: filePath,
        Body: uploadedFile.buffer, // تم تصحيح: استخدام uploadedFile
        ContentType: uploadedFile.mimetype, // تم تصحيح: استخدام uploadedFile
    };

    try {
        await s3Client.send(new PutObjectCommand(params));
        const mediaUrl = `/api/media/${userId}/${filePath}`; // رابط الوكالة (proxy URL)
        user.profileBg = mediaUrl; // تحديث خلفية الملف الشخصي للمستخدم

        console.log(`تم تحميل خلفية الملف الشخصي للمستخدم ${userId}: ${mediaUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: mediaUrl });
    } catch (error) {
        console.error('ERROR: Failed to upload profile background to Storj DCS:', error);
        res.status(500).json({ error: 'فشل تحميل الخلفية.' });
    }
});

// نقطة نهاية للحصول على عدد متابعي مستخدم معين
app.get('/api/user/:userId/followers/count', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    let followerCount = 0;
    // حساب عدد المتابعين (المستخدمين الذين يتابعون هذا المستخدم)
    users.forEach(u => {
        if (u.following && u.following.includes(userId)) {
            followerCount++;
        }
    });
    res.status(200).json({ count: followerCount });
});

// نقطة نهاية للحصول على حالة المتابعة بين مستخدمين
app.get('/api/user/:followerId/following/:followedId', (req, res) => {
    const { followerId, followedId } = req.params;
    const followerUser = users.find(u => u.uid === followerId);

    if (!followerUser) {
        return res.status(404).json({ error: 'المستخدم المتابع غير موجود.' });
    }

    const isFollowing = followerUser.following && followerUser.following.includes(followedId);
    res.status(200).json({ isFollowing });
});

// نقطة نهاية للمتابعة/إلغاء المتابعة
app.post('/api/user/:followerId/follow/:followedId', (req, res) => {
    const { followerId, followedId } = req.params;

    const followerUser = users.find(u => u.uid === followerId);
    const followedUser = users.find(u => u.uid === followedId);

    if (!followerUser || !followedUser) {
        return res.status(404).json({ error: 'المستخدم (المتابع أو المتابع) غير موجود.' });
    }
    if (followerId === followedId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    if (!followerUser.following) {
        followerUser.following = [];
    }

    let message;
    if (followerUser.following.includes(followedId)) {
        // إلغاء المتابعة
        followerUser.following = followerUser.following.filter(id => id !== followedId);
        message = 'تم إلغاء المتابعة.';
        res.status(200).json({ message, isFollowing: false });
    } else {
        // متابعة
        followerUser.following.push(followedId);
        message = 'تمت المتابعة بنجاح.';
        res.status(200).json({ message, isFollowing: true });
    }
    console.log(`User ${followerUser.username} ${message} user ${followedUser.username}`);
});

// نقطة نهاية للحصول على جهات الاتصال (المستخدمين الذين أجرى معهم المستخدم الحالي محادثات فردية)
app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const userContacts = [];
    
    // ابحث عن جميع المحادثات الفردية التي يشارك فيها هذا المستخدم
    chats.forEach(chat => {
        if (chat.type === 'private' && chat.participants.includes(userId)) {
            // ابحث عن الشريك الآخر في المحادثة
            const otherParticipantId = chat.participants.find(pId => pId !== userId);
            const otherUser = users.find(u => u.uid === otherParticipantId);
            if (otherUser) {
                // أضف معلومات الشريك (بدون كلمة المرور)
                userContacts.push({
                    uid: otherUser.uid,
                    username: otherUser.username,
                    customId: otherUser.customId,
                    profileBg: otherUser.profileBg
                });
            }
        }
    });

    // إزالة أي تكرارات (إذا كان المستخدم قد أجرى محادثات متعددة مع نفس الشخص)
    const uniqueContacts = Array.from(new Map(userContacts.map(contact => [contact.uid, contact])).values());

    res.status(200).json(uniqueContacts);
});

// نقطة نهاية لنشر منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file; // تم تصحيح: استخدام mediaFile بدلاً من file

    if (!authorId || !authorName || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'المعرف، الاسم، والنص أو ملف الوسائط مطلوب.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        const fileExtension = path.extname(mediaFile.originalname); // تم تصحيح: استخدام mediaFile
        const fileName = `${uuidv4()}${fileExtension}`;
        const filePath = `posts/${fileName}`; // مسار التخزين في الباكت

        const params = {
            Bucket: bucketName,
            Key: filePath,
            Body: mediaFile.buffer, // تم تصحيح: استخدام mediaFile
            ContentType: mediaFile.mimetype, // تم تصحيح: استخدام mediaFile
        };

        try {
            await s3Client.send(new PutObjectCommand(params));
            mediaUrl = `/api/media/${authorId}/${filePath}`; // رابط الوكالة (proxy URL)
            console.log(`تم تحميل ملف الوسائط للمنشور: ${mediaUrl}`);
        } catch (error) {
            console.error('ERROR: Failed to upload media to Storj DCS:', error);
            // لا تفشل العملية بالكامل إذا فشل تحميل الوسائط، ولكن لا تضع رابط الوسائط
            mediaUrl = null;
        }
    }

    const newPost = {
        id: uuidv4(),
        authorId,
        authorName,
        text: text || '',
        timestamp: Date.now(),
        likes: [],
        comments: [],
        views: [],
        mediaUrl: mediaUrl,
        mediaType: mediaType || 'text',
        authorProfileBg: authorProfileBg || null // إضافة خلفية ملف المؤلف
    };
    posts.push(newPost);
    console.log('تم نشر منشور جديد:', newPost);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
});

// نقطة نهاية للحصول على جميع المنشورات
app.get('/api/posts', (req, res) => {
    // يجب أن يتم إرجاع نسخة من المنشورات بدون الكائنات الداخلية مباشرة،
    // لضمان أن التعديلات على likes/comments/views لا تؤثر على الكائن الأصلي
    const postsCopy = posts.map(p => ({
        ...p,
        likes: JSON.stringify(p.likes), // تحويل المصفوفات إلى سلاسل JSON
        comments: JSON.stringify(p.comments),
        views: JSON.stringify(p.views)
    }));
    res.status(200).json(postsCopy);
});

// نقطة نهاية للحصول على منشورات المستخدمين الذين يتابعهم المستخدم الحالي
app.get('/api/posts/followed/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUser = users.find(u => u.uid === userId);

    if (!currentUser) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    const followedUsersIds = currentUser.following || [];
    const followedPosts = posts.filter(p => followedUsersIds.includes(p.authorId));

    const postsCopy = followedPosts.map(p => ({
        ...p,
        likes: JSON.stringify(p.likes),
        comments: JSON.stringify(p.comments),
        views: JSON.stringify(p.views)
    }));

    res.status(200).json(postsCopy);
});

// نقطة نهاية للبحث في المنشورات
app.get('/api/posts/search', (req, res) => {
    const { q, filter, userId } = req.query; // q هو نص البحث
    const searchTerm = q ? q.toLowerCase() : '';

    let filteredPosts = posts;

    if (filter === 'followed' && userId) {
        const currentUser = users.find(u => u.uid === userId);
        if (currentUser) {
            const followedUsersIds = currentUser.following || [];
            filteredPosts = filteredPosts.filter(p => followedUsersIds.includes(p.authorId));
        } else {
            return res.status(404).json({ error: 'المستخدم غير موجود للبحث في المتابعين.' });
        }
    }

    if (searchTerm) {
        filteredPosts = filteredPosts.filter(p =>
            p.text.toLowerCase().includes(searchTerm) ||
            p.authorName.toLowerCase().includes(searchTerm)
        );
    }

    const postsCopy = filteredPosts.map(p => ({
        ...p,
        likes: JSON.stringify(p.likes),
        comments: JSON.stringify(p.comments),
        views: JSON.stringify(p.views)
    }));

    res.status(200).json(postsCopy);
});

// نقطة نهاية لحذف منشور
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const postIndex = posts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    const deletedPost = posts[postIndex];

    // إذا كان المنشور يحتوي على وسائط، احذفها من Storj DCS
    if (deletedPost.mediaUrl) {
        // استخراج filePath من mediaUrl (مثال: /api/media/userId/posts/fileName.png)
        // نحتاج إلى الجزء بعد /api/media/userId/
        const urlParts = deletedPost.mediaUrl.split('/');
        // المسار في Storj DCS هو الجزء بعد /api/media/userId/
        // إذا كان mediaUrl: /api/media/ca84407f-2d3c-4457-939a-296fae747928/posts/f4139a0b-2548-441b-83cb-e1b5bcf2a399.png
        // فإن filePath هو posts/f4139a0b-2548-441b-83cb-e1b5bcf2a399.png
        // أو profile_bg/a80b7aeb-8ea4-4bf3-8bf6-d839d2fd4b2a.jpg
        const userIdPart = urlParts[3]; // ca84407f-2d3c-4457-939a-296fae747928
        const filePathInBucket = urlParts.slice(4).join('/'); // posts/f4139a0b-2548-441b-83cb-e1b5bcf2a399.png

        const params = {
            Bucket: bucketName,
            Key: filePathInBucket,
        };

        s3Client.send(new DeleteObjectCommand(params))
            .then(() => console.log(`تم حذف الملف من Storj DCS: ${filePathInBucket}`))
            .catch(error => console.error('ERROR: Failed to delete media from Storj DCS:', error));
    }

    posts.splice(postIndex, 1);
    console.log('تم حذف المنشور:', postId);
    res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
});

// نقطة نهاية للإعجاب بمنشور
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    if (!post.likes) {
        post.likes = [];
    }

    const userIndex = post.likes.indexOf(userId);
    let isLiked;
    if (userIndex === -1) {
        post.likes.push(userId); // إضافة إعجاب
        isLiked = true;
    } else {
        post.likes.splice(userIndex, 1); // إزالة إعجاب
        isLiked = false;
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', likesCount: post.likes.length, isLiked });
});

// نقطة نهاية لزيادة عدد المشاهدات
app.post('/api/posts/:postId/view', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    if (!post.views) {
        post.views = [];
    }

    // إضافة المشاهدة فقط إذا لم يشاهدها المستخدم من قبل
    if (!post.views.includes(userId)) {
        post.views.push(userId);
    }
    res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح.', viewsCount: post.views.length });
});

// نقطة نهاية لإضافة تعليق على منشور
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!text) {
        return res.status(400).json({ error: 'نص التعليق مطلوب.' });
    }

    if (!post.comments) {
        post.comments = [];
    }
    const user = users.find(u => u.uid === userId); // للحصول على profileBg للمستخدم
    const newComment = {
        id: uuidv4(),
        userId,
        username,
        text,
        timestamp: Date.now(),
        likes: [],
        userProfileBg: user ? user.profileBg : null // إضافة خلفية ملف المستخدم للتعليق
    };
    post.comments.push(newComment);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', comment: newComment });
});

// نقطة نهاية للحصول على تعليقات منشور
app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    // إرجاع التعليقات كـ JSON string لتجنب مشاكل التعديل المباشر
    res.status(200).json(JSON.stringify(post.comments || []));
});

// نقطة نهاية للإعجاب بتعليق
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

    if (!comment.likes) {
        comment.likes = [];
    }

    const userIndex = comment.likes.indexOf(userId);
    let isLiked;
    if (userIndex === -1) {
        comment.likes.push(userId); // إضافة إعجاب
        isLiked = true;
    } else {
        comment.likes.splice(userIndex, 1); // إزالة إعجاب
        isLiked = false;
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب بالتعليق بنجاح.', likesCount: comment.likes.length, isLiked });
});

// ----------------------------------------------------------------------------------------------------
// نقطة نهاية خدمة ملفات الوسائط (الصور والفيديوهات) - هذا هو الجزء الذي تم إصلاحه
// ----------------------------------------------------------------------------------------------------
app.get('/api/media/:userId/:folder/:fileName', async (req, res) => {
    const { userId, folder, fileName } = req.params;
    const filePathInBucket = `${folder}/${fileName}`; // مثال: posts/image.png أو profile_bg/image.jpg

    console.log(`DEBUG: طلب ملف وسائط: ${filePathInBucket} للمستخدم: ${userId}`);

    const params = {
        Bucket: bucketName,
        Key: filePathInBucket,
    };

    try {
        // استخدام GetObjectCommand لجلب الكائن من Storj DCS
        const data = await s3Client.send(new GetObjectCommand(params));

        if (!data.Body) {
            console.error(`ERROR: لا يوجد جسم للبيانات للملف: ${filePathInBucket}`);
            return res.status(404).send('الملف غير موجود أو فارغ.');
        }

        // تعيين نوع المحتوى (Content-Type) لكي يعرف المتصفح كيفية عرض الملف
        res.setHeader('Content-Type', data.ContentType || 'application/octet-stream');
        // تعيين حجم المحتوى (Content-Length)
        if (data.ContentLength) {
            res.setHeader('Content-Length', data.ContentLength);
        }
        // تعيين رأس Cache-Control للسماح بالتخزين المؤقت في المتصفح
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // التخزين المؤقت لمدة سنة

        // دفق (Stream) البيانات إلى الاستجابة
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
// وظائف الدردشة (Chat Functions)
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء محادثة فردية
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    // تحقق مما إذا كانت المحادثة موجودة بالفعل
    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.participants[0] === user1Id && chat.participants[1] === user2Id) ||
         (chat.participants[0] === user2Id && chat.participants[1] === user1Id))
    );

    if (existingChat) {
        console.log('محادثة فردية موجودة بالفعل:', existingChat.id);
        return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
    }

    const newChatId = uuidv4();
    const newChat = {
        id: newChatId,
        type: 'private',
        participants: [user1Id, user2Id],
        messages: [],
        lastMessage: null,
        timestamp: Date.now(),
        // تخزين معلومات الشريك للمستخدمين لسهولة العرض في قائمة الدردشات
        // user1 (current user) will see user2's name and customId
        // user2 will see user1's name and customId
        participantInfo: {
            [user1Id]: { name: user1Name, customId: user1CustomId },
            [user2Id]: { name: user2Name, customId: user2CustomId }
        },
        // تخزين اسم جهة الاتصال الذي حفظه user1 لـ user2
        contactNames: {
            [user1Id]: contactName, // user1 saves user2 as contactName
            [user2Id]: user1Name // user2 saves user1 as user1Name (default)
        }
    };
    chats.push(newChat);
    console.log('تم إنشاء محادثة فردية جديدة:', newChatId);
    res.status(201).json({ message: 'تم إنشاء المحادثة.', chatId: newChatId });
});

// نقطة نهاية لتعديل اسم جهة الاتصال في محادثة فردية
app.put('/api/chats/private/:chatId/contact-name', (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    const chat = chats.find(c => c.id === chatId && c.type === 'private' && c.participants.includes(userId));
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية التعديل.' });
    }

    chat.contactNames[userId] = newContactName;
    console.log(`تم تحديث اسم جهة الاتصال للمحادثة ${chatId} بواسطة ${userId} إلى ${newContactName}`);
    res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
});

// نقطة نهاية للحصول على جميع المحادثات لمستخدم معين
app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;
    const userChats = [];

    chats.forEach(chat => {
        if (chat.participants.includes(userId)) {
            let chatName = '';
            let chatCustomId = '';
            let chatProfileBg = null;
            let chatAdminId = null; // for groups

            if (chat.type === 'private') {
                // اسم المحادثة هو اسم جهة الاتصال الذي حفظه المستخدم
                chatName = chat.contactNames[userId];
                // معرف المستخدم الآخر
                const otherParticipantId = chat.participants.find(pId => pId !== userId);
                const otherUser = users.find(u => u.uid === otherParticipantId);
                if (otherUser) {
                    chatCustomId = otherUser.customId;
                    chatProfileBg = otherUser.profileBg;
                }
            } else if (chat.type === 'group') {
                chatName = chat.name;
                chatCustomId = null; // المجموعات ليس لها customId
                chatProfileBg = chat.profileBg || null; // خلفية المجموعة
                chatAdminId = chat.adminId; // مالك المجموعة
            }

            userChats.push({
                id: chat.id,
                type: chat.type,
                name: chatName,
                lastMessage: chat.lastMessage,
                timestamp: chat.timestamp,
                customId: chatCustomId, // معرف المستخدم الآخر للمحادثات الفردية
                profileBg: chatProfileBg, // خلفية ملف المستخدم الآخر أو خلفية المجموعة
                adminId: chatAdminId // مالك المجموعة (إذا كانت مجموعة)
            });
        }
    });

    // فرز المحادثات حسب الطابع الزمني لآخر رسالة (الأحدث أولاً)
    userChats.sort((a, b) => b.timestamp - a.timestamp);
    res.status(200).json(userChats);
});

// نقطة نهاية لإرسال رسالة في محادثة
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file; // تم تصحيح: استخدام mediaFile بدلاً من file

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    if (!chat.participants.includes(senderId)) {
        return res.status(403).json({ error: 'المستخدم ليس عضواً في هذه المحادثة.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        const fileExtension = path.extname(mediaFile.originalname); // تم تصحيح: استخدام mediaFile
        const fileName = `${uuidv4()}${fileExtension}`;
        const filePath = `chat_media/${fileName}`; // مسار التخزين في الباكت

        const params = {
            Bucket: bucketName,
            Key: filePath,
            Body: mediaFile.buffer, // تم تصحيح: استخدام mediaFile
            ContentType: mediaFile.mimetype, // تم تصحيح: استخدام mediaFile
        };

        try {
            await s3Client.send(new PutObjectCommand(params));
            mediaUrl = `/api/media/${senderId}/${filePath}`; // رابط الوكالة
            console.log(`تم تحميل ملف الوسائط للرسالة: ${mediaUrl}`);
        } catch (error) {
            console.error('ERROR: Failed to upload message media to Storj DCS:', error);
            mediaUrl = null;
        }
    }

    const newMessage = {
        id: uuidv4(),
        senderId,
        senderName,
        text: text || '',
        timestamp: Date.now(),
        mediaUrl: mediaUrl,
        mediaType: mediaType || 'text',
        senderProfileBg: senderProfileBg || null // إضافة خلفية ملف المرسل
    };

    chat.messages.push(newMessage);
    chat.lastMessage = mediaUrl ? (mediaType === 'image' ? 'صورة' : 'فيديو') : text; // تحديث آخر رسالة
    chat.timestamp = newMessage.timestamp; // تحديث طابع الوقت للمحادثة

    console.log('تم إرسال رسالة جديدة في المحادثة:', chatId, newMessage);
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageData: newMessage });
});

// نقطة نهاية للحصول على رسائل محادثة معينة (مع فلتر زمني)
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = parseInt(req.query.since || '0'); // جلب الرسائل الأحدث من هذا الطابع الزمني

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const filteredMessages = chat.messages.filter(msg => msg.timestamp > sinceTimestamp);
    res.status(200).json(filteredMessages);
});

// نقطة نهاية لحذف محادثة لمستخدم معين
app.delete('/api/chats/:chatId/delete-for-user', (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body; // المستخدم الذي يريد حذف المحادثة من عنده

    const chatIndex = chats.findIndex(c => c.id === chatId && c.participants.includes(userId));

    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو المستخدم ليس عضواً فيها.' });
    }

    // في هذا النموذج البسيط، سنقوم بإزالة المحادثة بالكامل من الذاكرة
    // في تطبيق حقيقي، ستقوم بتعيين علامة "محذوف لـ userId" أو إزالة userId من قائمة المشاركين
    // إذا كان هو المشارك الوحيد المتبقي.
    chats.splice(chatIndex, 1);
    console.log(`تم حذف المحادثة ${chatId} للمستخدم ${userId} فقط.`);
    res.status(200).json({ message: 'تم حذف المحادثة من عندك بنجاح.' });
});

// نقطة نهاية لحذف محادثة فردية من الطرفين
app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body; // المستخدم الذي بدأ الحذف

    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private' && c.participants.includes(callerUid));

    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية الحذف.' });
    }

    // في هذا النموذج البسيط، سنقوم بإزالة المحادثة بالكامل من الذاكرة
    // في تطبيق حقيقي، ستحتاج إلى حذف الرسائل من قاعدة البيانات لجميع المشاركين
    // ثم حذف المحادثة نفسها من قائمة المحادثات لكل مشارك.
    const chatToDelete = chats[chatIndex];

    // حذف ملفات الوسائط المرتبطة بالرسائل في هذه المحادثة من Storj DCS
    chatToDelete.messages.forEach(message => {
        if (message.mediaUrl) {
            const urlParts = message.mediaUrl.split('/');
            const filePathInBucket = urlParts.slice(4).join('/'); // chat_media/fileName.png
            const params = { Bucket: bucketName, Key: filePathInBucket };
            s3Client.send(new DeleteObjectCommand(params))
                .then(() => console.log(`تم حذف ملف الوسائط من Storj DCS: ${filePathInBucket}`))
                .catch(error => console.error('ERROR: Failed to delete message media from Storj DCS:', error));
        }
    });

    chats.splice(chatIndex, 1);
    console.log(`تم حذف المحادثة الفردية ${chatId} من الطرفين بواسطة ${callerUid}.`);
    res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
});

// ----------------------------------------------------------------------------------------------------
// وظائف المجموعة (Group Functions)
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء مجموعة جديدة
app.post('/api/groups', (req, res) => {
    const { name, description, adminId, members } = req.body; // members هو كائن {uid: role}

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، معرف المشرف، وعضوان على الأقل مطلوبان.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
        return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً.' });
    }

    const newGroupId = uuidv4();
    const newGroup = {
        id: newGroupId,
        type: 'group',
        name,
        description: description || '',
        adminId, // معرف المستخدم الذي أنشأ المجموعة (المالك)
        participants: Object.keys(members), // مصفوفة من معرفات المستخدمين
        memberRoles: members, // كائن {uid: role}
        messages: [],
        lastMessage: null,
        timestamp: Date.now(),
        profileBg: null // لا توجد خلفية مجموعة افتراضياً
    };
    chats.push(newGroup);
    console.log('تم إنشاء مجموعة جديدة:', newGroup);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroupId });
});

// نقطة نهاية لتغيير اسم المجموعة
app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // تحقق من صلاحية المتصل (يجب أن يكون مشرفاً)
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير اسم المجموعة.' });
    }

    group.name = newName;
    console.log(`تم تغيير اسم المجموعة ${groupId} إلى ${newName}`);
    res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
});

// نقطة نهاية للحصول على أعضاء المجموعة (مع الأدوار)
app.get('/api/group/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const membersInfo = group.participants.map(pId => {
        const user = users.find(u => u.uid === pId);
        if (user) {
            return {
                uid: user.uid,
                username: user.username,
                customId: user.customId,
                role: group.memberRoles[pId] || 'member' // افتراضي "عضو"
            };
        }
        return null;
    }).filter(Boolean); // إزالة أي قيم فارغة

    res.status(200).json(membersInfo);
});

// نقطة نهاية للحصول على عدد أعضاء المجموعة
app.get('/api/group/:groupId/members/count', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.status(200).json({ count: group.participants.length });
});

// نقطة نهاية لإضافة أعضاء إلى مجموعة موجودة
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // تحقق من صلاحية المتصل (يجب أن يكون مشرفاً)
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية إضافة أعضاء إلى هذه المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(uid => {
        if (!group.participants.includes(uid)) {
            const user = users.find(u => u.uid === uid);
            if (user) {
                group.participants.push(uid);
                group.memberRoles[uid] = 'member'; // الأعضاء الجدد ينضمون كأعضاء عاديين
                addedMembers.push(user.username);
            }
        }
    });

    if (addedMembers.length > 0) {
        console.log(`تم إضافة أعضاء جدد إلى المجموعة ${groupId}: ${addedMembers.join(', ')}`);
        res.status(200).json({ message: `تم إضافة ${addedMembers.length} أعضاء بنجاح: ${addedMembers.join(', ')}` });
    } else {
        res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
    }
});

// نقطة نهاية لتغيير دور عضو في المجموعة (مشرف/عضو)
app.put('/api/group/:groupId/members/:memberUid/role', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // يجب أن يكون المتصل مشرفاً
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير أدوار الأعضاء.' });
    }

    // لا يمكن للمشرف العادي تغيير دور المالك
    if (memberUid === group.adminId && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير دور مالك المجموعة.' });
    }

    // لا يمكن للمشرف العادي إزالة مشرف آخر من الإشراف (إلا إذا كان هو المالك)
    if (group.memberRoles[memberUid] === 'admin' && newRole === 'member' && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر من الإشراف.' });
    }

    if (!group.participants.includes(memberUid)) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    group.memberRoles[memberUid] = newRole;
    console.log(`تم تغيير دور العضو ${memberUid} في المجموعة ${groupId} إلى ${newRole}.`);
    res.status(200).json({ message: 'تم تغيير دور العضو بنجاح.' });
});

// نقطة نهاية لإزالة عضو من المجموعة
app.delete('/api/group/:groupId/members/:memberUid', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // يجب أن يكون المتصل مشرفاً
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة أعضاء من هذه المجموعة.' });
    }

    // لا يمكن إزالة المالك
    if (memberUid === group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }

    // لا يمكن للمشرف العادي إزالة مشرف آخر (إلا إذا كان هو المالك)
    if (group.memberRoles[memberUid] === 'admin' && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر.' });
    }

    const memberIndex = group.participants.indexOf(memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    group.participants.splice(memberIndex, 1);
    delete group.memberRoles[memberUid]; // إزالة الدور أيضاً
    console.log(`تم إزالة العضو ${memberUid} من المجموعة ${groupId}.`);
    res.status(200).json({ message: 'تم إزالة العضو بنجاح.' });
});

// نقطة نهاية لمغادرة المجموعة
app.delete('/api/group/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body; // المستخدم الذي يريد المغادرة

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const memberIndex = group.participants.indexOf(memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
    }

    // إذا كان العضو المغادر هو المالك، يجب عليه تعيين مالك جديد أو حذف المجموعة
    if (memberUid === group.adminId) {
        // في تطبيق حقيقي، ستحتاج إلى واجهة لتغيير المالك قبل المغادرة
        // أو فرض حذف المجموعة إذا كان هو العضو الوحيد المتبقي
        if (group.participants.length > 1) {
             return res.status(403).json({ error: 'لا يمكنك مغادرة المجموعة بصفتك المالك. يرجى تعيين مالك جديد أولاً.' });
        } else {
            // إذا كان المالك هو العضو الوحيد، يمكنه حذف المجموعة
            const groupIndex = chats.findIndex(c => c.id === groupId);
            chats.splice(groupIndex, 1);
            console.log(`تم حذف المجموعة ${groupId} لأن المالك غادر وكان العضو الوحيد.`);
            return res.status(200).json({ message: 'تم حذف المجموعة بنجاح بعد مغادرتك.' });
        }
    }

    group.participants.splice(memberIndex, 1);
    delete group.memberRoles[memberUid];
    console.log(`غادر العضو ${memberUid} المجموعة ${groupId}.`);
    res.status(200).json({ message: 'تمت مغادرة المجموعة بنجاح.' });
});


// بدء تشغيل الخادم
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Backend URL: http://localhost:${port}`); // هذا للاختبار المحلي
    console.log('Storj DCS Keys are directly in code. For production, consider environment variables.');
});
