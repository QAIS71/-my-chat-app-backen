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
let posts = [];
let chats = [];
let messages = [];

// --- Helper for generating unique IDs and custom IDs ---
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
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
    console.log(`[Register] Attempt for username: ${username}`);

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }
    if (users.some(u => u.username === username)) {
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
    console.log(`[Register] New user created: ${newUser.username} (UID: ${newUser.uid}, Custom ID: ${newUser.customId})`);
    res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح.', user: { uid: newUser.uid, username: newUser.username, customId: newUser.customId } });
});

// 2. User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`[Login] Attempt for username: ${username}`);

    const user = users.find(u => u.username === username && u.password === password); // In a real app, compare hashed password!

    if (!user) {
        console.log(`[Login] Failed for username: ${username} (Invalid credentials)`);
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    console.log(`[Login] Successful for user: ${user.username} (UID: ${user.uid})`);
    res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg, followers: user.followers, following: user.following } });
});

// 3. Get User by Custom ID (Crucial for private chat initiation)
app.get('/api/user/by-custom-id/:customId', (req, res) => {
    const { customId } = req.params;
    console.log(`[GetUser] By Custom ID: ${customId}`);
    const user = users.find(u => u.customId === customId);

    if (!user) {
        console.log(`[GetUser] User with Custom ID '${customId}' not found.`);
        return res.status(404).json({ error: 'لم يتم العثور على مستخدم بهذا المعرف.' });
    }
    console.log(`[GetUser] Found user: ${user.username} (UID: ${user.uid}) for Custom ID: ${customId}`);
    res.status(200).json({ uid: user.uid, username: user.username, customId: user.customId, profileBg: user.profileBg });
});

