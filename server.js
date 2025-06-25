// server.js (Backend)

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); // For handling file uploads (multipart/form-data)
const { createClient } = require('@supabase/supabase-js'); // Import Supabase client

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Configuration (تأكد من تحديث هذه القيم ببيانات مشروعك الحقيقية من Supabase)
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL'; // مثال: https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'; // مثال: eyJhbGciOiJIUzI1Ni...

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Helper for generating unique IDs ---
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// --- CORS and Body Parser Middleware ---
app.use(cors()); // Allow all cross-origin requests
app.use(bodyParser.json()); // For parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// Multer for file uploads (memoryStorage is used, actual storage needs cloud integration with Supabase Storage)
const storage = multer.memoryStorage(); // Store files in memory temporarily
const upload = multer({ storage: storage });

// --- API Endpoints ---

// 1. User Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        console.log('Register attempt: Missing username or password.');
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        // Check if username already exists
        const { data: existingUsers, error: checkError } = await supabase
            .from('users')
            .select('username')
            .eq('username', username);

        if (checkError) {
            console.error('Supabase check username error:', checkError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء التحقق من اسم المستخدم.' });
        }

        if (existingUsers && existingUsers.length > 0) {
            console.log(`Register attempt: Username '${username}' already exists.`);
            return res.status(409).json({ error: 'اسم المستخدم هذا موجود بالفعل.' });
        }

        // Generate a unique 8-digit custom ID
        let customId;
        let idExists = true;
        while (idExists) {
            customId = Math.floor(10000000 + Math.random() * 90000000).toString();
            const { data: existingCustomId, error: customIdCheckError } = await supabase
                .from('users')
                .select('customId')
                .eq('customId', customId);
            if (customIdCheckError) {
                console.error('Supabase check customId error:', customIdCheckError);
                return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء توليد المعرف المخصص.' });
            }
            if (!existingCustomId || existingCustomId.length === 0) {
                idExists = false;
            }
        }

        const newUser = {
            id: generateUniqueId(), // Using 'id' as primary key for Supabase
            username,
            password, // In a real app, hash this password!
            customId,
            profileBg: null, // Default profile background URL
            followers: [], // UIDs of users who follow this user
            following: []  // UIDs of users this user follows
        };

        const { data, error } = await supabase
            .from('users')
            .insert([newUser]);

        if (error) {
            console.error('Supabase insert user error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تسجيل المستخدم.' });
        }

        console.log('Registered new user:', newUser.username, 'ID:', newUser.id, 'Custom ID:', newUser.customId);
        res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح.', user: { uid: newUser.id, username: newUser.username, customId: newUser.customId } });
    } catch (dbError) {
        console.error('Unexpected error during registration:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء التسجيل.' });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, customId, profileBg, followers') // Fetch followers array
            .eq('username', username)
            .eq('password', password) // In a real app, compare hashed password!
            .single(); // Use single() if you expect only one result

        if (error && error.code !== 'PGRST116') { // PGRST116 is no rows found
            console.error('Supabase login select error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تسجيل الدخول.' });
        }

        if (!data) {
            console.log('Login attempt failed: Invalid username or password for', username);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        // Return user data, including follower count (derived from array length)
        const user = {
            uid: data.id,
            username: data.username,
            customId: data.customId,
            profileBg: data.profileBg,
            followers: data.followers // Pass the array, frontend can count
        };

        console.log('User logged in:', user.username, 'UID:', user.uid);
        res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user });
    } catch (dbError) {
        console.error('Unexpected error during login:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول.' });
    }
});

// 3. Get User by Custom ID (Crucial for private chat initiation)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, customId, profileBg')
            .eq('customId', customId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase get user by customId error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }

        if (!user) {
            console.log(`Get User by Custom ID: User with Custom ID '${customId}' not found.`);
            return res.status(404).json({ error: 'لم يتم العثور على مستخدم بهذا المعرف.' });
        }
        console.log(`Found user for custom ID '${customId}': ${user.username}, ID: ${user.id}`);
        res.status(200).json({ uid: user.id, username: user.username, customId: user.customId, profileBg: user.profileBg });
    } catch (dbError) {
        console.error('Unexpected error getting user by custom ID:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// 4. Upload Profile Background
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;

    try {
        // In a real app, you would upload req.file.buffer to Supabase Storage here.
        // For now, we'll continue with the placeholder as per previous discussions.
        let imageUrl = `https://placehold.co/100x100/eeeeee/000?text=Profile`; // Default placeholder

        if (req.file) {
            console.log(`File received for user ${userId}: ${req.file.originalname}. (Simulating upload to Supabase Storage)`);
            // Here you'd integrate with Supabase Storage
            // Example: const { data, error: uploadError } = await supabase.storage.from('avatars').upload(`${userId}.png`, req.file.buffer);
            // if (uploadError) throw uploadError;
            // imageUrl = data.publicURL; // Or how Supabase Storage returns the URL
            imageUrl = `https://placehold.co/100x100/${Math.floor(Math.random()*16777215).toString(16)}/ffffff?text=${userId.charAt(0).toUpperCase()}`; // More dynamic placeholder
        } else {
            console.log(`No file received for user ${userId}, setting default placeholder.`);
        }

        const { data, error } = await supabase
            .from('users')
            .update({ profileBg: imageUrl })
            .eq('id', userId);

        if (error) {
            console.error('Supabase update profileBg error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تحديث الخلفية.' });
        }

        console.log(`User ${userId} profile background updated to: ${imageUrl}`);
        res.status(200).json({ message: 'تم تعيين الخلفية بنجاح (باستخدام صورة بديلة).', url: imageUrl });
    } catch (dbError) {
        console.error('Unexpected error during profile background upload:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء رفع الخلفية.' });
    }
});

