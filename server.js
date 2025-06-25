// server.js (Backend)

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); // For handling file uploads (multipart/form-data)
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory "database" for demonstration purposes.
// Data will be lost when the server restarts.
const users = [];
let posts = []; // Changed to 'let' as it's reassigned in delete post
let chats = []; // Changed to 'let' as it's reassigned in delete chat
let messages = []; // Changed to 'let' as it's reassigned in delete chat

// --- Helper for generating unique IDs and custom IDs ---
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateCustomId() {
    // Generate an 8-digit custom ID
    let id;
    do {
        id = Math.floor(10000000 + Math.random() * 90000000).toString();
    } while (users.some(u => u.customId === id)); // Ensure uniqueness
    return id;
}

// --- CORS and Body Parser Middleware ---
app.use(cors()); // Allow all cross-origin requests
app.use(bodyParser.json()); // For parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// Multer for file uploads (diskStorage is just a placeholder, actual storage needs cloud)
const storage = multer.memoryStorage(); // Store files in memory temporarily
const upload = multer({ storage: storage });

// --- API Endpoints ---

// 1. User Registration
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        console.log('Register attempt: Missing username or password.');
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    if (users.some(u => u.username === username)) {
        console.log(`Register attempt: Username '${username}' already exists.`);
        return res.status(409).json({ error: 'اسم المستخدم هذا موجود بالفعل.' });
    }

    const newUser = {
        uid: generateUniqueId(),
        username,
        password, // In a real app, hash this password!
        customId: generateCustomId(),
        profileBg: null, // Default profile background URL
        followers: [], // UIDs of users who follow this user
        following: []  // UIDs of users this user follows
    };
    users.push(newUser);
    console.log('Registered new user:', newUser.username, 'UID:', newUser.uid, 'Custom ID:', newUser.customId);
    res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح.', user: { uid: newUser.uid, username: newUser.username, customId: newUser.customId } });
});

// 2. User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const user = users.find(u => u.username === username && u.password === password); // In a real app, compare hashed password!

    if (!user) {
        console.log('Login attempt failed: Invalid username or password for', username);
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    // Return all necessary user data upon login
    console.log('User logged in:', user.username, 'UID:', user.uid);
    res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg, followers: user.followers, following: user.following } });
});

// 3. Get User by Custom ID (Crucial for private chat initiation)
app.get('/api/user/by-custom-id/:customId', (req, res) => {
    const { customId } = req.params;
    const user = users.find(u => u.customId === customId);

    if (!user) {
        console.log(`Get User by Custom ID: User with Custom ID '${customId}' not found.`);
        return res.status(404).json({ error: 'لم يتم العثور على مستخدم بهذا المعرف.' });
    }
    // Return relevant public user data, including their actual username and profileBg
    console.log(`Found user for custom ID '${customId}': ${user.username}, UID: ${user.uid}`);
    res.status(200).json({ uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg });
});

// 4. Upload Profile Background
app.post('/api/upload-profile-background', upload.single('file'), (req, res) => {
    const { userId } = req.body;
    const user = users.find(u => u.uid === userId);

    if (!user) {
        console.log('Upload profile background: User not found for ID', userId);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    
    // For demonstration, we just update the URL to a placeholder or a generic image.
    // In a real application, you would upload req.file.buffer to cloud storage (e.g., AWS S3, Google Cloud Storage)
    let imageUrl = 'https://placehold.co/100x100/eeeeee/000?text=Profile'; // Default placeholder
    if (req.file) {
        console.log(`File received for user ${userId}: ${req.file.originalname}. (Simulating upload)`);
        // In a real app, this is where you'd upload the file and get a real URL.
        // For now, we'll just use a more dynamic placeholder or a fixed one.
        imageUrl = `https://placehold.co/100x100/${Math.floor(Math.random()*16777215).toString(16)}/ffffff?text=${user.username.charAt(0).toUpperCase()}`;
    } else {
        console.log(`No file received for user ${userId}, setting default placeholder.`);
    }

    user.profileBg = imageUrl;
    console.log(`User ${userId} profile background updated to: ${user.profileBg}`);
    res.status(200).json({ message: 'تم تعيين الخلفية بنجاح (باستخدام صورة بديلة).', url: user.profileBg });
});

// 5. Get User's Profile Background (if needed separately)
app.get('/api/user/:userId/profile-background', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.status(200).json({ url: user.profileBg || null });
});