// 4. Upload Profile Background
app.post('/api/upload-profile-background', upload.single('file'), (req, res) => {
    const { userId } = req.body;
    console.log(`[UploadProfileBg] Attempt for user: ${userId}`);
    const user = users.find(u => u.uid === userId);

    if (!user) {
        console.log(`[UploadProfileBg] User not found: ${userId}`);
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    
    let imageUrl = 'https://placehold.co/100x100/eeeeee/000?text=Profile'; // Default placeholder
    if (req.file) {
        console.log(`[UploadProfileBg] File received for user ${userId}: ${req.file.originalname}. Simulating upload.`);
        imageUrl = `https://placehold.co/100x100/${Math.floor(Math.random()*16777215).toString(16)}/ffffff?text=${user.username.charAt(0).toUpperCase()}`;
    } else {
        console.log(`[UploadProfileBg] No file received for user ${userId}, setting default placeholder.`);
    }

    user.profileBg = imageUrl;
    console.log(`[UploadProfileBg] User ${userId} profile background updated to: ${user.profileBg}`);
    res.status(200).json({ message: 'تم تعيين الخلفية بنجاح (باستخدام صورة بديلة).', url: user.profileBg });
});

// 5. Get User's Profile Background (if needed separately)
app.get('/api/user/:userId/profile-background', (req, res) => {
    const { userId } = req.params;
    console.log(`[GetProfileBg] Attempt for user: ${userId}`);
    const user = users.find(u => u.uid === userId);
    if (!user) {
        console.log(`[GetProfileBg] User not found: ${userId}`);
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
    console.log(`[ToggleFollow] Follower: ${followerId}, Target: ${targetId}`);

    const follower = users.find(u => u.uid === followerId);
    const targetUser = users.find(u => u.uid === targetId);

    if (!follower || !targetUser) {
        console.log(`[ToggleFollow] User not found. Follower: ${followerId} or Target: ${targetId}`);
        return res.status(404).json({ error: 'المستخدم (المتابع أو المستهدف) غير موجود.' });
    }
    if (followerId === targetId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    const isFollowing = follower.following.includes(targetId);
    let message;

    if (isFollowing) {
        follower.following = follower.following.filter(id => id !== targetId);
        targetUser.followers = targetUser.followers.filter(id => id !== followerId);
        message = 'تم إلغاء المتابعة.';
        console.log(`[ToggleFollow] User ${follower.username} unfollowed ${targetUser.username}`);
    } else {
        follower.following.push(targetId);
        targetUser.followers.push(followerId);
        message = 'تمت المتابعة بنجاح.';
        console.log(`[ToggleFollow] User ${follower.username} followed ${targetUser.username}`);
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
    console.log(`[GetContacts] Attempt for user: ${userId}`);
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

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

    console.log(`[GetContacts] Returning ${contactsToDisplay.length} actual contacts for user ${user.username}.`);
    res.status(200).json(contactsToDisplay);
});

// 10. Create Private Chat (Updated for better logic)
app.post('/api/chats/private', (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    console.log(`[CreatePrivateChat] Attempt between ${user1Id} and ${user2Id}`);

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع حقول المستخدمين واسم جهة الاتصال مطلوبة لإنشاء محادثة خاصة.' });
    }

    const actualUser1 = users.find(u => u.uid === user1Id);
    const actualUser2 = users.find(u => u.uid === user2Id);
    if (!actualUser1 || !actualUser2) {
        return res.status(404).json({ error: 'أحد المستخدمين أو كلاهما غير موجود.' });
    }
    if (user1Id === user2Id) {
        return res.status(400).json({ error: 'لا يمكنك بدء محادثة فردية مع نفسك.' });
    }

    const existingChat = chats.find(chat =>
        chat.type === 'private' &&
        ((chat.members.includes(user1Id) && chat.members.includes(user2Id)))
    );

    if (existingChat) {
        console.log(`[CreatePrivateChat] Existing private chat found: ${existingChat.id}`);
        return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChat.id });
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
    };
    chats.push(newChat);
    console.log(`[CreatePrivateChat] New private chat created: ${newChat.id}`);
    res.status(201).json({ message: 'تم إنشاء المحادثة الخاصة بنجاح.', chatId: newChat.id });
});

// FIX: New API endpoint to update contact name in a private chat
app.put('/api/chats/private/:chatId/contact-name', (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;
    console.log(`[UpdateContactName] Chat: ${chatId}, User: ${userId}, New Name: ${newContactName}`);

    if (!userId || !newContactName) {
        return res.status(400).json({ error: 'معرف المستخدم والاسم الجديد مطلوبان.' });
    }

    const chat = chats.find(c => c.id === chatId && c.type === 'private');
    if (!chat) {
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليست محادثة خاصة.' });
    }

    if (!chat.members.includes(userId)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه المحادثة.' });
    }

    if (chat.memberInfo && chat.memberInfo[userId]) {
        chat.memberInfo[userId].contactName = newContactName;
        console.log(`[UpdateContactName] Contact name for chat ${chatId} updated by user ${userId} to: ${newContactName}`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } else {
        console.log(`[UpdateContactName] Member info not found for user ${userId} in chat ${chatId}`);
        return res.status(404).json({ error: 'معلومات العضو غير موجودة في المحادثة.' });
    }
});


// 11. Create Group Chat
app.post('/api/groups', (req, res) => {
    const { name, description, adminId, members, profileBg } = req.body;
    console.log(`[CreateGroup] Attempt for group: ${name}, Admin: ${adminId}`);

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، المشرف، وعضوين على الأقل مطلوبون لإنشاء المجموعة.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
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
        profileBg: profileBg || null
    };
    chats.push(newGroup);
    console.log(`[CreateGroup] New group created: ${newGroup.id} (Name: ${newGroup.name})`);
    res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroup.id });
});

// FIX: API endpoint to update group name
app.put('/api/groups/:groupId/name', (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;
    console.log(`[UpdateGroupName] Group: ${groupId}, New Name: ${newName}, Caller: ${callerUid}`);

    if (!newName) {
        return res.status(400).json({ error: 'الاسم الجديد للمجموعة مطلوب.' });
    }

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        console.log(`[UpdateGroupName] Caller ${callerUid} is not an admin for group ${groupId}`);
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير اسم المجموعة.' });
    }

    group.name = newName;
    console.log(`[UpdateGroupName] Group ${groupId} name updated to: ${newName}`);
    res.status(200).json({ message: 'تم تحديث اسم المجموعة بنجاح.' });
});