// 5. Get User's Profile Background (if needed separately)
app.get('/api/user/:userId/profile-background', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('profileBg')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase get profileBg error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ url: user.profileBg || null });
    } catch (dbError) {
        console.error('Unexpected error getting user profile background:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// 6. Get User's Follower Count
app.get('/api/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('followers')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase get follower count error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
        res.status(200).json({ count: user.followers ? user.followers.length : 0 });
    } catch (dbError) {
        console.error('Unexpected error getting follower count:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// 7. Toggle Follow/Unfollow
app.post('/api/user/:followerId/follow/:targetId', async (req, res) => {
    const { followerId, targetId } = req.params;

    try {
        const { data: followerData, error: followerError } = await supabase
            .from('users')
            .select('following')
            .eq('id', followerId)
            .single();

        const { data: targetUserData, error: targetUserError } = await supabase
            .from('users')
            .select('followers')
            .eq('id', targetId)
            .single();

        if (followerError || !followerData || targetUserError || !targetUserData) {
            console.error('Supabase fetch follow users error:', followerError, targetUserError);
            return res.status(404).json({ error: 'المستخدم (المتابع أو المستهدف) غير موجود.' });
        }
        if (followerId === targetId) {
            return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
        }

        let followerFollowing = followerData.following || [];
        let targetUserFollowers = targetUserData.followers || [];
        const isFollowing = followerFollowing.includes(targetId);
        let message;

        if (isFollowing) {
            // Unfollow
            followerFollowing = followerFollowing.filter(id => id !== targetId);
            targetUserFollowers = targetUserFollowers.filter(id => id !== followerId);
            message = 'تم إلغاء المتابعة.';
        } else {
            // Follow
            followerFollowing.push(targetId);
            targetUserFollowers.push(followerId);
            message = 'تمت المتابعة بنجاح.';
        }

        // Update follower's following list
        const { error: updateFollowerError } = await supabase
            .from('users')
            .update({ following: followerFollowing })
            .eq('id', followerId);
        if (updateFollowerError) {
            console.error('Supabase update follower following error:', updateFollowerError);
            throw new Error('فشل تحديث قائمة المتابعة.');
        }

        // Update target user's followers list
        const { error: updateTargetError } = await supabase
            .from('users')
            .update({ followers: targetUserFollowers })
            .eq('id', targetId);
        if (updateTargetError) {
            console.error('Supabase update target followers error:', updateTargetError);
            throw new Error('فشل تحديث قائمة المتابعين.');
        }

        console.log(`User ${followerId} toggled follow status for ${targetId}. IsFollowing: ${!isFollowing}`);
        res.status(200).json({ message, isFollowing: !isFollowing });
    } catch (dbError) {
        console.error('Unexpected error during toggle follow:', dbError);
        res.status(500).json({ error: dbError.message || 'حدث خطأ غير متوقع.' });
    }
});

// 8. Check Follow Status
app.get('/api/user/:followerId/following/:targetId', async (req, res) => {
    const { followerId, targetId } = req.params;
    try {
        const { data: follower, error } = await supabase
            .from('users')
            .select('following')
            .eq('id', followerId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase check follow status error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!follower) {
            return res.status(404).json({ error: 'المستخدم المتابع غير موجود.' });
        }
        const isFollowing = follower.following ? follower.following.includes(targetId) : false;
        res.status(200).json({ isFollowing });
    } catch (dbError) {
        console.error('Unexpected error checking follow status:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// 9. Get User's Contacts (for group creation and other features)
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data: allOtherUsers, error } = await supabase
            .from('users')
            .select('id, username, customId')
            .neq('id', userId); // Select all users except the current one

        if (error) {
            console.error('Supabase get contacts error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب جهات الاتصال.' });
        }

        const formattedUsers = allOtherUsers.map(u => ({ uid: u.id, username: u.username, customId: u.customId }));
        console.log(`Returning ${formattedUsers.length} contacts for user ${userId}.`);
        res.status(200).json(formattedUsers);
    } catch (dbError) {
        console.error('Unexpected error getting contacts:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// 10. Create Private Chat
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        console.log('Create private chat attempt: Missing required fields.', req.body);
        return res.status(400).json({ error: 'جميع حقول المستخدمين واسم جهة الاتصال مطلوبة لإنشاء محادثة خاصة.' });
    }

    try {
        // Ensure users exist and get their profileBg
        const { data: actualUser1, error: user1Error } = await supabase.from('users').select('id, username, customId, profileBg').eq('id', user1Id).single();
        const { data: actualUser2, error: user2Error } = await supabase.from('users').select('id, username, customId, profileBg').eq('id', user2Id).single();

        if (user1Error || !actualUser1 || user2Error || !actualUser2) {
            console.error('Supabase fetch actual users for private chat error:', user1Error, user2Error);
            return res.status(404).json({ error: 'أحد المستخدمين أو كلاهما غير موجود.' });
        }
        if (user1Id === user2Id) {
            console.log('Create private chat attempt: Cannot chat with self for private chat.');
            return res.status(400).json({ error: 'لا يمكنك بدء محادثة فردية مع نفسك.' });
        }

        // Check if a private chat already exists between these two users
        // Supabase `cs` (contains string) operator can be used for array containment check,
        // but 'contains' with JSONB array on exact match is better.
        const { data: existingChats, error: existingChatError } = await supabase
            .from('chats')
            .select('id')
            .eq('type', 'private')
            .contains('members', [user1Id])
            .contains('members', [user2Id]);

        if (existingChatError) {
            console.error('Supabase check existing chat error:', existingChatError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء التحقق من المحادثات الموجودة.' });
        }

        if (existingChats && existingChats.length > 0) {
            console.log(`Existing private chat found between ${user1Name} and ${user2Name}. Chat ID: ${existingChats[0].id}`);
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChats[0].id });
        }

        const newChat = {
            id: generateUniqueId(),
            type: 'private',
            members: [user1Id, user2Id],
            memberInfo: {
                [user1Id]: { username: user1Name, customId: user1CustomId, contactName: contactName, profileBg: actualUser1.profileBg },
                [user2Id]: { username: user2Name, customId: user2CustomId, contactName: user1Name, profileBg: actualUser2.profileBg }
            },
            createdAt: Date.now(),
            lastMessage: null,
            timestamp: Date.now(),
            name: null, // Private chats don't have a group name
            description: null,
            adminId: null,
            memberRoles: null,
            profileBg: null
        };

        const { data, error } = await supabase
            .from('chats')
            .insert([newChat]);

        if (error) {
            console.error('Supabase insert chat error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء إنشاء المحادثة.' });
        }

        console.log('Created new private chat:', newChat.id, 'between', user1Name, 'and', user2Name);
        res.status(201).json({ message: 'تم إنشاء المحادثة الخاصة بنجاح.', chatId: newChat.id });
    } catch (dbError) {
        console.error('Unexpected error during private chat creation:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إنشاء المحادثة.' });
    }
});

// 11. Create Group Chat
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body; // members is an object: {uid: role}

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        console.log('Create group attempt: Missing required fields or less than 2 members.', req.body);
        return res.status(400).json({ error: 'اسم المجموعة، المشرف، وعضوين على الأقل مطلوبون لإنشاء المجموعة.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
         console.log('Create group attempt: Admin not specified or not an admin role.', adminId, members);
         return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً في المجموعة.' });
    }

    try {
        const newGroup = {
            id: generateUniqueId(),
            type: 'group',
            name,
            description,
            adminId,
            members: Object.keys(members), // Array of UIDs
            memberRoles: members, // { uid: 'admin' | 'member' }
            createdAt: Date.now(),
            lastMessage: null,
            timestamp: Date.now(),
            profileBg: null, // Group profile background (can be updated later)
            memberInfo: null // Not used for groups in the same way as private chats
        };

        const { data, error } = await supabase
            .from('chats')
            .insert([newGroup]);

        if (error) {
            console.error('Supabase insert group error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء إنشاء المجموعة.' });
        }

        console.log('Created new group:', newGroup.id, 'Name:', newGroup.name);
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroup.id });
    } catch (dbError) {
        console.error('Unexpected error during group creation:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إنشاء المجموعة.' });
    }
});

