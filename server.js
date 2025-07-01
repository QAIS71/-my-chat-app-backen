// استيراد المكتبات المطلوبة
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // للتعامل مع سياسات CORS
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000;

// مفاتيح Storj DCS
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

// تهيئة Multer
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
// تمكين CORS لجميع الطلبات (Netlify Proxy سيتعامل مع الباقي)
app.use(cors()); // **تم تبسيط هذا السطر ليعود إلى app.use(cors());**

app.use(bodyParser.json());

// قاعدة بيانات مؤقتة في الذاكرة
let users = [];
let posts = [];
let chats = [];

// وظائف المساعدة
function generateCustomId() {
    let id;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000).toString();
    } while (users.some(user => user.customId === id));
    return id;
}

// نقاط نهاية API (بدون تغيير في المنطق هنا)
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    if (users.some(user => user.username === username)) {
        return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
    }
    const uid = uuidv4();
    const customId = generateCustomId();
    const newUser = { uid, username, password, customId, profileBg: null };
    users.push(newUser);
    console.log('User registered:', newUser.username, 'UID:', newUser.uid, 'Custom ID:', newUser.customId);
    res.status(201).json({ message: 'تم التسجيل بنجاح.', user: { uid, username, customId, profileBg: null } });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    console.log('User logged in:', user.username);
    res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg } });
});