// FIX: API endpoint to add members to a group
app.post('/api/groups/:groupId/add-members', (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;
    console.log(`[AddGroupMembers] Group: ${groupId}, New Members: ${newMemberUids}, Caller: ${callerUid}`);

    if (!newMemberUids || !Array.isArray(newMemberUids) || newMemberUids.length === 0) {
        return res.status(400).json({ error: 'معرفات الأعضاء الجدد مطلوبة.' });
    }

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        console.log(`[AddGroupMembers] Caller ${callerUid} is not an admin for group ${groupId}`);
        return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة أعضاء إلى المجموعة.' });
    }

    const addedMembers = [];
    newMemberUids.forEach(memberUid => {
        if (!group.members.includes(memberUid)) {
            group.members.push(memberUid);
            group.memberRoles[memberUid] = 'member'; // Default role is member
            addedMembers.push(memberUid);
            console.log(`[AddGroupMembers] Added member ${memberUid} to group ${groupId}`);
        }
    });

    if (addedMembers.length === 0) {
        return res.status(400).json({ message: 'جميع الأعضاء المحددين موجودون بالفعل في المجموعة.' });
    }

    console.log(`[AddGroupMembers] Successfully added ${addedMembers.length} members to group ${groupId}.`);
    res.status(200).json({ message: 'تم إضافة الأعضاء بنجاح.', addedMembersUids: addedMembers });
});


// 12. Get User's Chat List
app.get('/api/user/:userId/chats', (req, res) => {
    const { userId } = req.params;
    console.log(`[GetUserChats] Attempt for user: ${userId}`);

    const userChats = chats.filter(chat => chat.members.includes(userId));

    const formattedChats = userChats.map(chat => {
        let chatNameForDisplay;
        let chatCustomIdForDisplay = null;
        let chatProfileBgForDisplay = null;
        let lastMessageText = chat.lastMessage || 'لا توجد رسائل بعد.';

        if (chat.type === 'private') {
            const otherUserId = chat.members.find(memberId => memberId !== userId);
            const otherUser = users.find(u => u.uid === otherUserId);
            
            chatNameForDisplay = chat.memberInfo[userId]?.contactName || otherUser?.username || 'مستخدم غير معروف';
            chatCustomIdForDisplay = otherUser?.customId || null;
            chatProfileBgForDisplay = otherUser?.profileBg || null;

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
    });

    formattedChats.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`[GetUserChats] Returning ${formattedChats.length} chats for user ${userId}.`);
    res.status(200).json(formattedChats);
});

// 13. Get Messages for a Chat
app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const since = parseInt(req.query.since) || 0;
    console.log(`[GetMessages] Chat: ${chatId}, Since: ${since}`);

    const chatMessages = messages.filter(msg => msg.chatId === chatId && msg.timestamp > since);
    
    chatMessages.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[GetMessages] Returning ${chatMessages.length} messages for chat ${chatId}.`);
    res.status(200).json(chatMessages);
});

// 14. Send Message to a Chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;
    console.log(`[SendMessage] Chat: ${chatId}, Sender: ${senderName}, Text length: ${text?.length || 0}, Media: ${mediaFile ? 'Yes' : 'No'}`);

    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
        console.log(`[SendMessage] Chat not found: ${chatId}`);
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    if (!senderId || (text === undefined && !mediaFile)) {
        return res.status(400).json({ error: 'معرف المرسل أو نص الرسالة أو ملف الوسائط مطلوب.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        if (mediaType === 'image') {
            mediaUrl = `https://placehold.co/300x200/cccccc/000?text=Image+Placeholder`;
        } else if (mediaType === 'video') {
            mediaUrl = `https://www.w3schools.com/html/mov_bbb.mp4`;
        }
        console.log(`[SendMessage] Media received, using placeholder URL: ${mediaUrl}`);
    }

    const newMessage = {
        id: generateUniqueId(),
        chatId,
        senderId,
        senderName,
        text: text !== undefined ? text : '',
        mediaType: mediaType || null,
        mediaUrl: mediaUrl,
        senderProfileBg: senderProfileBg || null,
        timestamp: Date.now(),
        status: 'sent'
    };
    messages.push(newMessage);

    chat.lastMessage = text || (mediaType === 'image' ? 'صورة' : 'فيديو');
    chat.timestamp = newMessage.timestamp;

    console.log(`[SendMessage] Message sent to chat ${chatId} by ${senderName}.`);
    res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageId: newMessage.id });
});