// 12. Get User's Chat List
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data: userChats, error } = await supabase
            .from('chats')
            .select('*') // Select all columns
            .contains('members', [userId]); // Chats where the members array contains userId

        if (error) {
            console.error('Supabase get user chats error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب قائمة المحادثات.' });
        }

        const formattedChats = await Promise.all(userChats.map(async chat => {
            let chatNameForDisplay;
            let chatCustomIdForDisplay = null;
            let chatProfileBgForDisplay = null;
            let lastMessageText = chat.lastMessage || 'لا توجد رسائل بعد.';

            if (chat.type === 'private') {
                const otherUserId = chat.members.find(memberId => memberId !== userId);
                // Fetch other user's data to get their username and profileBg
                const { data: otherUser, error: otherUserError } = await supabase
                    .from('users')
                    .select('username, customId, profileBg')
                    .eq('id', otherUserId)
                    .single();
                
                if (otherUserError && otherUserError.code !== 'PGRST116') {
                    console.error('Supabase get other user for chat list error:', otherUserError);
                }

                chatNameForDisplay = chat.memberInfo && chat.memberInfo[userId] && chat.memberInfo[userId].contactName ? chat.memberInfo[userId].contactName : (otherUser ? otherUser.username : 'مستخدم غير معروف');
                chatCustomIdForDisplay = otherUser ? otherUser.customId : null;
                chatProfileBgForDisplay = otherUser ? otherUser.profileBg : null;

            } else { // Group chat
                chatNameForDisplay = chat.name;
                chatProfileBgForDisplay = chat.profileBg;
            }

            return {
                id: chat.id,
                type: chat.type,
                name: chatNameForDisplay,
                customId: chatCustomIdForDisplay,
                lastMessage: lastMessageText,
                timestamp: chat.timestamp,
                profileBg: chatProfileBgForDisplay
            };
        }));

        formattedChats.sort((a, b) => b.timestamp - a.timestamp);

        console.log(`Returning ${formattedChats.length} chats for user ${userId}.`);
        res.status(200).json(formattedChats);
    } catch (dbError) {
        console.error('Unexpected error getting user chat list:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء جلب قائمة المحادثات.' });
    }
});