// 6. Get User's Follower Count
app.get('/api/user/:userId/followers/count', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    res.status(200).json({ count: user.followers.length });
});

// 7. Toggle Follow/Unfollow
app.post('/api/user/:followerId/follow/:targetId', (req, res) => {
    const { followerId, targetId } = req.params;

    const follower = users.find(u => u.uid === followerId);
    const targetUser = users.find(u => u.uid === targetId);

    if (!follower || !targetUser) {
        return res.status(404).json({ error: 'المستخدم (المتابع أو المستهدف) غير موجود.' });
    }
    if (followerId === targetId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    const isFollowing = follower.following.includes(targetId);
    let message;

    if (isFollowing) {
        // Unfollow
        follower.following = follower.following.filter(id => id !== targetId);
        targetUser.followers = targetUser.followers.filter(id => id !== followerId);
        message = 'تم إلغاء المتابعة.';
        console.log(`User ${follower.username} unfollowed ${targetUser.username}`);
    } else {
        // Follow
        follower.following.push(targetId);
        targetUser.followers.push(followerId);
        message = 'تمت المتابعة بنجاح.';
        console.log(`User ${follower.username} followed ${targetUser.username}`);
    }

    res.status(200).json({ message, isFollowing: !isFollowing });
});

// 8. Check Follow Status
app.get('/api/user/:followerId/following/:targetId', (req, res) => {
    const { followerId, targetId } = req.params;
    const follower = users.find(u => u.uid === followerId);

    if (!follower) {
        return res.status(404).json({ error: 'المستخدم المتابع غير موجود.' });
    }
    const isFollowing = follower.following.includes(targetId);
    res.status(200).json({ isFollowing });
});


// 9. Get User's Contacts (for group creation and other features)
app.get('/api/user/:userId/contacts', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        console.log('Get contacts: User not found for ID', userId);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    // FIX: Only return users with whom the current user has private chats
    const privateChatPartnersUids = new Set();
    chats.forEach(chat => {
        if (chat.type === 'private' && chat.members.includes(userId)) {
            const otherMember = chat.members.find(memberId => memberId !== userId);
            if (otherMember) {
                privateChatPartnersUids.add(otherMember);
            }
        }
    });

    const contactsToDisplay = users.filter(u => privateChatPartnersUids.has(u.uid))
                               .map(u => ({ uid: u.uid, username: u.username, customId: u.customId }));

    console.log(`Returning ${contactsToDisplay.length} actual contacts for user ${user.username}.`);
    res.status(200).json(contactsToDisplay);
});


// 10. Create Private Chat (Updated for better logic)
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        console.log('Create private chat attempt: Missing required fields.', req.body);
        return res.status(400).json({ error: 'جميع حقول المستخدمين واسم جهة الاتصال مطلوبة لإنشاء محادثة خاصة.' });
    }

    // Ensure users exist
    const actualUser1 = users.find(u => u.uid === user1Id);
    const actualUser2 = users.find(u => u.uid === user2Id);
    if (!actualUser1 || !actualUser2) {
        console.log('Create private chat attempt: One or both actual users not found. User1:', user1Id, 'User2:', user2Id);
        return res.status(404).json({ error: 'أحد المستخدمين أو كلاهما غير موجود.' });
    }
    if (user1Id === user2Id) {
        console.log('Create private chat attempt: Cannot chat with self for private chat.');
        return res.status(400).json({ error: 'لا يمكنك بدء محادثة فردية مع نفسك.' });
    }

    // Check if a private chat already exists between these two users
    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.members.includes(user1Id) && chat.members.includes(user2Id)))
    );

    if (existingChat) {
        console.log(`Existing private chat found between ${user1Name} and ${user2Name}. Chat ID: ${existingChat.id}`);
        return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
    }

    const newChat = {
        id: generateUniqueId(),
        type: 'private',
        members: [user1Id, user2Id], // UIDs of both users
        memberInfo: { // Store info for quick display in chat list for each user
            [user1Id]: { username: user1Name, customId: user1CustomId, contactName: contactName, profileBg: actualUser1.profileBg }, // contactName saved by user1
            [user2Id]: { username: user2Name, customId: user2CustomId, contactName: user1Name, profileBg: actualUser2.profileBg } // user2 saves user1's actual name
        },
        createdAt: Date.now(),
        lastMessage: null,
        timestamp: Date.now(),
        // For private chats, the 'profileBg' of the chat itself isn't used, individual member profileBgs are used.
    };
    chats.push(newChat);
    console.log('Created new private chat:', newChat.id, 'between', user1Name, 'and', user2Name);
    res.status(201).json({ message: 'تم إنشاء المحادثة الخاصة بنجاح.', chatId: newChat.id });
});