// 15. DELETE Chat / Leave Group Endpoints (Updated)
// Delete private chat for a specific user
app.delete('/api/chats/private/:chatId/for-user/:userId', (req, res) => {
    const { chatId, userId } = req.params;
    console.log(`[DeleteChat] Private chat ${chatId} for user ${userId} only.`);

    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private' && c.members.includes(userId));
    if (chatIndex === -1) {
        console.log(`[DeleteChat] Private chat ${chatId} not found for user ${userId}.`);
        return res.status(404).json({ error: 'المحادثة غير موجودة أو ليس لديك صلاحية الوصول إليها.' });
    }

    // In a real database, you'd mark this chat as "hidden" or "deleted" for this specific user.
    // In this in-memory simulation, we will remove it from the 'chats' array IF this is the only member left.
    // If both members delete "forMe" independently, then the chat will be removed only when the last one does it.
    // For simplicity, we'll just acknowledge the request and rely on frontend re-fetch.
    console.log(`[DeleteChat] Simulating deletion of private chat ${chatId} for user ${userId} (forMe).`);
    res.status(200).json({ message: 'تم حذف المحادثة من عندك فقط (محاكاة). لاحظ أن البيانات ستبقى على الخادم حتى يحذفها الطرف الآخر.' });
});

// Delete private chat for both users
app.delete('/api/chats/private/:chatId/for-both', (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body; // Assuming callerUid is needed for permission checks
    console.log(`[DeleteChat] Private chat ${chatId} for both, caller: ${callerUid}.`);

    const chatIndex = chats.findIndex(c => c.id === chatId && c.type === 'private');
    if (chatIndex === -1) {
        console.log(`[DeleteChat] Private chat ${chatId} not found.`);
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
    }

    const chat = chats[chatIndex];
    if (!chat.members.includes(callerUid)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المحادثة.' });
    }

    // Remove chat from chats array
    chats.splice(chatIndex, 1);
    
    // Remove all messages associated with this chat
    const initialMessageCount = messages.length;
    messages = messages.filter(msg => msg.chatId !== chatId);
    const deletedMessageCount = initialMessageCount - messages.length;

    console.log(`[DeleteChat] Deleted private chat ${chatId} and ${deletedMessageCount} messages for both users.`);
    res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
});

// Leave group chat
app.delete('/api/group/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body; // The user who is leaving
    console.log(`[LeaveGroup] User ${memberUid} leaving group ${groupId}.`);

    const groupIndex = chats.findIndex(c => c.id === groupId && c.type === 'group');
    if (groupIndex === -1) {
        console.log(`[LeaveGroup] Group ${groupId} not found.`);
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const group = chats[groupIndex];

    if (!group.members.includes(memberUid)) {
        return res.status(400).json({ error: 'العضو ليس جزءًا من هذه المجموعة.' });
    }

    // Remove member from the group's lists
    group.members = group.members.filter(uid => uid !== memberUid);
    delete group.memberRoles[memberUid];
    console.log(`[LeaveGroup] User ${memberUid} removed from group ${groupId}. Remaining members: ${group.members.length}`);

    // Check if the group should be deleted (no members or no admins left)
    const hasAdmins = Object.values(group.memberRoles).some(role => role === 'admin');
    if (group.members.length === 0 || !hasAdmins) {
        chats.splice(groupIndex, 1); // Delete the group
        messages = messages.filter(msg => msg.chatId !== groupId); // Delete associated messages
        console.log(`[LeaveGroup] Group ${groupId} deleted because no members or no admins left.`);
        return res.status(200).json({ message: 'لقد غادرت المجموعة وتم حذفها لعدم وجود أعضاء أو مشرفين.' });
    }

    res.status(200).json({ message: 'لقد غادرت المجموعة بنجاح.' });
});