// 13. Get Messages for a Chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0;

    try {
        const { data: chatMessages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chatId', chatId)
            .gt('timestamp', since)
            .order('timestamp', { ascending: true }); // Order messages by timestamp

        if (error) {
            console.error('Supabase get chat messages error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب الرسائل.' });
        }

        console.log(`Returning ${chatMessages.length} messages for chat ${chatId} (since ${since}).`);
        res.status(200).json(chatMessages);
    } catch (dbError) {
        console.error('Unexpected error getting chat messages:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء جلب الرسائل.' });
    }
});

// 14. Send Message to a Chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;

    try {
        const { data: chat, error: chatError } = await supabase
            .from('chats')
            .select('id')
            .eq('id', chatId)
            .single();

        if (chatError && chatError.code !== 'PGRST116') {
            console.error('Supabase get chat for message error:', chatError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!chat) {
            console.log('Send message attempt: Chat not found for ID', chatId);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }

        if (!senderId || (!text && !mediaFile)) {
            console.log('Send message attempt: Missing senderId, text or mediaFile. Req body:', req.body);
            return res.status(400).json({ error: 'معرف المرسل أو نص الرسالة أو ملف الوسائط مطلوب.' });
        }

        let mediaUrl = null;
        if (mediaFile) {
            // In a real application, you would upload req.file.buffer to Supabase Storage here.
            // Example: const { data: fileData, error: uploadError } = await supabase.storage.from('chat_media').upload(`chat_${chatId}/${generateUniqueId()}`, req.file.buffer);
            // if (uploadError) throw uploadError;
            // mediaUrl = fileData.publicURL;
            console.log(`Media file received for chat ${chatId}: ${mediaFile.originalname}. (Simulating upload to Supabase Storage)`);
            if (mediaType === 'image') {
                mediaUrl = `https://placehold.co/300x200/cccccc/000?text=Image+Placeholder`;
            } else if (mediaType === 'video') {
                mediaUrl = `https://www.w3schools.com/html/mov_bbb.mp4`; // A generic test video
            }
        }

        const newMessage = {
            id: generateUniqueId(),
            chatId,
            senderId,
            senderName,
            text: text || '', // Store empty string if text is empty
            mediaType: mediaType || null,
            mediaUrl: mediaUrl,
            senderProfileBg: senderProfileBg || null,
            timestamp: Date.now(),
            status: 'sent'
        };

        const { data: messageData, error: messageError } = await supabase
            .from('messages')
            .insert([newMessage]);

        if (messageError) {
            console.error('Supabase insert message error:', messageError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء إرسال الرسالة.' });
        }

        // Update last message in chat metadata
        const { error: chatUpdateError } = await supabase
            .from('chats')
            .update({ lastMessage: text || (mediaType === 'image' ? 'صورة' : 'فيديو'), timestamp: newMessage.timestamp })
            .eq('id', chatId);

        if (chatUpdateError) {
            console.error('Supabase update chat lastMessage/timestamp error:', chatUpdateError);
            // This error might not be critical enough to stop the message from being sent, but should be logged
        }

        console.log(`Message sent to chat ${chatId} by ${senderName}. Stored text: "${newMessage.text}"`);
        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageId: newMessage.id });
    } catch (dbError) {
        console.error('Unexpected error during sending message:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إرسال الرسالة.' });
    }
});