// FIX: New API endpoint to update contact name in a private chat
app.put('/api/chats/private/:chatId/contact-name', (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;

    if (!userId || !newContactName) {
        return res.status(400).json({ error: 'معرف المستخدم والاسم الجديد مطلوبان.' });
    }

    const chat = chats.find(c => c.id === chatId && c.type === 'private');
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
    }

    // Ensure the user is a member of this chat
    if (!chat.members.includes(userId)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه المحادثة.' });
    }

    // Update the contactName specifically for the requesting user
    if (chat.memberInfo && chat.memberInfo[userId]) {
        chat.memberInfo[userId].contactName = newContactName;
        console.log(`Contact name for chat ${chatId} updated by user ${userId} to: ${newContactName}`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } else {
        return res.status(404).json({ error: 'معلومات العضو غير موجودة في المحادثة.' });
    }
});


// 11. Create Group Chat
app.post('/api/groups', (req, res) => {
    const { name, description, adminId, members, profileBg } = req.body; // Added profileBg for group

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        console.log('Create group attempt: Missing required fields or less than 2 members.', req.body);
        return res.status(400).json({ error: 'اسم المجموعة، المشرف، وعضوين على الأقل مطلوبون لإنشاء المجموعة.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
         console.log('Create group attempt: Admin not specified or not an admin role.', adminId, members);
         return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً في المجموعة.' });
    }

    const newGroup = {
        id: generateUniqueId(),
        type: 'group',
        name,
        description,
        adminId, // Creator is the initial owner/admin
        members: Object.keys(members), // Array of UIDs
        memberRoles: members, // { uid: 'admin' | 'member' }
        createdAt: Date.now(),
        lastMessage: null,
        timestamp: Date.now(),
        profileBg: profileBg || null // Group profile background (can be updated later)
    };
    chats.push(newGroup);
    console.log('Created new group:', newGroup.id, 'Name:', newGroup.name);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroup.id });
});

// FIX: API endpoint to update group name
app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;

    if (!newName) {
        return res.status(400).json({ error: 'الاسم الجديد للمجموعة مطلوب.' });
    }

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // Only admins can change group name
    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير اسم المجموعة.' });
    }

    group.name = newName;
    console.log(`Group ${groupId} name updated to: ${newName}`);
    res.status(200).json({ message: 'تم تحديث اسم المجموعة بنجاح.' });
});

// FIX: API endpoint to add members to a group
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body; // newMemberUids is an array of UIDs to add

    if (!newMemberUids || !Array.isArray(newMemberUids) || newMemberUids.length === 0) {
        return res.status(400).json({ error: 'معرفات الأعضاء الجدد مطلوبة.' });
    }

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    // Only admins can add members
    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(memberUid => {
        if (!group.members.includes(memberUid)) {
            group.members.push(memberUid);
            group.memberRoles[memberUid] = 'member'; // Default role is member
            addedMembers.push(memberUid);
        }
    });

    if (addedMembers.length === 0) {
        return res.status(400).json({ message: 'جميع الأعضاء المحددين موجودون بالفعل في المجموعة.' });
    }

    console.log(`Added ${addedMembers.length} members to group ${groupId}.`);
    res.status(200).json({ message: 'تم إضافة الأعضاء بنجاح.', addedMembersUids: addedMembers });
});