app.get('/api/user/by-custom-id/:customId', (req, res) => {
    const { customId } = req.params;
    const user = users.find(u => u.customId === customId);
    if (user) {
        res.status(200).json({ uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg });
    } else {
        res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
});

app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const uploadedFile = req.file;
    if (!userId || !uploadedFile) {
        return res.status(400).json({ error: 'معرف المستخدم والملف مطلوبان.' });
    }
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    const fileExtension = path.extname(uploadedFile.originalname);
    const fileName = `${uuidv4()}${fileExtension}`;
    const filePath = `profile_bg/${fileName}`;
    const params = {
        Bucket: bucketName,
        Key: filePath,
        Body: uploadedFile.buffer,
        ContentType: uploadedFile.mimetype,
    };
    try {
        await s3Client.send(new PutObjectCommand(params));
        const mediaUrl = `/api/media/${userId}/${filePath}`;
        user.profileBg = mediaUrl;
        console.log(`تم تحميل خلفية الملف الشخصي للمستخدم ${userId}: ${mediaUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: mediaUrl });
    } catch (error) {
        console.error('ERROR: Failed to upload profile background to Storj DCS:', error);
        res.status(500).json({ error: 'فشل تحميل الخلفية.' });
    }
});

app.get('/api/user/:userId/followers/count', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    let followerCount = 0;
    users.forEach(u => {
        if (u.following && u.following.includes(userId)) {
            followerCount++;
        }
    });
    res.status(200).json({ count: followerCount });
});

app.get('/api/user/:followerId/following/:followedId', (req, res) => {
    const { followerId, followedId } = req.params;
    const followerUser = users.find(u => u.uid === followerId);
    if (!followerUser) {
        return res.status(404).json({ error: 'المستخدم المتابع غير موجود.' });
    }
    const isFollowing = followerUser.following && followerUser.following.includes(followedId);
    res.status(200).json({ isFollowing });
});

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
        followerUser.following = followerUser.following.filter(id => id !== followedId);
        message = 'تم إلغاء المتابعة.';
        res.status(200).json({ message, isFollowing: false });
    } else {
        followerUser.following.push(followedId);
        message = 'تمت المتابعة بنجاح.';
        res.status(200).json({ message, isFollowing: true });
    }
    console.log(`User ${followerUser.username} ${message} user ${followedUser.username}`);
});

app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const userContacts = [];
    chats.forEach(chat => {
        if (chat.type === 'private' && chat.participants.includes(userId)) {
            const otherParticipantId = chat.participants.find(pId => pId !== userId);
            const otherUser = users.find(u => u.uid === otherParticipantId);
            if (otherUser) {
                userContacts.push({
                    uid: otherUser.uid,
                    username: otherUser.username,
                    customId: otherUser.customId,
                    profileBg: otherUser.profileBg
                });
            }
        }
    });
    const uniqueContacts = Array.from(new Map(userContacts.map(contact => [contact.uid, contact])).values());
    res.status(200).json(uniqueContacts);
});

app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;

    let postMediaUrl = null;
    let postMediaType = mediaType || 'text';

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

        try {
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
        } catch (error) {
            console.error('ERROR: فشل تحميل الوسائط إلى Storj DCS أثناء إنشاء المنشور:', error);
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
        mediaUrl: postMediaUrl,
        mediaType: postMediaType,
        authorProfileBg: authorProfileBg || null
    };
    posts.push(newPost);
    console.log('تم نشر منشور جديد:', newPost);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
});

app.get('/api/posts', (req, res) => {
    const postsCopy = posts.map(p => ({
        ...p,
        likes: JSON.stringify(p.likes),
        comments: JSON.stringify(p.comments),
        views: JSON.stringify(p.views)
    }));
    res.status(200).json(postsCopy);
});

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

app.get('/api/posts/search', (req, res) => {
    const { q, filter, userId } = req.query;
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

app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const postIndex = posts.findIndex(p => p.id === postId);
    if (postIndex === -1) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const deletedPost = posts[postIndex];
    if (deletedPost.mediaUrl) {
        const urlParts = deletedPost.mediaUrl.split('/');
        const userIdPart = urlParts[3];
        const filePathInBucket = urlParts.slice(4).join('/');
        const params = { Bucket: bucketName, Key: filePathInBucket };
        s3Client.send(new DeleteObjectCommand(params))
            .then(() => console.log(`تم حذف الملف من Storj DCS: ${filePathInBucket}`))
            .catch(error => console.error('ERROR: Failed to delete media from Storj DCS:', error));
    }
    posts.splice(postIndex, 1);
    console.log('تم حذف المنشور:', postId);
    res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
});

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
        post.likes.push(userId);
        isLiked = true;
    } else {
        post.likes.splice(userIndex, 1);
        isLiked = false;
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', likesCount: post.likes.length, isLiked });
});

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
    if (!post.views.includes(userId)) {
        post.views.push(userId);
    }
    res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح.', viewsCount: post.views.length });
});

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
    const user = users.find(u => u.uid === userId);
    const newComment = {
        id: uuidv4(),
        userId,
        username,
        text,
        timestamp: Date.now(),
        likes: [],
        userProfileBg: user ? user.profileBg : null
    };
    post.comments.push(newComment);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', comment: newComment });
});

app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    res.status(200).json(JSON.stringify(post.comments || []));
});

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
        comment.likes.push(userId);
        isLiked = true;
    } else {
        comment.likes.splice(userIndex, 1);
        isLiked = false;
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب بالتعليق بنجاح.', likesCount: comment.likes.length, isLiked });
});

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

app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }
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
        participantInfo: {
            [user1Id]: { name: user1Name, customId: user1CustomId },
            [user2Id]: { name: user2Name, customId: user2CustomId }
        },
        contactNames: {
            [user1Id]: contactName,
            [user2Id]: user1Name
        }
    };
    chats.push(newChat);
    console.log('تم إنشاء محادثة فردية جديدة:', newChatId);
    res.status(201).json({ message: 'تم إنشاء المحادثة.', chatId: newChatId });
});

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

app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;
    const userChats = [];
    chats.forEach(chat => {
        if (chat.participants.includes(userId)) {
            let chatName = '';
            let chatCustomId = '';
            let chatProfileBg = null;
            let chatAdminId = null;
            if (chat.type === 'private') {
                chatName = chat.contactNames[userId];
                const otherParticipantId = chat.participants.find(pId => pId !== userId);
                const otherUser = users.find(u => u.uid === otherParticipantId);
                if (otherUser) {
                    chatCustomId = otherUser.customId;
                    chatProfileBg = otherUser.profileBg;
                }
            } else if (chat.type === 'group') {
                chatName = chat.name;
                chatCustomId = null;
                chatProfileBg = chat.profileBg || null;
                chatAdminId = chat.adminId;
            }
            userChats.push({
                id: chat.id,
                type: chat.type,
                name: chatName,
                lastMessage: chat.lastMessage,
                timestamp: chat.timestamp,
                customId: chatCustomId,
                profileBg: chatProfileBg,
                adminId: chatAdminId
            });
        }
    });
    userChats.sort((a, b) => b.timestamp - a.timestamp);
    res.status(200).json(userChats);
});

app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;

    let messageMediaUrl = null;
    let messageMediaType = mediaType || 'text';

    const chat = chats.find(c => c.id === chatId);
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

        try {
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
        } catch (error) {
            console.error('ERROR: فشل تحميل الوسائط إلى Storj DCS أثناء إنشاء الرسالة:', error);
        }
    }

    const newMessage = {
        id: uuidv4(),
        senderId,
        senderName,
        text: text || '',
        timestamp: Date.now(),
        mediaUrl: messageMediaUrl,
        mediaType: messageMediaType,
        senderProfileBg: senderProfileBg || null
    };

    chat.messages.push(newMessage);
    chat.lastMessage = messageMediaUrl ? (messageMediaType === 'image' ? 'صورة' : 'فيديو') : text;
    chat.timestamp = newMessage.timestamp;

    console.log('تم إرسال رسالة جديدة في المحادثة:', chatId, newMessage);
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageData: newMessage });
});

app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = parseInt(req.query.since || '0');
    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }
    const filteredMessages = chat.messages.filter(msg => msg.timestamp > sinceTimestamp);
    res.status(200).json(filteredMessages);
});

app.delete('/api/chats/:chatId/delete-for-user', (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;
    const chatIndex = chats.findIndex(c => c.id === chatId && c.participants.includes(userId));
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو المستخدم ليس عضواً فيها.' });
    }
    chats.splice(chatIndex, 1);
    console.log(`تم حذف المحادثة ${chatId} للمستخدم ${userId} فقط.`);
    res.status(200).json({ message: 'تم حذف المحادثة من عندك بنجاح.' });
});

app.delete('/api/chats/private/:chatId/delete-for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;
    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private' && c.participants.includes(callerUid));
    if (chatIndex === -1) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية الحذف.' });
    }
    const chatToDelete = chats[chatIndex];
    chatToDelete.messages.forEach(message => {
        if (message.mediaUrl) {
            const urlParts = message.mediaUrl.split('/');
            const filePathInBucket = urlParts.slice(4).join('/');
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

app.post('/api/groups', (req, res) => {
    const { name, description, adminId, members } = req.body;
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
        adminId,
        participants: Object.keys(members),
        memberRoles: members,
        messages: [],
        lastMessage: null,
        timestamp: Date.now(),
        profileBg: null
    };
    chats.push(newGroup);
    console.log('تم إنشاء مجموعة جديدة:', newGroup);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroupId });
});

app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير اسم المجموعة.' });
    }
    group.name = newName;
    console.log(`تم تغيير اسم المجموعة ${groupId} إلى ${newName}`);
    res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
});

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
                role: group.memberRoles[pId] || 'member'
            };
        }
        return null;
    }).filter(Boolean);
    res.status(200).json(membersInfo);
});

app.get('/api/group/:groupId/members/count', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.status(200).json({ count: group.participants.length });
});

app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية إضافة أعضاء إلى هذه المجموعة.' });
    }
    const addedMembers = [];
    newMemberUids.forEach(uid => {
        if (!group.participants.includes(uid)) {
            const user = users.find(u => u.uid === uid);
            if (user) {
                group.participants.push(uid);
                group.memberRoles[uid] = 'member';
                addedMembers.push(user.username);
            }
        }
    });
    if (addedMembers.length > 0) {
        res.status(200).json({ message: `تم إضافة ${addedMembers.length} أعضاء بنجاح: ${addedMembers.join(', ')}` });
    } else {
        res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
    }
});

app.put('/api/group/:groupId/members/:memberUid/role', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير أدوار الأعضاء.' });
    }
    if (memberUid === group.adminId && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية تغيير دور مالك المجموعة.' });
    }
    if (group.memberRoles[memberUid] === 'admin' && newRole === 'member' && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر من الإشراف.' });
    }
    if (!group.participants.includes(memberUid)) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }
    group.memberRoles[memberUid] = newRole;
    res.status(200).json({ message: 'تم تغيير دور العضو بنجاح.' });
});

app.delete('/api/group/:groupId/members/:memberUid', (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    if (!group.memberRoles[callerUid] || group.memberRoles[callerUid] !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة أعضاء من هذه المجموعة.' });
    }
    if (memberUid === group.adminId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
    }
    if (group.memberRoles[memberUid] === 'admin' && callerUid !== group.adminId) {
        return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر.' });
    }
    const memberIndex = group.participants.indexOf(memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }
    group.participants.splice(memberIndex, 1);
    delete group.memberRoles[memberUid];
    res.status(200).json({ message: 'تم إزالة العضو بنجاح.' });
});

app.delete('/api/group/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;
    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    const memberIndex = group.participants.indexOf(memberUid);
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
    }
    if (memberUid === group.adminId) {
        if (group.participants.length > 1) {
             return res.status(403).json({ error: 'لا يمكنك مغادرة المجموعة بصفتك المالك. يرجى تعيين مالك جديد أولاً.' });
        } else {
            const groupIndex = chats.findIndex(c => c.id === groupId);
            chats.splice(groupIndex, 1);
            return res.status(200).json({ message: 'تم حذف المجموعة بنجاح بعد مغادرتك.' });
        }
    }
    group.participants.splice(memberIndex, 1);
    delete group.memberRoles[memberUid];
    res.status(200).json({ message: 'تمت مغادرة المجموعة بنجاح.' });
});


// بدء تشغيل الخادم
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Backend URL: http://localhost:${port}`);
    console.log('Storj DCS Keys are directly in code. For production, consider environment variables.');
});