// 15. Delete Chat / Leave Group
app.post('/api/chats/delete', async (req, res) => {
    const { chatId, chatType, action, userId } = req.body;

    try {
        const { data: chat, error: chatError } = await supabase
            .from('chats')
            .select('*')
            .eq('id', chatId)
            .single();

        if (chatError && chatError.code !== 'PGRST116') {
            console.error('Supabase get chat for delete error:', chatError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!chat) {
            console.log('Delete chat attempt: Chat not found for ID', chatId);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }

        if (chatType === 'private') {
            if (action === 'forMe') {
                // For private chat, 'forMe' would mean removing the chat entry only for this specific user.
                // In a multi-user, real-time database, this would typically involve setting a flag or
                // removing the user from the 'members' array for that chat, if the chat is not unique per pair.
                // Given the current 'chats' structure (one chat per pair), 'forMe' is hard to implement without
                // a more complex chat membership model. So, for now, we simulate success and frontend will remove it.
                console.log(`Simulating deletion of private chat ${chatId} for user ${userId} (forMe).`);
                res.status(200).json({ message: 'تم حذف المحادثة من عندك فقط (محاكاة).' });
            } else if (action === 'forBoth') {
                const { error: deleteMessagesError } = await supabase
                    .from('messages')
                    .delete()
                    .eq('chatId', chatId);
                if (deleteMessagesError) console.error('Supabase delete messages error:', deleteMessagesError);

                const { error: deleteChatError } = await supabase
                    .from('chats')
                    .delete()
                    .eq('id', chatId);
                if (deleteChatError) throw deleteChatError;

                console.log(`Deleted private chat ${chatId} and its messages.`);
                res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
            } else {
                console.log('Delete chat attempt: Invalid action for private chat.', action);
                return res.status(400).json({ error: 'إجراء حذف غير صالح للمحادثة الخاصة.' });
            }
        } else if (chatType === 'group') {
            if (action === 'forMe') {
                // Similar to private 'forMe', simulating.
                console.log(`Simulating deletion of group chat ${chatId} for user ${userId} (forMe - leave group).`);
                res.status(200).json({ message: 'تم حذف المجموعة من عندك فقط (محاكاة).' });
            } else if (action === 'leaveGroup') {
                let currentMembers = chat.members || [];
                let currentMemberRoles = chat.memberRoles || {};

                currentMembers = currentMembers.filter(memberId => memberId !== userId);
                delete currentMemberRoles[userId];

                // If group has no members left or no admins, delete it
                const hasAdmins = Object.values(currentMemberRoles).includes('admin');
                if (currentMembers.length === 0 || !hasAdmins) {
                    const { error: deleteMessagesError } = await supabase
                        .from('messages')
                        .delete()
                        .eq('chatId', chatId);
                    if (deleteMessagesError) console.error('Supabase delete messages error:', deleteMessagesError);

                    const { error: deleteChatError } = await supabase
                        .from('chats')
                        .delete()
                        .eq('id', chatId);
                    if (deleteChatError) throw deleteChatError;

                    console.log(`Group ${chatId} deleted due to no members or no admins.`);
                    res.status(200).json({ message: 'لقد غادرت المجموعة وتم حذفها لعدم وجود أعضاء أو مشرفين.' });
                } else {
                    // Update group members and roles in Supabase
                    const { error: updateChatError } = await supabase
                        .from('chats')
                        .update({ members: currentMembers, memberRoles: currentMemberRoles })
                        .eq('id', chatId);
                    if (updateChatError) throw updateChatError;

                    console.log(`User ${userId} left group ${chatId}. Remaining members: ${currentMembers.length}`);
                    res.status(200).json({ message: 'لقد غادرت المجموعة بنجاح.' });
                }
            } else {
                console.log('Delete chat attempt: Invalid action for group chat.', action);
                return res.status(400).json({ error: 'إجراء حذف غير صالح للمحادثة الجماعية.' });
            }
        } else {
            console.log('Delete chat attempt: Invalid chat type.', chatType);
            return res.status(400).json({ error: 'نوع محادثة غير صالح.' });
        }
    } catch (dbError) {
        console.error('Unexpected error during chat deletion/leave:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء عملية الحذف/المغادرة.' });
    }
});