// 12. Get User's Chat List
app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;

    const userChats = chats.filter(chat => chat.members.includes(userId));

    // Format chats for frontend display
    const formattedChats = userChats.map(chat => {
        let chatNameForDisplay;
        let chatCustomIdForDisplay = null;
        let chatProfileBgForDisplay = null;
        // Use chat.lastMessage, fallback to default text if null/undefined
        let lastMessageText = chat.lastMessage || 'لا توجد رسائل بعد.';

        if (chat.type === 'private') {
            // For private chats, display the other user's name/contactName
            const otherUserId = chat.members.find(memberId => memberId !== userId);
            const otherUser = users.find(u => u.uid === otherUserId);
            
            // Prioritize the contactName saved by the current user for THIS chat item
            chatNameForDisplay = chat.memberInfo[userId]?.contactName || otherUser?.username || 'مستخدم غير معروف';
            chatCustomIdForDisplay = otherUser?.customId || null;
            chatProfileBgForDisplay = otherUser?.profileBg || null;

        } else { // Group chat
            chatNameForDisplay = chat.name;
            chatProfileBgForDisplay = chat.profileBg; // Use group's specific profile bg
        }

        return {
            id: chat.id,
            type: chat.type,
            name: chatNameForDisplay,
            customId: chatCustomIdForDisplay, // Only for private chats, will be null for groups
            lastMessage: lastMessageText,
            timestamp: chat.timestamp,
            profileBg: chatProfileBgForDisplay // Other user's profile bg for private, group's for group
        };
    });

    // Sort by timestamp (newest first)
    formattedChats.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Returning ${formattedChats.length} chats for user ${userId}.`);
    res.status(200).json(formattedChats);
});

// 13. Get Messages for a Chat
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0; // Filter messages newer than this timestamp

    const chatMessages = messages.filter(msg => msg.chatId === chatId && msg.timestamp > since);
    
    // Sort messages by timestamp
    chatMessages.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Returning ${chatMessages.length} messages for chat ${chatId} (since ${since}).`);
    res.status(200).json(chatMessages);
});

// 14. Send Message to a Chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body; // senderProfileBg included by frontend
    const mediaFile = req.file;

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        console.log('Send message attempt: Chat not found for ID', chatId);
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    // Important: Allow text to be an empty string, but not null/undefined if no media
    if (!senderId || (text === undefined && !mediaFile)) {
        console.log('Send message attempt: Missing senderId, text or mediaFile. Req body:', req.body);
        return res.status(400).json({ error: 'معرف المرسل أو نص الرسالة أو ملف الوسائط مطلوب.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        // Placeholder for actual file upload to cloud storage
        if (mediaType === 'image') {
            mediaUrl = `https://placehold.co/300x200/cccccc/000?text=Image+Placeholder`;
        } else if (mediaType === 'video') {
            mediaUrl = `https://www.w3schools.com/html/mov_bbb.mp4`; // A generic test video
        }
        console.log(`Media file received for chat ${chatId}: ${mediaFile.originalname}. Returning placeholder URL: ${mediaUrl}`);
    }

    const newMessage = {
        id: generateUniqueId(),
        chatId,
        senderId,
        senderName,
        text: text !== undefined ? text : '', // Ensure text is an empty string if undefined (e.g., only media sent)
        mediaType: mediaType || null,
        mediaUrl: mediaUrl,
        senderProfileBg: senderProfileBg || null, // Store sender's profile bg with message
        timestamp: Date.now(),
        status: 'sent' // Can be expanded to 'delivered', 'read'
    };
    messages.push(newMessage);

    // Update last message in chat metadata
    chat.lastMessage = text || (mediaType === 'image' ? 'صورة' : 'فيديو');
    chat.timestamp = newMessage.timestamp; // Update chat timestamp for sorting

    console.log(`Message sent to chat ${chatId} by ${senderName}. Stored text: "${newMessage.text}"`); // Added console log for stored text
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageId: newMessage.id });
});