// Delete group chat (admin action)
app.delete('/api/group/:groupId/delete', (req, res) => {
    const { groupId } = req.params;
    const { callerUid } = req.body; // Admin who is deleting the group
    console.log(`[DeleteGroup] Admin ${callerUid} attempting to delete group ${groupId}.`);

    const groupIndex = chats.findIndex(c => c.id === groupId && c.type === 'group');
    if (groupIndex === -1) {
        console.log(`[DeleteGroup] Group ${groupId} not found.`);
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const group = chats[groupIndex];

    // Only allow actual admin of the group to delete it
    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        console.log(`[DeleteGroup] Caller ${callerUid} is not an admin for group ${groupId}.`);
        return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذه المجموعة.' });
    }

    // Remove group from chats array
    chats.splice(groupIndex, 1);
    
    // Remove all messages associated with this group
    const initialMessageCount = messages.length;
    messages = messages.filter(msg => msg.chatId !== groupId);
    const deletedMessageCount = initialMessageCount - messages.length;

    console.log(`[DeleteGroup] Group ${groupId} and ${deletedMessageCount} messages deleted by admin ${callerUid}.`);
    res.status(200).json({ message: 'تم حذف المجموعة بالكامل بنجاح.' });
});


// 16. Get Group Members (and their roles)
app.get('/api/group/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    console.log(`[GetGroupMembers] Group: ${groupId}`);
    const group = chats.find(c => c.id === groupId && c.type === 'group');

    if (!group) {
        console.log(`[GetGroupMembers] Group not found: ${groupId}`);
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
    console.log(`[GetGroupMembers] Returning ${membersInfo.length} members for group ${groupId}.`);
    res.status(200).json(membersInfo);
});

// 17. Change Group Member Role (Admin only)
app.put('/api/group/:groupId/members/:memberId/role', (req, res) => {
    const { groupId, memberId } = req.params;
    const { newRole, callerUid } = req.body;
    console.log(`[ChangeMemberRole] Group: ${groupId}, Member: ${memberId}, New Role: ${newRole}, Caller: ${callerUid}`);

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير أدوار الأعضاء.' });
    }

    if (!group.members.includes(memberId)) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    const memberUser = users.find(u => u.uid === memberId);
    if (!memberUser) {
        console.log(`[ChangeMemberRole] Member user data not found for UID: ${memberId}`);
        return res.status(404).json({ error: 'بيانات العضو غير موجودة.' });
    }

    // Prevent demoting the only admin if there's only one left
    const currentAdmins = Object.keys(group.memberRoles).filter(uid => group.memberRoles[uid] === 'admin');
    if (newRole === 'member' && currentAdmins.length === 1 && currentAdmins[0] === memberId) {
        return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
    }

    group.memberRoles[memberId] = newRole;
    console.log(`[ChangeMemberRole] Member ${memberId} role changed to ${newRole} in group ${groupId}.`);
    res.status(200).json({ message: `تم تغيير دور العضو إلى ${newRole === 'admin' ? 'مشرف' : 'عضو'}.` });
});

