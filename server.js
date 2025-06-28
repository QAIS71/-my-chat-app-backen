// استيراد المكتبات الضرورية
const express = require('express'); // إطار عمل الويب لـ Node.js
const cors = require('cors'); // لتمكين طلبات Cross-Origin Resource Sharing
const bodyParser = require('body-parser'); // لتحليل نصوص طلبات HTTP
const multer = require('multer'); // للتعامل مع رفع الملفات
const path = require('path'); // للتعامل مع مسارات الملفات
const fs = require('fs'); // للتعامل مع نظام الملفات (لقد قمت بإلغاء تعليقه هنا)
const bcrypt = require('bcryptjs'); // لتشفير كلمات المرور
const { v4: uuidv4 } = require('uuid'); // لتوليد معرفات فريدة عالمياً (UUIDs)
const { customAlphabet } = require('nanoid'); // لتوليد معرفات مخصصة قصيرة

// تهيئة تطبيق Express
const app = express();
const PORT = process.env.PORT || 3000; // استخدام المنفذ المحدد بواسطة البيئة أو 3000 افتراضياً

// تهيئة CORS لتمكين الطلبات من أي أصل (للتطوير)
app.use(cors());

// تحليل طلبات JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// إنشاء مجلد 'uploads' إذا لم يكن موجوداً
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// توفير الملفات الثابتة من مجلد 'uploads' (الصور والفيديوهات المرفوعة)
app.use('/uploads', express.static(uploadsDir));

// --- إعداد تخزين Multer ---
// هذا يستخدم التخزين على القرص المحلي. لـ Render، يجب استبداله بتخزين سحابي.
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // مجلد الوجهة لرفع الملفات
    },
    filename: (req, file, cb) => {
        // إنشاء اسم ملف فريد للحفاظ على الملفات الأصلية
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// --- قاعدة بيانات في الذاكرة (لأغراض العرض والتطوير) ---
// في بيئة الإنتاج، ستحتاج إلى قاعدة بيانات حقيقية مثل MongoDB, PostgreSQL, إلخ.
let users = []; // { uid, username, passwordHash, customId, profileBgUrl, followers:[], following:[] }
let posts = []; // { id, authorId, authorName, text, mediaType, mediaUrl, timestamp, likes:[], comments:[], views:[], authorProfileBg, followerCount }
let chats = []; // { id, type: 'private' | 'group', participants: [{ uid, name, customId, role (for groups), profileBgUrl }], messages: [], name (for group), description (for group) }
// For private chats, participants will be [{ uid, name, customId }, { uid, name, customId }]
// For groups, participants will be [{ uid, name, customId, role }, ...]
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
        const passwordHash = await bcrypt.hash(password, 10); // تشفير كلمة المرور
        const customId = generateCustomId(); // توليد معرف مخصص
        const newUser = {
            uid: uuidv4(), // توليد UID فريد
            username,
            passwordHash,
            customId,
            profileBgUrl: null, // لا توجد خلفية ملف شخصي افتراضياً
            followers: [], // قائمة بمعرفات المتابعين
            following: []  // قائمة بمعرفات الذين يتابعهم المستخدم
        };
        users.push(newUser);
        console.log(`User registered: ${username}, Custom ID: ${customId}`);
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح!', user: { uid: newUser.uid, username: newUser.username, customId: newUser.customId } });
    } catch (error) {
        console.error('Registration error:', error);
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
        // إرجاع بيانات المستخدم (باستثناء الهاش)
        res.status(200).json({
            message: 'تم تسجيل الدخول بنجاح!',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.customId,
                profileBg: user.profileBgUrl // يجب أن يعود باسم profileBg للحفاظ على الاتساق مع الواجهة الأمامية
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'فشل في عملية تسجيل الدخول.' });
    }
});

// --- وظائف API للملفات الشخصية وخلفيات المستخدمين ---