// 15. Delete Chat / Leave Group
app.post('/api/chats/delete', (req, res) => {
    const { chatId, chatType, action, userId } = req.body; // action: 'forMe', 'forBoth', 'leaveGroup'

    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex === -1) {
        console.log('Delete chat attempt: Chat not found for ID', chatId);
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];

    if (chatType === 'private') {
        if (action === 'forMe') {
            // For in-memory, we can't truly hide for one user without more complex structure.
            // We'll simulate by just telling the frontend it's deleted.
            console.log(`Simulating deletion of private chat ${chatId} for user ${userId} (forMe).`);
            res.status(200).json({ message: 'تم حذف المحادثة من عندك فقط (محاكاة).' });
        } else if (action === 'forBoth') {
            // Delete chat and all its messages
            chats.splice(chatIndex, 1);
            const initialMessageCount = messages.length;
            messages = messages.filter(msg => msg.chatId !== chatId);
            console.log(`Deleted private chat ${chatId} and ${initialMessageCount - messages.length} messages.`);
            res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
        } else {
            console.log('Delete chat attempt: Invalid action for private chat.', action);
            return res.status(400).json({ error: 'إجراء حذف غير صالح للمحادثة الخاصة.' });
        }
    } else if (chatType === 'group') {
        if (action === 'forMe') {
            // Simulate leaving group from user's perspective, without affecting others
            console.log(`Simulating deletion of group chat ${chatId} for user ${userId} (forMe - leave group).`);
            res.status(200).json({ message: 'تم حذف المجموعة من عندك فقط (محاكاة).' });
        } else if (action === 'leaveGroup') {
            // Remove user from group members
            chat.members = chat.members.filter(memberId => memberId !== userId);
            delete chat.memberRoles[userId];
            console.log(`User ${userId} left group ${chatId}. Remaining members: ${chat.members.length}`);

            // If group has no members left or no admins, delete it
            const hasAdmins = Object.values(chat.memberRoles).some(role => role === 'admin'); // Check if any admin exists
            if (chat.members.length === 0 || !hasAdmins) {
                const chatIndex = chats.findIndex(c => c.id === groupId); // Re-find index as chats array might have changed
                if (chatIndex !== -1) { // Ensure it still exists before splicing
                    chats.splice(chatIndex, 1);
                }
                messages = messages.filter(msg => msg.chatId !== groupId); // Also delete messages
                console.log(`Group ${groupId} deleted due to no members or no admins.`);
                res.status(200).json({ message: 'لقد غادرت المجموعة وتم حذفها لعدم وجود أعضاء أو مشرفين.' });
            } else {
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
});


// 16. Get Group Members (and their roles)
app.get('/api/group/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');

    if (!group) {
        console.log('Get group members attempt: Group not found for ID', groupId);
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const membersInfo = group.members.map(memberUid => {
        const user = users.find(u => u.uid === memberUid);
        return {
            uid: memberUid,
            username: user ? user.username : 'مستخدم غير معروف',
            customId: user ? user.customId : null,
            role: group.memberRoles[memberUid] || 'عضو'
        };
    });
    console.log(`Returning ${membersInfo.length} members for group ${groupId}.`);
    res.status(200).json(membersInfo);
});

// 17. Change Group Member Role (Admin only)
app.put('/api/group/:groupId/members/:memberId/role', (req, res) => {
    const { groupId, memberId } = req.params;
    const { newRole, callerUid } = req.body; // newRole: 'admin' or 'member'

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        console.log('Change role attempt: Group not found for ID', groupId);
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        console.log(`Change role attempt: Caller ${callerUid} is not an admin in group ${groupId}.`);
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير أدوار الأعضاء.' });
    }

    if (!group.members.includes(memberId)) {
        console.log(`Change role attempt: Member ${memberId} not found in group ${groupId}.`);
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    // Prevent demoting the only admin if there's only one left
    const currentAdmins = Object.keys(group.memberRoles).filter(uid => group.memberRoles[uid] === 'admin');
    if (newRole === 'member' && currentAdmins.length === 1 && currentAdmins[0] === memberId) {
        console.log(`Change role attempt: Cannot demote the only admin ${memberId} in group ${groupId}.`);
        return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
    }

    group.memberRoles[memberId] = newRole;
    console.log(`Member ${memberId} role changed to ${newRole} in group ${groupId}.`);
    res.status(200).json({ message: `تم تغيير دور العضو إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });
});

// 18. Remove Group Member (Admin only)
app.delete('/api/group/:groupId/members/:memberId', (req, res) => {
    const { groupId, memberId } = req.params;
    const { callerUid } = req.body;

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        console.log('Remove member attempt: Group not found for ID', groupId);
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        console.log(`Remove member attempt: Caller ${callerUid} is not an admin in group ${groupId}.`);
        return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة الأعضاء.' });
    }

    if (!group.members.includes(memberId)) {
        console.log(`Remove member attempt: Member ${memberId} not found in group ${groupId}.`);
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    // Prevent removing the only admin if there's only one left
    const currentAdmins = Object.keys(group.memberRoles).filter(uid => group.memberRoles[uid] === 'admin');
    if (currentAdmins.length === 1 && currentAdmins[0] === memberId) {
        console.log(`Remove member attempt: Cannot remove the only admin ${memberId} from group ${groupId}.`);
        return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
    }

    group.members = group.members.filter(uid => uid !== memberId);
    delete group.memberRoles[memberId];
    console.log(`Member ${memberId} removed from group ${groupId}.`);

    // If group becomes empty or has no admins left, delete the group
    const hasAdmins = Object.values(group.memberRoles).some(role => role === 'admin'); // Check if any admin exists
    if (group.members.length === 0 || !hasAdmins) {
        const chatIndex = chats.findIndex(c => c.id === groupId); // Re-find index as chats array might have changed
        if (chatIndex !== -1) { // Ensure it still exists before splicing
            chats.splice(chatIndex, 1);
        }
        messages = messages.filter(msg => msg.chatId !== groupId); // Also delete messages
        console.log(`Group ${groupId} deleted due to no members or no admins.`);
        return res.status(200).json({ message: 'تمت إزالة العضو وتم حذف المجموعة لعدم وجود أعضاء أو مشرفين.' });
    }

    res.status(200).json({ message: 'تمت إزالة العضو بنجاح.' });
});

// 19. Get Group Member Count
app.get('/api/group/:groupId/members/count', (req, res) => {
    const { groupId } = req.params;
    const group = chats.find(c => c.id === groupId && c.type === 'group');

    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }
    res.status(200).json({ count: group.members.length });
});

// --- Posts API (Simplified for basic functionality) ---

// Get all posts or filtered posts
app.get('/api/posts', (req, res) => {
    // In a real app, you'd handle pagination and complex filters.
    // FIX: Add followerCount to posts
    const postsWithFollowerCount = posts.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`Returning ${postsWithFollowerCount.length} total posts.`);
    res.status(200).json(postsWithFollowerCount);
});

// Get posts from followed users
app.get('/api/posts/followed/:userId', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        console.log('Get followed posts: User not found for ID', userId);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    const followedPosts = posts.filter(p => user.following.includes(p.authorId));
    
    // FIX: Add followerCount to followed posts
    const followedPostsWithFollowerCount = followedPosts.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`Returning ${followedPostsWithFollowerCount.length} followed posts for user ${userId}.`);
    res.status(200).json(followedPostsWithFollowerCount);
});

// Search posts (basic text search)
app.get('/api/posts/search', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    const filterType = req.query.filter || 'all'; // 'all' or 'followed'
    const userId = req.query.userId;

    let filteredResults = posts;

    if (filterType === 'followed' && userId) {
        const user = users.find(u => u.uid === userId);
        if (user) {
            filteredResults = filteredResults.filter(p => user.following.includes(p.authorId));
        } else {
            filteredResults = []; // No user, no followed posts
        }
    }

    if (query) {
        filteredResults = filteredResults.filter(p =>
            (p.text && p.text.toLowerCase().includes(query)) ||
            (p.authorName && p.authorName.toLowerCase().includes(query))
        );
    }
    
    // FIX: Add followerCount to search results
    const searchResultsWithFollowerCount = filteredResults.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`Returning ${searchResultsWithFollowerCount.length} search results for query '${query}' with filter '${filterType}'.`);
    res.status(200).json(searchResultsWithFollowerCount);
});


// Create a new post
app.post('/api/posts', upload.single('mediaFile'), (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file; // The uploaded file

    if (!authorId || !authorName || (text === undefined && !mediaFile)) { // Ensure text is defined or media exists
        console.log('Create post attempt: Missing authorId, authorName, text or mediaFile.', req.body);
        return res.status(400).json({ error: 'معرف المؤلف، اسمه، ونص المنشور أو ملف الوسائط مطلوب.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        // Placeholder for actual cloud storage upload
        if (mediaType === 'image') {
            mediaUrl = `https://placehold.co/400x300/e0f2f7/000?text=Post+Image`;
        } else if (mediaType === 'video') {
            mediaUrl = `https://www.w3schools.com/html/mov_bbb.mp4`; // Example video
        }
        console.log(`Media file received for post: ${mediaFile.originalname}. Returning placeholder URL: ${mediaUrl}`);
    }

    const newPost = {
        id: generateUniqueId(),
        authorId,
        authorName,
        text: text !== undefined ? text : '', // Ensure text is an empty string if undefined
        mediaType: mediaType || 'text',
        mediaUrl: mediaUrl,
        authorProfileBg: authorProfileBg || null,
        timestamp: Date.now(),
        likes: [], // Array of user UIDs who liked the post
        views: [], // Array of user UIDs who viewed the post
        comments: [] // Array of comments (stored directly within post object for in-memory)
    };
    posts.push(newPost);
    console.log('Created new post:', newPost.id, 'by', newPost.authorName);
    res.status(201).json({ message: 'تم نشر المنشور بنجاح.', postId: newPost.id });
});

// Increment post view count
app.post('/api/posts/:postId/view', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        console.log('View post attempt: Post not found for ID', postId);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId) {
        console.log('View post attempt: Missing userId for post', postId);
        return res.status(400).json({ error: 'معرف المستخدم مطلوب لتسجيل المشاهدة.' });
    }

    if (!post.views.includes(userId)) {
        post.views.push(userId);
        console.log(`Post ${postId} viewed by ${userId}. Total views: ${post.views.length}`);
    } else {
        console.log(`Post ${postId} already viewed by ${userId}.`);
    }
    res.status(200).json({ message: 'تم تسجيل المشاهدة.', viewsCount: post.views.length });
});