// 16. Get Group Members (and their roles)
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const { data: group, error: groupError } = await supabase
            .from('chats')
            .select('members, memberRoles')
            .eq('id', groupId)
            .eq('type', 'group')
            .single();

        if (groupError && groupError.code !== 'PGRST116') {
            console.error('Supabase get group for members error:', groupError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!group) {
            console.log('Get group members attempt: Group not found for ID', groupId);
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const memberUids = group.members || [];
        const memberRoles = group.memberRoles || {};

        // Fetch full user data for each member UID
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, username, customId')
            .in('id', memberUids);

        if (usersError) {
            console.error('Supabase get users for group members error:', usersError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب بيانات الأعضاء.' });
        }

        const membersInfo = memberUids.map(memberUid => {
            const user = usersData.find(u => u.id === memberUid);
            return {
                uid: memberUid,
                username: user ? user.username : 'مستخدم غير معروف',
                customId: user ? user.customId : null,
                role: memberRoles[memberUid] || 'عضو'
            };
        });
        console.log(`Returning ${membersInfo.length} members for group ${groupId}.`);
        res.status(200).json(membersInfo);
    } catch (dbError) {
        console.error('Unexpected error getting group members:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// 17. Change Group Member Role (Admin only)
app.put('/api/group/:groupId/members/:memberId/role', async (req, res) => {
    const { groupId, memberId } = req.params;
    const { newRole, callerUid } = req.body;

    try {
        const { data: group, error: groupError } = await supabase
            .from('chats')
            .select('memberRoles')
            .eq('id', groupId)
            .eq('type', 'group')
            .single();

        if (groupError && groupError.code !== 'PGRST116') {
            console.error('Supabase get group for role change error:', groupError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!group) {
            console.log('Change role attempt: Group not found for ID', groupId);
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const currentMemberRoles = group.memberRoles || {};
        const callerRole = currentMemberRoles[callerUid];
        if (callerRole !== 'admin') {
            console.log(`Change role attempt: Caller ${callerUid} is not an admin in group ${groupId}.`);
            return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير أدوار الأعضاء.' });
        }

        if (!Object.keys(currentMemberRoles).includes(memberId)) {
            console.log(`Change role attempt: Member ${memberId} not found in group ${groupId}.`);
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        const currentAdmins = Object.keys(currentMemberRoles).filter(uid => currentMemberRoles[uid] === 'admin');
        if (newRole === 'member' && currentAdmins.length === 1 && currentAdmins[0] === memberId) {
            console.log(`Change role attempt: Cannot demote the only admin ${memberId} in group ${groupId}.`);
            return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
        }

        currentMemberRoles[memberId] = newRole;

        const { error: updateError } = await supabase
            .from('chats')
            .update({ memberRoles: currentMemberRoles })
            .eq('id', groupId);

        if (updateError) {
            console.error('Supabase update member role error:', updateError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تحديث الدور.' });
        }

        console.log(`Member ${memberId} role changed to ${newRole} in group ${groupId}.`);
        res.status(200).json({ message: `تم تغيير دور العضو إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });
    } catch (dbError) {
        console.error('Unexpected error changing group member role:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// 18. Remove Group Member (Admin only)
app.delete('/api/group/:groupId/members/:memberId', async (req, res) => {
    const { groupId, memberId } = req.params;
    const { callerUid } = req.body;

    try {
        const { data: group, error: groupError } = await supabase
            .from('chats')
            .select('members, memberRoles')
            .eq('id', groupId)
            .eq('type', 'group')
            .single();

        if (groupError && groupError.code !== 'PGRST116') {
            console.error('Supabase get group for remove member error:', groupError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!group) {
            console.log('Remove member attempt: Group not found for ID', groupId);
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        let currentMembers = group.members || [];
        let currentMemberRoles = group.memberRoles || {};
        const callerRole = currentMemberRoles[callerUid];

        if (callerRole !== 'admin') {
            console.log(`Remove member attempt: Caller ${callerUid} is not an admin in group ${groupId}.`);
            return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة الأعضاء.' });
        }

        if (!currentMembers.includes(memberId)) {
            console.log(`Remove member attempt: Member ${memberId} not found in group ${groupId}.`);
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        const currentAdmins = Object.keys(currentMemberRoles).filter(uid => currentMemberRoles[uid] === 'admin');
        if (currentAdmins.length === 1 && currentAdmins[0] === memberId) {
            console.log(`Remove member attempt: Cannot remove the only admin ${memberId} from group ${groupId}.`);
            return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
        }

        currentMembers = currentMembers.filter(uid => uid !== memberId);
        delete currentMemberRoles[memberId];

        const hasAdmins = Object.values(currentMemberRoles).includes('admin');
        if (currentMembers.length === 0 || !hasAdmins) {
            const { error: deleteMessagesError } = await supabase
                .from('messages')
                .delete()
                .eq('chatId', groupId);
            if (deleteMessagesError) console.error('Supabase delete messages error:', deleteMessagesError);

            const { error: deleteChatError } = await supabase
                .from('chats')
                .delete()
                .eq('id', groupId);
            if (deleteChatError) throw deleteChatError;

            console.log(`Group ${groupId} deleted due to no members or no admins.`);
            res.status(200).json({ message: 'تمت إزالة العضو وتم حذف المجموعة لعدم وجود أعضاء أو مشرفين.' });
        } else {
            const { error: updateError } = await supabase
                .from('chats')
                .update({ members: currentMembers, memberRoles: currentMemberRoles })
                .eq('id', groupId);
            if (updateError) throw updateError;

            console.log(`Member ${memberId} removed from group ${groupId}.`);
            res.status(200).json({ message: 'تمت إزالة العضو بنجاح.' });
        }
    } catch (dbError) {
        console.error('Unexpected error removing group member:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إزالة العضو.' });
    }
});

// 19. Get Group Member Count
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const { data: group, error } = await supabase
            .from('chats')
            .select('members')
            .eq('id', groupId)
            .eq('type', 'group')
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase get group member count error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json({ count: group.members ? group.members.length : 0 });
    } catch (dbError) {
        console.error('Unexpected error getting group member count:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// --- Posts API ---

// Get all posts or filtered posts
app.get('/api/posts', async (req, res) => {
    try {
        const { data: postsData, error } = await supabase
            .from('posts')
            .select('*')
            .order('timestamp', { ascending: false }); // Newest first

        if (error) {
            console.error('Supabase get all posts error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب المنشورات.' });
        }
        
        // Fetch follower count for each author and add to the post object
        const postsWithFollowerCount = await Promise.all(postsData.map(async post => {
            const { data: author, error: authorError } = await supabase
                .from('users')
                .select('followers')
                .eq('id', post.authorId)
                .single();

            if (authorError && authorError.code !== 'PGRST116') {
                console.warn(`Could not fetch followers for author ${post.authorId}:`, authorError);
            }
            return {
                ...post,
                followerCount: author && author.followers ? author.followers.length : 0
            };
        }));

        console.log(`Returning ${postsWithFollowerCount.length} total posts.`);
        res.status(200).json(postsWithFollowerCount);
    } catch (dbError) {
        console.error('Unexpected error getting all posts:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Get posts from followed users
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('following')
            .eq('id', userId)
            .single();

        if (userError && userError.code !== 'PGRST116') {
            console.error('Supabase get user for followed posts error:', userError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!user) {
            console.log('Get followed posts: User not found for ID', userId);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const followedUserIds = user.following || [];

        if (followedUserIds.length === 0) {
            console.log(`No followed users for ${userId}. Returning empty array.`);
            return res.status(200).json([]);
        }

        const { data: followedPosts, error: postsError } = await supabase
            .from('posts')
            .select('*')
            .in('authorId', followedUserIds)
            .order('timestamp', { ascending: false });

        if (postsError) {
            console.error('Supabase get followed posts error:', postsError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب منشورات المتابعين.' });
        }

        // Fetch follower count for each author and add to the post object
        const postsWithFollowerCount = await Promise.all(followedPosts.map(async post => {
            const { data: author, error: authorError } = await supabase
                .from('users')
                .select('followers')
                .eq('id', post.authorId)
                .single();

            if (authorError && authorError.code !== 'PGRST116') {
                console.warn(`Could not fetch followers for author ${post.authorId}:`, authorError);
            }
            return {
                ...post,
                followerCount: author && author.followers ? author.followers.length : 0
            };
        }));


        console.log(`Returning ${postsWithFollowerCount.length} followed posts for user ${userId}.`);
        res.status(200).json(postsWithFollowerCount);
    } catch (dbError) {
        console.error('Unexpected error getting followed posts:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Search posts (basic text search)
app.get('/api/posts/search', async (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    const filterType = req.query.filter || 'all'; // 'all' or 'followed'
    const userId = req.query.userId;

    try {
        let postsQuery = supabase.from('posts').select('*').order('timestamp', { ascending: false });

        if (filterType === 'followed' && userId) {
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('following')
                .eq('id', userId)
                .single();
            if (userError || !user) {
                console.error('Supabase search: User not found for followed filter.', userError);
                return res.status(404).json({ error: 'المستخدم غير موجود للبحث في منشورات المتابعين.' });
            }
            const followedUserIds = user.following || [];
            if (followedUserIds.length > 0) {
                postsQuery = postsQuery.in('authorId', followedUserIds);
            } else {
                console.log(`No followed users for ${userId}. Returning empty search array.`);
                return res.status(200).json([]);
            }
        }

        const { data: filteredPostsData, error: postsError } = await postsQuery;

        if (postsError) {
            console.error('Supabase search posts error:', postsError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء البحث في المنشورات.' });
        }

        let filteredResults = filteredPostsData;

        if (query) {
            filteredResults = filteredResults.filter(p =>
                (p.text && p.text.toLowerCase().includes(query)) ||
                (p.authorName && p.authorName.toLowerCase().includes(query))
            );
        }

        // Fetch follower count for each author and add to the post object
        const postsWithFollowerCount = await Promise.all(filteredResults.map(async post => {
            const { data: author, error: authorError } = await supabase
                .from('users')
                .select('followers')
                .eq('id', post.authorId)
                .single();

            if (authorError && authorError.code !== 'PGRST116') {
                console.warn(`Could not fetch followers for author ${post.authorId}:`, authorError);
            }
            return {
                ...post,
                followerCount: author && author.followers ? author.followers.length : 0
            };
        }));


        console.log(`Returning ${postsWithFollowerCount.length} search results for query '${query}' with filter '${filterType}'.`);
        res.status(200).json(postsWithFollowerCount);
    } catch (dbError) {
        console.error('Unexpected error searching posts:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// Create a new post
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;

    if (!authorId || !authorName || (!text && !mediaFile)) {
        console.log('Create post attempt: Missing authorId, authorName, text or mediaFile.', req.body);
        return res.status(400).json({ error: 'معرف المؤلف، اسمه، ونص المنشور أو ملف الوسائط مطلوب.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        // Here you'd upload the actual file to Supabase Storage.
        // Example: const { data: fileData, error: uploadError } = await supabase.storage.from('post_media').upload(`${generateUniqueId()}-${mediaFile.originalname}`, mediaFile.buffer);
        // if (uploadError) throw uploadError;
        // mediaUrl = fileData.publicURL;
        console.log(`Media file received for post: ${mediaFile.originalname}. (Simulating upload to Supabase Storage)`);
        if (mediaType === 'image') {
            mediaUrl = `https://placehold.co/400x300/e0f2f7/000?text=Post+Image`;
        } else if (mediaType === 'video') {
            mediaUrl = `https://www.w3schools.com/html/mov_bbb.mp4`; // Example video
        }
    }

    const newPost = {
        id: generateUniqueId(),
        authorId,
        authorName,
        text,
        mediaType: mediaType || 'text',
        mediaUrl: mediaUrl,
        authorProfileBg: authorProfileBg || null,
        timestamp: Date.now(),
        likes: [], // Array of user UIDs who liked the post
        views: [], // Array of user UIDs who viewed the post
        comments: [] // Array of comments (will be stored in separate comments table)
    };

    try {
        const { data, error } = await supabase
            .from('posts')
            .insert([newPost]);

        if (error) {
            console.error('Supabase insert post error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء نشر المنشور.' });
        }

        console.log('Created new post:', newPost.id, 'by', newPost.authorName);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح.', postId: newPost.id });
    } catch (dbError) {
        console.error('Unexpected error creating post:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Increment post view count
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        console.log('View post attempt: Missing userId for post', postId);
        return res.status(400).json({ error: 'معرف المستخدم مطلوب لتسجيل المشاهدة.' });
    }

    try {
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select('views')
            .eq('id', postId)
            .single();

        if (postError && postError.code !== 'PGRST116') {
            console.error('Supabase get post for view error:', postError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!post) {
            console.log('View post attempt: Post not found for ID', postId);
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentViews = post.views || [];
        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            const { error: updateError } = await supabase
                .from('posts')
                .update({ views: currentViews })
                .eq('id', postId);

            if (updateError) {
                console.error('Supabase update post views error:', updateError);
                return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تحديث المشاهدات.' });
            }
            console.log(`Post ${postId} viewed by ${userId}. Total views: ${currentViews.length}`);
        } else {
            console.log(`Post ${postId} already viewed by ${userId}.`);
        }
        res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: currentViews.length });
    } catch (dbError) {
        console.error('Unexpected error incrementing post view count:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// Toggle post like
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        console.log('Like post attempt: Missing userId for post', postId);
        return res.status(400).json({ error: 'معرف المستخدم مطلوب للإعجاب.' });
    }

    try {
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select('likes')
            .eq('id', postId)
            .single();

        if (postError && postError.code !== 'PGRST116') {
            console.error('Supabase get post for like error:', postError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!post) {
            console.log('Like post attempt: Post not found for ID', postId);
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        let currentLikes = post.likes || [];
        const isLiked = currentLikes.includes(userId);
        let message;

        if (isLiked) {
            currentLikes = currentLikes.filter(id => id !== userId);
            message = 'تم إلغاء الإعجاب.';
        } else {
            currentLikes.push(userId);
            message = 'تم الإعجاب بنجاح.';
        }

        const { error: updateError } = await supabase
            .from('posts')
            .update({ likes: currentLikes })
            .eq('id', postId);

        if (updateError) {
            console.error('Supabase update post likes error:', updateError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء تحديث الإعجابات.' });
        }

        console.log(`User ${userId} toggled like for post ${postId}. Likes: ${currentLikes.length}`);
        res.status(200).json({ message, isLiked: !isLiked, likesCount: currentLikes.length });
    } catch (dbError) {
        console.error('Unexpected error toggling post like:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Get comments for a post
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const { data: comments, error } = await supabase
            .from('comments')
            .select('id, userId, username, text, timestamp') // Select relevant fields
            .eq('postId', postId)
            .order('timestamp', { ascending: true }); // Order by timestamp

        if (error) {
            console.error('Supabase get comments error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء جلب التعليقات.' });
        }

        // Fix for frontend: frontend expects 'user' field, not 'username' for comments display
        const formattedComments = comments.map(comment => ({
            id: comment.id,
            userId: comment.userId,
            user: comment.username, // Change 'username' to 'user' for frontend compatibility
            text: comment.text,
            timestamp: comment.timestamp
        }));

        console.log(`Returning ${formattedComments.length} comments for post ${postId}.`);
        res.status(200).json(formattedComments);
    } catch (dbError) {
        console.error('Unexpected error getting comments:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    if (!userId || !username || !text) {
        console.log('Add comment attempt: Missing userId, username, or text.');
        return res.status(400).json({ error: 'معرف المستخدم واسمه ونص التعليق مطلوب.' });
    }

    try {
        // Optional: Check if post exists before adding comment
        const { data: postExists, error: postCheckError } = await supabase
            .from('posts')
            .select('id')
            .eq('id', postId)
            .single();

        if (postCheckError && postCheckError.code !== 'PGRST116') {
            console.error('Supabase check post for comment error:', postCheckError);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات.' });
        }
        if (!postExists) {
            console.log('Add comment attempt: Post not found for ID', postId);
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        const newComment = {
            id: generateUniqueId(),
            postId,
            userId,
            username, // Store as username in DB
            text,
            timestamp: Date.now()
        };

        const { data, error } = await supabase
            .from('comments')
            .insert([newComment]);

        if (error) {
            console.error('Supabase insert comment error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء إضافة التعليق.' });
        }

        console.log(`Added comment to post ${postId} by ${username}.`);
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', commentId: newComment.id });
    } catch (dbError) {
        console.error('Unexpected error adding comment:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});

// Delete Post (and its comments)
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    // Assuming frontend verifies authorId, or you'd pass it in body for backend verification
    // For simplicity here, we proceed with delete if post exists.

    try {
        // First delete associated comments
        const { error: deleteCommentsError } = await supabase
            .from('comments')
            .delete()
            .eq('postId', postId);
        if (deleteCommentsError) {
            console.error('Supabase delete comments for post error:', deleteCommentsError);
            // Don't stop here, try to delete the post even if comments deletion fails
        }

        const { data, error } = await supabase
            .from('posts')
            .delete()
            .eq('id', postId);

        if (error) {
            console.error('Supabase delete post error:', error);
            return res.status(500).json({ error: 'خطأ في قاعدة البيانات أثناء حذف المنشور.' });
        }

        if (data.length === 0) { // Supabase returns empty array if no rows deleted
            console.log('Delete post attempt: Post not found for ID', postId);
            return res.status(404).json({ error: 'المنشور غير موجود.' });
        }

        console.log(`Post ${postId} and its comments deleted.`);
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    } catch (dbError) {
        console.error('Unexpected error deleting post:', dbError);
        res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})