// رفع خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'لم يتم توفير ملف.' });
    }
    const { userId } = req.body;
    if (!userId) {
        // قم بحذف الملف المرفوع إذا لم يتم توفير userId
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'معرف المستخدم (userId) مطلوب.' });
    }

    const user = users.find(u => u.uid === userId);
    if (!user) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    // إعداد مسار URL للملف المرفوع
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    user.profileBgUrl = fileUrl; // تحديث رابط خلفية الملف الشخصي للمستخدم
    
    // ملاحظة هامة: في بيئة الإنتاج (مثل Render)، ستحتاج إلى رفع هذا الملف إلى خدمة تخزين سحابية
    // (مثل Cloudinary أو AWS S3) بدلاً من المجلد المحلي، وحفظ الرابط السحابي هنا.
    // مثال (إذا كنت تستخدم Cloudinary):
    // const cloudinary = require('cloudinary').v2;
    // cloudinary.config({ cloud_name: '...', api_key: '...', api_secret: '...' });
    // const result = await cloudinary.uploader.upload(req.file.path);
    // user.profileBgUrl = result.secure_url;
    // fs.unlinkSync(req.file.path); // حذف الملف المحلي بعد رفعه إلى السحابة

    res.status(200).json({ message: 'تم تحديث خلفية الملف الشخصي بنجاح!', url: fileUrl });
});


// جلب خلفية الملف الشخصي للمستخدم (خاصةً إذا لم يتم تحميلها بعد)
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
        profileBg: user.profileBgUrl // يجب أن يعود باسم profileBg للحفاظ على الاتساق مع الواجهة الأمامية
    });
});

// جلب جهات الاتصال لمستخدم معين (المستخدمون الذين أجرى معهم محادثات فردية)
app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const userChats = chats.filter(chat => chat.type === 'private' && chat.participants.some(p => p.uid === userId));

    const contacts = new Map(); // استخدام Map لتجنب التكرارات

    userChats.forEach(chat => {
        const otherParticipant = chat.participants.find(p => p.uid !== userId);
        if (otherParticipant) {
            const user = users.find(u => u.uid === otherParticipant.uid);
            if (user) { // تأكد من وجود المستخدم في قائمة المستخدمين الرئيسية
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
        // إلغاء المتابعة
        follower.following = follower.following.filter(id => id !== followingId);
        following.followers = following.followers.filter(id => id !== followerId);
        res.status(200).json({ message: 'تم إلغاء المتابعة بنجاح.', isFollowing: false });
    } else {
        // متابعة
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

// نشر منشور جديد (مع دعم الوسائط)
app.post('/api/posts', upload.single('mediaFile'), (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;

    if (!authorId || !authorName) {
        // إذا كان هناك ملف، احذفه لأنه لم يتم التحقق من المؤلف
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المؤلف (authorId, authorName) مطلوبة.' });
    }
    if (!text && !req.file) { // لا نص ولا ملف
        return res.status(400).json({ error: 'المنشور لا يمكن أن يكون فارغاً (يجب أن يحتوي على نص أو وسائط).' });
    }
    
    // التحقق من وجود المستخدم
    const author = users.find(u => u.uid === authorId);
    if (!author) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'المؤلف غير موجود.' });
    }

    let mediaUrl = null;
    if (req.file) {
        mediaUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        // ملاحظة: في بيئة الإنتاج، قم برفع الملف إلى خدمة تخزين سحابية واحفظ رابطها هنا.
    }

    const newPost = {
        id: uuidv4(),
        authorId,
        authorName,
        text: text || '', // تأكد من أنه سلسلة نصية حتى لو كانت فارغة
        mediaType: mediaType || 'text', // 'text', 'image', 'video'
        mediaUrl: mediaUrl,
        timestamp: Date.now(),
        likes: [],
        comments: [], // كل تعليق { id, userId, username, text, timestamp, likes:[] }
        views: [], // معرفات المستخدمين الذين شاهدوا المنشور
        authorProfileBg: authorProfileBg || null, // رابط خلفية ملف المؤلف
        followerCount: author.followers.length // عدد متابعي المؤلف عند النشر
    };

    posts.push(newPost);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح!', post: newPost });
});

// جلب جميع المنشورات
app.get('/api/posts', (req, res) => {
    // إرجاع جميع المنشورات
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
    const { q, filter, userId } = req.query; // q: query, filter: 'all' or 'followed'
    const searchTerm = q ? q.toLowerCase() : '';

    let filteredPosts = [];

    if (filter === 'followed' && userId) {
        const user = users.find(u => u.uid === userId);
        if (user) {
            filteredPosts = posts.filter(post => user.following.includes(post.authorId));
        }
    } else {
        filteredPosts = [...posts]; // جميع المنشورات افتراضياً
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
        userProfileBg: user.profileBgUrl // إضافة خلفية ملف المستخدم إلى التعليق
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

    // إذا لم يكن المستخدم قد شاهد هذا المنشور بعد، قم بإضافته وزيادة المشاهدات
    if (!post.views.includes(userId)) {
        post.views.push(userId);
        res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: post.views.length });
    } else {
        res.status(200).json({ message: 'تمت مشاهدة المنشور بالفعل بواسطة هذا المستخدم.', viewsCount: post.views.length });
    }
});