// Toggle post like
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        console.log('Like post attempt: Post not found for ID', postId);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId) {
        console.log('Like post attempt: Missing userId for post', postId);
        return res.status(400).json({ error: 'معرف المستخدم مطلوب للإعجاب.' });
    }

    const isLiked = post.likes.includes(userId);
    let message;
    if (isLiked) {
        post.likes = post.likes.filter(id => id !== userId);
        message = 'تم إلغاء الإعجاب.';
        console.log(`User ${userId} unliked post ${postId}. Likes: ${post.likes.length}`);
    } else {
        post.likes.push(userId);
        message = 'تم الإعجاب بنجاح.';
        console.log(`User ${userId} liked post ${postId}. Likes: ${post.likes.length}`);
    }
    res.status(200).json({ message, isLiked: !isLiked, likesCount: post.likes.length });
});

// Get comments for a post
app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);
    if (!post) {
        console.log('Get comments attempt: Post not found for ID', postId);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    
    // FIX: Add user profileBg and likes to comments, then sort by likes (descending)
    const commentsWithUserData = post.comments.map(comment => {
        const commentAuthor = users.find(u => u.uid === comment.userId);
        return {
            id: comment.id,
            userId: comment.userId,
            user: commentAuthor ? commentAuthor.username : 'مستخدم غير معروف', // Changed username to user for frontend
            userProfileBg: commentAuthor ? commentAuthor.profileBg : null, // Add user's profile background
            text: comment.text,
            timestamp: comment.timestamp,
            likes: comment.likes || [] // Ensure likes array exists, even if empty
        };
    });

    // Sort comments by likes count (descending)
    commentsWithUserData.sort((a, b) => b.likes.length - a.likes.length);
    
    console.log(`Returning ${commentsWithUserData.length} comments for post ${postId}.`);
    res.status(200).json(commentsWithUserData);
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        console.log('Add comment attempt: Post not found for ID', postId);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId || !username || !text) {
        console.log('Add comment attempt: Missing userId, username, or text.');
        return res.status(400).json({ error: 'معرف المستخدم واسمه ونص التعليق مطلوب.' });
    }

    const newComment = {
        id: generateUniqueId(),
        userId,
        username, // Store as username
        text,
        timestamp: Date.now(),
        likes: [] // FIX: Initialize likes array for comments
    };
    post.comments.push(newComment);
    console.log(`Added comment to post ${postId} by ${username}.`);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', commentId: newComment.id });
});

// FIX: New API endpoint to toggle like on a comment
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
        return res.status(400).json({ error: 'معرف المستخدم مطلوب للإعجاب بالتعليق.' });
    }

    let message;
    if (!comment.likes) { // Initialize likes array if it doesn't exist
        comment.likes = [];
    }

    const isLiked = comment.likes.includes(userId);
    if (isLiked) {
        comment.likes = comment.likes.filter(id => id !== userId);
        message = 'تم إلغاء الإعجاب بالتعليق.';
    } else {
        comment.likes.push(userId);
        message = 'تم الإعجاب بالتعليق بنجاح.';
    }
    console.log(`User ${userId} toggled like for comment ${commentId}. Likes: ${comment.likes.length}`);
    res.status(200).json({ message, isLiked: !isLiked, likesCount: comment.likes.length });
});

// Delete Post (and its comments)
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const initialPostCount = posts.length;
    posts = posts.filter(p => p.id !== postId); // Remove the post

    if (posts.length === initialPostCount) {
        console.log('Delete post attempt: Post not found for ID', postId);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    console.log(`Post ${postId} deleted.`);
    res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