// 18. Remove Group Member (Admin only)
app.delete('/api/group/:groupId/members/:memberId', (req, res) => {
    const { groupId, memberId } = req.params;
    const { callerUid } = req.body;
    console.log(`[RemoveGroupMember] Group: ${groupId}, Member: ${memberId}, Caller: ${callerUid}`);

    const group = chats.find(c => c.id === groupId && c.type === 'group');
    if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة.' });
    }

    const callerRole = group.memberRoles[callerUid];
    if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لإزالة الأعضاء.' });
    }

    if (!group.members.includes(memberId)) {
        return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
    }

    // Prevent removing the only admin if there's only one left
    const currentAdmins = Object.keys(group.memberRoles).filter(uid => group.memberRoles[uid] === 'admin');
    if (currentAdmins.length === 1 && currentAdmins[0] === memberId) {
        return res.status(400).json({ error: 'لا يمكن إزالة المشرف الوحيد للمجموعة.' });
    }

    group.members = group.members.filter(uid => uid !== memberId);
    delete group.memberRoles[memberId];
    console.log(`[RemoveGroupMember] Member ${memberId} removed from group ${groupId}. Remaining members: ${group.members.length}`);

    const hasAdmins = Object.values(group.memberRoles).some(role => role === 'admin');
    if (group.members.length === 0 || !hasAdmins) {
        const chatIndex = chats.findIndex(c => c.id === groupId);
        if (chatIndex !== -1) {
            chats.splice(chatIndex, 1);
        }
        messages = messages.filter(msg => msg.chatId !== groupId);
        console.log(`[RemoveGroupMember] Group ${groupId} deleted due to no members or no admins.`);
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
    const postsWithFollowerCount = posts.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`[GetPosts] Returning ${postsWithFollowerCount.length} total posts.`);
    res.status(200).json(postsWithFollowerCount);
});

// Get posts from followed users
app.get('/api/posts/followed/:userId', (req, res) => {
    const { userId } = req.params;
    const user = users.find(u => u.uid === userId);
    if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }
    const followedPosts = posts.filter(p => user.following.includes(p.authorId));
    
    const followedPostsWithFollowerCount = followedPosts.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`[GetFollowedPosts] Returning ${followedPostsWithFollowerCount.length} posts for user ${userId}.`);
    res.status(200).json(followedPostsWithFollowerCount);
});

// Search posts
app.get('/api/posts/search', (req, res) => {
    const { q, filter, userId } = req.query;
    let filteredPosts = posts;

    if (filter === 'followed' && userId) {
        const user = users.find(u => u.uid === userId);
        if (user) {
            filteredPosts = filteredPosts.filter(p => user.following.includes(p.authorId));
        }
    }

    if (q) {
        filteredPosts = filteredPosts.filter(p => 
            p.text.toLowerCase().includes(q.toLowerCase()) || 
            p.authorName.toLowerCase().includes(q.toLowerCase())
        );
    }

    const searchResultsWithFollowerCount = filteredPosts.map(p => {
        const author = users.find(u => u.uid === p.authorId);
        return {
            ...p,
            followerCount: author ? author.followers.length : 0
        };
    });
    console.log(`[SearchPosts] Returning ${searchResultsWithFollowerCount.length} search results for query: '${q}' (filter: ${filter}).`);
    res.status(200).json(searchResultsWithFollowerCount);
});


// Create a new post
app.post('/api/posts', upload.single('mediaFile'), (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;
    console.log(`[CreatePost] Author: ${authorName}, Text length: ${text?.length || 0}, Media: ${mediaFile ? 'Yes' : 'No'}`);

    if (!authorId || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'معرف المؤلف والنص أو ملف الوسائط مطلوبان.' });
    }

    let mediaUrl = null;
    if (mediaFile) {
        // In a real app, you'd upload the file to cloud storage and get a real URL.
        if (mediaType === 'image') {
            mediaUrl = 'https://placehold.co/400x300/cccccc/000?text=Image+Post';
        } else if (mediaType === 'video') {
            mediaUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
        }
        console.log(`[CreatePost] Media file received, using placeholder URL: ${mediaUrl}`);
    }

    const newPost = {
        id: generateUniqueId(),
        authorId,
        authorName,
        text: text || '', // Ensure text is an empty string if undefined
        mediaType: mediaType || null,
        mediaUrl: mediaUrl,
        authorProfileBg: authorProfileBg || null,
        timestamp: Date.now(),
        likes: [],
        views: [],
        comments: []
    };
    posts.push(newPost);
    console.log(`[CreatePost] New post created: ${newPost.id}`);
    res.status(201).json({ message: 'تم إنشاء المنشور بنجاح.', postId: newPost.id });
});