// حذف منشور
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const initialLength = posts.length;
    
    // البحث عن المنشور المراد حذفه لحذف ملفاته المرفوعة أيضاً
    const postToDelete = posts.find(p => p.id === postId);
    if (postToDelete && postToDelete.mediaUrl) {
        // استخراج اسم الملف من URL وحذفه من مجلد 'uploads'
        const filename = path.basename(postToDelete.mediaUrl);
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted media file: ${filePath}`);
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
            let adminId = null; // For groups

            if (chat.type === 'private') {
                const otherParticipant = chat.participants.find(p => p.uid !== userId);
                const contactUser = users.find(u => u.uid === otherParticipant.uid);
                // The name the current user saved for this contact
                const currentUserChatEntry = chat.participants.find(p => p.uid === userId);
                chatName = currentUserChatEntry.contactName || (contactUser ? contactUser.username : 'Unknown User');
                profileBgUrl = contactUser ? contactUser.profileBgUrl : null;
                customId = contactUser ? contactUser.customId : null;
            } else if (chat.type === 'group') {
                chatName = chat.name;
                profileBgUrl = chat.profileBgUrl || null; // Group might have its own background
                adminId = chat.adminId; // The creator of the group
            }

            // Get last message info
            const lastMessage = messages
                .filter(msg => msg.chatId === chat.id)
                .sort((a, b) => b.timestamp - a.timestamp)[0]; // Newest message first

            return {
                id: chat.id,
                type: chat.type,
                name: chatName,
                lastMessage: lastMessage ? lastMessage.text : null,
                timestamp: lastMessage ? lastMessage.timestamp : (chat.createdAt || 0), // Use chat creation time if no messages
                profileBg: profileBgUrl,
                customId: customId,
                adminId: adminId // Include adminId for groups
            };
        });
    
    // Sort chats by last message timestamp (newest first)
    userChats.sort((a, b) => b.timestamp - a.timestamp);

    res.status(200).json(userChats);
});

// إنشاء محادثة فردية جديدة (أو جلب محادثة موجودة)
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    // التحقق مما إذا كانت المحادثة موجودة بالفعل
    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.participants[0].uid === user1Id && chat.participants[1].uid === user2Id) ||
         (chat.participants[0].uid === user2Id && chat.participants[1].uid === user1Id))
    );

    if (existingChat) {
        // تحديث اسم جهة الاتصال للمستخدم الحالي في المحادثة الموجودة
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
            { uid: user1Id, name: user1Name, customId: user1CustomId, profileBgUrl: user1.profileBgUrl, contactName: contactName },
            { uid: user2Id, name: user2Name, customId: user2CustomId, profileBgUrl: user2.profileBgUrl, contactName: user1Name } // اسم جهة الاتصال لـ user2 هو user1Name
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
    const { userId } = req.body; // معرف المستخدم الذي يريد حذف المحادثة

    // البحث عن المحادثة
    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];
    const participantIndex = chat.participants.findIndex(p => p.uid === userId);

    if (participantIndex === -1) {
        return res.status(403).json({ error: 'المستخدم غير مصرح له بحذف هذه المحادثة.' });
    }

    // إزالة المحادثة من قائمة المستخدم (عن طريق إزالة المستخدم من قائمة المشاركين)
    chat.participants.splice(participantIndex, 1);

    // إذا لم يتبق أي مشارك في المحادثة، فاحذف المحادثة نفسها وجميع رسائلها
    if (chat.participants.length === 0) {
        chats.splice(chatIndex, 1);
        messages = messages.filter(msg => msg.chatId !== chatId); // حذف الرسائل المتعلقة بهذه المحادثة
        res.status(200).json({ message: 'تم حذف المحادثة نهائياً.' });
    } else {
        res.status(200).json({ message: 'تم حذف المحادثة من طرفك فقط.' });
    }
});


// حذف محادثة فردية من الطرفين (أو مغادرة مجموعة)
app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body; // معرف المستخدم الذي يقوم بطلب الحذف

    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private');
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة فردية.' });
    }

    const chat = chats[chatIndex];
    // تأكد أن المستخدم الذي يطلب الحذف هو أحد المشاركين
    if (!chat.participants.some(p => p.uid === callerUid)) {
        return res.status(403).json({ error: 'أنت غير مخول بحذف هذه المحادثة.' });
    }

    // حذف المحادثة بالكامل وجميع رسائلها
    chats.splice(chatIndex, 1);
    messages = messages.filter(msg => msg.chatId !== chatId);
    res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
});


// --- وظائف API للرسائل ---

// إرسال رسالة (نص أو وسائط)
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;

    if (!senderId || !senderName) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'بيانات المرسل (senderId, senderName) مطلوبة.' });
    }

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    // تأكد أن المرسل هو مشارك في هذه المحادثة
    if (!chat.participants.some(p => p.uid === senderId)) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'المرسل ليس مشاركاً في هذه المحادثة.' });
    }

    let mediaUrl = null;
    if (req.file) {
        mediaUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        // ملاحظة: في بيئة الإنتاج، قم برفع الملف إلى خدمة تخزين سحابية واحفظ رابطها هنا.
    }

    const newMessage = {
        id: uuidv4(),
        chatId,
        senderId,
        senderName,
        text: text || '', // النص يمكن أن يكون فارغاً إذا كان هناك ملف وسائط
        mediaType: mediaType || 'text',
        mediaUrl: mediaUrl,
        timestamp: Date.now(),
        senderProfileBg: senderProfileBg || null // رابط خلفية ملف المرسل
    };

    messages.push(newMessage);
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح!', message: newMessage });
});

// جلب رسائل محادثة معينة (يمكن تصفيتها حسب الطابع الزمني)
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0; // جلب الرسائل الأحدث من هذا الطابع الزمني

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
                name: user.username, // اسم المستخدم الأصلي
                customId: user.customId,
                role: members[uid], // 'admin' or 'member'
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
        adminId, // المالك الأصلي للمجموعة
        participants, // المشاركون مع أدوارهم
        createdAt: Date.now(),
        profileBgUrl: null // يمكن إضافة خلفية للمجموعة لاحقاً
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
    // إرجاع الأعضاء مع أدوارهم
    res.status(200).json(group.participants.map(p => ({
        uid: p.uid,
        username: p.name, // استخدم 'name' المخزن في المشاركين
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
        // إذا لم يكن العضو موجوداً بالفعل في المجموعة
        if (!group.participants.some(p => p.uid === uid)) {
            const user = users.find(u => u.uid === uid);
            if (user) {
                group.participants.push({
                    uid: user.uid,
                    name: user.username,
                    customId: user.customId,
                    role: 'member', // الأعضاء الجدد ينضمون كأعضاء عاديين افتراضياً
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
    const { newRole, callerUid } = req.body; // callerUid هو من يقوم بالتغيير

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const caller = group.participants.find(p => p.uid === callerUid);
    const targetMember = group.participants.find(p => p.uid === memberUid);

    if (!caller || !targetMember) {
        return res.status(404).json({ error: 'المستخدم الذي يقوم بالعملية أو العضو المستهدف غير موجود في هذه المجموعة.' });
    }

    // يجب أن يكون من يقوم بالتغيير مشرفاً
    if (caller.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح لك بتغيير أدوار الأعضاء.' });
    }

    // المالك (adminId) لا يمكن إزالة إشرافه إلا بواسطة نفسه (إذا كان المالك يقوم بعملية Demote)
    if (targetMember.uid === group.adminId && newRole === 'member' && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة إشراف مالك المجموعة.' });
    }

    // لا يمكن للمشرف العادي (ليس المالك) إزالة إشراف مشرف آخر
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

    // يجب أن يكون من يقوم بالإزالة مشرفاً
    if (caller.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح لك بإزالة الأعضاء.' });
    }

    const targetMember = group.participants[targetMemberIndex];

    // لا يمكن إزالة مالك المجموعة (adminId)
    if (targetMember.uid === group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }

    // المشرف العادي (ليس المالك) لا يمكنه إزالة مشرف آخر
    if (targetMember.role === 'admin' && caller.uid !== group.adminId) {
        return res.status(403).json({ error: 'المشرف العادي لا يمكنه إزالة مشرف آخر.' });
    }

    group.participants.splice(targetMemberIndex, 1);
    res.status(200).json({ message: `تم إزالة ${targetMember.name} من المجموعة بنجاح.` });
});

// مغادرة المجموعة
app.delete('/api/group/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body; // معرف المستخدم الذي يغادر

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const memberIndex = group.participants.findIndex(p => p.uid === memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    const leavingMember = group.participants[memberIndex];

    // إذا كان العضو الذي يغادر هو مالك المجموعة (adminId)
    if (leavingMember.uid === group.adminId) {
        // إذا كان هناك أعضاء آخرون، يجب تعيين مالك جديد
        if (group.participants.length > 1) {
            // ابحث عن أول مشرف آخر لجعله المالك الجديد
            const newAdmin = group.participants.find(p => p.uid !== memberUid && p.role === 'admin');
            if (newAdmin) {
                group.adminId = newAdmin.uid; // تعيين مشرف جديد كمالك
            } else {
                // إذا لم يكن هناك مشرفون آخرون، اختر أول عضو متاح كمالك
                const firstAvailableMember = group.participants.find(p => p.uid !== memberUid);
                if (firstAvailableMember) {
                    group.adminId = firstAvailableMember.uid;
                    firstAvailableMember.role = 'admin'; // ترقية العضو الجديد إلى مشرف
                } else {
                    // لا يوجد أعضاء آخرون، المجموعة فارغة
                    chats = chats.filter(chat => chat.id !== groupId); // حذف المجموعة
                    messages = messages.filter(msg => msg.chatId !== groupId); // حذف الرسائل
                    return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
                }
            }
        } else {
            // هو العضو الوحيد، يتم حذف المجموعة
            chats = chats.filter(chat => chat.id !== groupId); // حذف المجموعة
            messages = messages.filter(msg => msg.chatId !== groupId); // حذف الرسائل
            return res.status(200).json({ message: 'غادرت المجموعة وتم حذفها لعدم وجود أعضاء آخرين.' });
        }
    }

    // إزالة العضو المغادر
    group.participants.splice(memberIndex, 1);

    // إذا لم يتبق أي مشارك في المجموعة، احذف المجموعة نفسها وجميع رسائلها
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
        const user3 = { uid: uuidv4(), username: 'فاطمة', passwordHash: passwordHash3, customId: '11223344', profileBgUrl: null, followers: [], following: [] };
        
        users.push(user1, user2, user3);
        console.log('Added initial users.');

        // جعل محمد يتابع أحمد وفاطمة
        user1.following.push(user2.uid, user3.uid);
        user2.followers.push(user1.uid);
        user3.followers.push(user1.uid);

        // جعل أحمد يتابع محمد
        user2.following.push(user1.uid);
        user1.followers.push(user2.uid);

        // إضافة منشورات افتراضية
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
            followerCount: user1.followers.length
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
            followerCount: user2.followers.length
        };

        const post3 = {
            id: uuidv4(),
            authorId: user1.uid,
            authorName: user1.username,
            text: 'صورة من رحلتي الأخيرة! 🏞️',
            mediaType: 'image',
            mediaUrl: `${req.protocol}://${req.get('host')}/uploads/placeholder-image.jpg`, // استخدم صورة مؤقتة هنا
            timestamp: Date.now() - 30000,
            likes: [user2.uid, user3.uid],
            comments: [],
            views: [],
            authorProfileBg: user1.profileBgUrl,
            followerCount: user1.followers.length
        };
        // إضافة صورة مؤقتة في مجلد uploads لتجربة المنشورات
        // يمكنك استبدالها بصور حقيقية
        const placeholderImagePath = path.join(uploadsDir, 'placeholder-image.jpg');
        if (!fs.existsSync(placeholderImagePath)) {
            // قم بإنشاء ملف صورة فارغ أو انسخ صورة موجودة
            fs.writeFileSync(placeholderImagePath, ''); // ملف فارغ، يمكنك استبداله ببيانات صورة حقيقية
            console.log('Created placeholder-image.jpg in uploads.');
        }


        posts.push(post1, post2, post3);
        console.log('Added initial posts.');

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
            adminId: user1.uid, // محمد هو المالك
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
        console.log('Added initial chats and messages.');
    }
};

// تشغيل دالة إعداد البيانات الأولية
setupInitialData();