// Delete a post
app.delete('/api/posts/:postId', (req, res) => {
    const { postId } = req.params;
    console.log(`[DeletePost] Attempt for post: ${postId}`);

    const postIndex = posts.findIndex(p => p.id === postId);
    if (postIndex === -1) {
        console.log(`[DeletePost] Post not found: ${postId}`);
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    posts.splice(postIndex, 1);
    console.log(`[DeletePost] Post ${postId} deleted.`);
    res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
});

// Toggle post like
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    console.log(`[ToggleLike] Post: ${postId}, User: ${userId}`);

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    const likeIndex = post.likes.indexOf(userId);
    let isLiked;
    if (likeIndex > -1) {
        post.likes.splice(likeIndex, 1);
        isLiked = false;
        console.log(`[ToggleLike] User ${userId} unliked post ${postId}.`);
    } else {
        post.likes.push(userId);
        isLiked = true;
        console.log(`[ToggleLike] User ${userId} liked post ${postId}.`);
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب.', isLiked, likesCount: post.likes.length });
});

// Increment post view count
app.post('/api/posts/:postId/view', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    console.log(`[IncrementView] Post: ${postId}, User: ${userId}`);

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    // Only add view if user hasn't viewed this post before
    if (userId && !post.views.includes(userId)) {
        post.views.push(userId);
        console.log(`[IncrementView] User ${userId} viewed post ${postId}. Total views: ${post.views.length}`);
    } else {
        console.log(`[IncrementView] User ${userId} already viewed post ${postId} or userId is missing.`);
    }
    res.status(200).json({ message: 'تم تحديث المشاهدات.', viewsCount: post.views.length });
});

// Get comments for a post
app.get('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    console.log(`[GetComments] Post: ${postId}`);
    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    res.status(200).json(post.comments);
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    console.log(`[AddComment] Post: ${postId}, User: ${username}, Text length: ${text?.length || 0}`);

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'معرف المستخدم واسم المستخدم والنص مطلوبان للتعليق.' });
    }

    const userCommenting = users.find(u => u.uid === userId);
    const commentProfileBg = userCommenting ? userCommenting.profileBg : null;

    const newComment = {
        id: generateUniqueId(),
        userId,
        user: username, // Use 'user' for consistency with frontend.
        text,
        userProfileBg: commentProfileBg,
        likes: [],
        timestamp: Date.now()
    };
    post.comments.push(newComment);
    console.log(`[AddComment] New comment added to post ${postId} by ${username}.`);
    res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', commentId: newComment.id });
});

// Toggle comment like
app.post('/api/posts/:postId/comments/:commentId/like', (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    console.log(`[ToggleCommentLike] Post: ${postId}, Comment: ${commentId}, User: ${userId}`);

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) {
        return res.status(404).json({ error: 'التعليق غير موجود.' });
    }

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
    }

    const likeIndex = comment.likes.indexOf(userId);
    let isLiked;
    if (likeIndex > -1) {
        comment.likes.splice(likeIndex, 1);
        isLiked = false;
        console.log(`[ToggleCommentLike] User ${userId} unliked comment ${commentId}.`);
    } else {
        comment.likes.push(userId);
        isLiked = true;
        console.log(`[ToggleCommentLike] User ${userId} liked comment ${commentId}.`);
    }
    res.status(200).json({ message: 'تم تحديث الإعجاب بالتعليق.', isLiked, likesCount: comment.likes.length });
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access backend at: http://localhost:${PORT}`);
});
