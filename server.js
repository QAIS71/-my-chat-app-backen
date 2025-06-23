// server.js
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const { NFTStorage, File } = require('nft.storage');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto'); // For AES encryption/decryption (optional)
const fs = require('fs'); // To read and delete temporary files

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const nftStorageClient = new NFTStorage({ token: process.env.NFT_STORAGE_API_KEY });

const upload = multer({ dest: 'uploads/' });

// Ensure 'uploads' directory exists
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Basic Route
app.get('/', (req, res) => {
    res.send('Backend is running!');
});

// User Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        let customId;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            customId = Math.floor(10000000 + Math.random() * 90000000).toString();
            const idCheck = await pool.query('SELECT * FROM users WHERE custom_id = $1', [customId]);
            if (idCheck.rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
        if (!isUnique) {
            return res.status(500).json({ error: 'Failed to generate a unique custom ID.' });
        }

        const newUser = await pool.query(
            'INSERT INTO users (username, password, custom_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING uid, username, custom_id',
            [username, password, customId]
        );
        res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error during registration.' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const user = userResult.rows[0];
        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        res.status(200).json({
            message: 'Login successful',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_background_url
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error during login.' });
    }
});

// Upload Profile Background
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    const { userId } = req.body;
    if (!userId) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'User ID is required.' });
    }

    const filePath = req.file.path;
    const fileName = `${userId}_profile_bg_${Date.now()}`;
    const mimeType = req.file.mimetype;

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
        
        const ipfsGatewayUrl = `https://ipfs.io/ipfs/${cid}`;

        await pool.query(
            'UPDATE users SET profile_background_url = $1 WHERE uid = $2',
            [ipfsGatewayUrl, userId]
        );

        fs.unlinkSync(filePath);

        res.status(200).json({ message: 'Profile background uploaded and updated successfully!', url: ipfsGatewayUrl });
    } catch (error) {
        console.error('Error uploading profile background:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'Failed to upload profile background: ' + error.message });
    }
});

// Get User Profile Background URL
app.get('/api/user/:uid/profile-background', async (req, res) => {
    const { uid } = req.params;
    try {
        const userResult = await pool.query('SELECT profile_background_url FROM users WHERE uid = $1', [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.status(200).json({ url: userResult.rows[0].profile_background_url });
    } catch (err) {
        console.error('Error fetching profile background URL:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Get User Info by Custom ID
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const userResult = await pool.query('SELECT uid, username, custom_id, profile_background_url FROM users WHERE custom_id = $1', [customId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const user = userResult.rows[0];
        res.status(200).json({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_background_url
        });
    } catch (err) {
        console.error('Error fetching user by custom ID:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Get User Info by UID
app.get('/api/user/:uid', async (req, res) => {
    const { uid } = req.params;
    try {
        const userResult = await pool.query('SELECT uid, username, custom_id, profile_background_url FROM users WHERE uid = $1', [uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const user = userResult.rows[0];
        res.status(200).json({
            uid: user.uid,
            username: user.username,
            customId: user.custom_id,
            profileBg: user.profile_background_url
        });
    } catch (err) {
        console.error('Error fetching user by UID:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Get All Posts
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
        res.json(result.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('Error fetching posts:', err);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

// Get Followed Posts
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const followingResult = await pool.query('SELECT following_uid FROM followers WHERE follower_uid = $1', [userId]);
        const followedUids = followingResult.rows.map(row => row.following_uid);
        followedUids.push(userId); // Include current user's posts

        if (followedUids.length === 0) {
            return res.json([]);
        }

        const postsResult = await pool.query(
            'SELECT * FROM posts WHERE author_id = ANY($1::text[]) ORDER BY created_at DESC',
            [followedUids]
        );
        res.json(postsResult.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('Error fetching followed posts:', err);
        res.status(500).json({ error: 'Failed to fetch followed posts' });
    }
});

// Search Posts
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    let queryText = 'SELECT * FROM posts WHERE (post_text ILIKE $1 OR author_name ILIKE $1)';
    const queryParams = [`%${q}%`];
    let postRows;

    try {
        if (filter === 'followed' && userId) {
            const followingResult = await pool.query('SELECT following_uid FROM followers WHERE follower_uid = $1', [userId]);
            const followedUids = followingResult.rows.map(row => row.following_uid);
            followedUids.push(userId);
            
            if (followedUids.length === 0) {
                return res.json([]);
            }
            queryText += ' AND author_id = ANY($2::text[])';
            queryParams.push(followedUids);
            postRows = await pool.query(queryText + ' ORDER BY created_at DESC', queryParams);

        } else {
            postRows = await pool.query(queryText + ' ORDER BY created_at DESC', queryParams);
        }

        res.json(postRows.rows.map(post => ({
            id: post.post_id,
            authorId: post.author_id,
            authorName: post.author_name,
            text: post.post_text,
            mediaType: post.media_type,
            mediaUrl: post.media_url,
            timestamp: new Date(post.created_at).getTime(),
            likes: post.likes || [],
            comments: post.comments || [],
            views: post.views || [],
            followerCount: post.follower_count || 0,
            authorProfileBg: post.author_profile_bg || null
        })));
    } catch (err) {
        console.error('Error searching posts:', err);
        res.status(500).json({ error: 'Failed to search posts' });
    }
});

// Create New Post
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    let mediaUrl = null;
    const filePath = req.file ? req.file.path : null;

    try {
        if (filePath) {
            const fileName = `${req.file.originalname}_${Date.now()}`;
            const mimeType = req.file.mimetype;

            const fileBuffer = fs.readFileSync(filePath);
            const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
            mediaUrl = `https://ipfs.io/ipfs/${cid}`;
            fs.unlinkSync(filePath);
        }

        const followerCountResult = await pool.query('SELECT COUNT(*) FROM followers WHERE following_uid = $1', [authorId]);
        const followerCount = parseInt(followerCountResult.rows[0].count) || 0;

        const newPost = await pool.query(
            `INSERT INTO posts (author_id, author_name, post_text, media_type, media_url, likes, comments, views, follower_count, author_profile_bg, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING post_id`,
            [authorId, authorName, text, mediaType || null, mediaUrl, [], [], [], followerCount, authorProfileBg]
        );
        res.status(201).json({ message: 'Post published successfully!', postId: newPost.rows[0].post_id });
    } catch (err) {
        console.error('Error publishing post:', err);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'Failed to publish post: ' + err.message });
    }
});

// Delete Post
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        const deleteResult = await pool.query('DELETE FROM posts WHERE post_id = $1 RETURNING post_id', [postId]);
        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        res.status(200).json({ message: 'Post deleted successfully.' });
    } catch (err) {
        console.error('Error deleting post:', err);
        res.status(500).json({ error: 'Failed to delete post.' });
    }
});

// Toggle Post Like
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    try {
        const postResult = await pool.query('SELECT likes FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        let likes = postResult.rows[0].likes || [];

        const index = likes.indexOf(userId);
        let isLiked;

        if (index > -1) {
            likes.splice(index, 1);
            isLiked = false;
        } else {
            likes.push(userId);
            isLiked = true;
        }

        await pool.query('UPDATE posts SET likes = $1 WHERE post_id = $2', [likes, postId]);
        res.status(200).json({ message: 'Like status updated', isLiked, likesCount: likes.length });
    } catch (err) {
        console.error('Error toggling like:', err);
        res.status(500).json({ error: 'Failed to toggle like.' });
    }
});

// Record Post View
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    try {
        const postResult = await pool.query('SELECT views FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        let views = postResult.rows[0].views || [];

        if (!views.includes(userId)) {
            views.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE post_id = $2', [views, postId]);
        }
        res.status(200).json({ message: 'View recorded.' });
    } catch (err) {
        console.error('Error recording view:', err);
        res.status(500).json({ error: 'Failed to record view.' });
    }
});

// Get Post Comments
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE post_id = $1', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        res.status(200).json(postResult.rows[0].comments || []);
    } catch (err) {
        console.error('Error fetching comments:', err);
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

// Add Post Comment
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    try {
        const postResult = await pool.query('SELECT comments FROM posts WHERE post_id = $1 FOR UPDATE', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        let comments = postResult.rows[0].comments || [];

        const newComment = {
            user: username,
            text: text,
            timestamp: Date.now()
        };
        comments.push(newComment);

        await pool.query('UPDATE posts SET comments = $1 WHERE post_id = $2', [comments, postId]);
        res.status(201).json({ message: 'Comment added successfully!', comment: newComment });
    } catch (err) {
        console.error('Error adding comment:', err);
        res.status(500).json({ error: 'Failed to add comment.' });
    }
});

// Toggle Follow User
app.post('/api/user/:followerUid/follow/:followingUid', async (req, res) => {
    const { followerUid, followingUid } = req.params;
    if (followerUid === followingUid) {
        return res.status(400).json({ error: 'Cannot follow self.' });
    }
    try {
        const checkFollow = await pool.query(
            'SELECT * FROM followers WHERE follower_uid = $1 AND following_uid = $2',
            [followerUid, followingUid]
        );

        let isFollowing;
        let message;

        if (checkFollow.rows.length > 0) {
            await pool.query(
                'DELETE FROM followers WHERE follower_uid = $1 AND following_uid = $2',
                [followerUid, followingUid]
            );
            isFollowing = false;
            message = 'Unfollowed successfully.';
        } else {
            await pool.query(
                'INSERT INTO followers (follower_uid, following_uid) VALUES ($1, $2)',
                [followerUid, followingUid]
            );
            isFollowing = true;
            message = 'Followed successfully.';
        }
        res.status(200).json({ message, isFollowing });
    } catch (err) {
        console.error('Error toggling follow:', err);
        res.status(500).json({ error: 'Failed to toggle follow.' });
    }
});

// Check Follow Status
app.get('/api/user/:followerUid/following/:followingUid', async (req, res) => {
    const { followerUid, followingUid } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM followers WHERE follower_uid = $1 AND following_uid = $2',
            [followerUid, followingUid]
        );
        res.status(200).json({ isFollowing: result.rows.length > 0 });
    } catch (err) {
        console.error('Error checking follow status:', err);
        res.status(500).json({ error: 'Failed to check follow status.' });
    }
});

// Get Follower Count
app.get('/api/user/:uid/followers/count', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE following_uid = $1', [uid]);
        res.status(200).json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Error fetching follower count:', err);
        res.status(500).json({ error: 'Failed to fetch follower count.' });
    }
});

// Get User Contacts
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT contact_uid, contact_name, contact_custom_id, contact_username FROM user_contacts WHERE user_uid = $1', [userId]);
        res.json(result.rows.map(row => ({
            uid: row.contact_uid,
            username: row.contact_name, // Use contact_name as display name
            customId: row.contact_custom_id,
            actualUsername: row.contact_username // Actual username
        })));
    } catch (err) {
        console.error('Error fetching user contacts:', err);
        res.status(500).json({ error: 'Failed to fetch user contacts.' });
    }
});

// Create Private Chat
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    const chatMembers = [user1Id, user2Id].sort();
    const chatId = chatMembers.join('_');

    try {
        const existingChat = await pool.query('SELECT * FROM chats WHERE chat_id = $1', [chatId]);
        if (existingChat.rows.length > 0) {
            return res.status(200).json({ message: 'Chat already exists.', chatId });
        }

        await pool.query(
            `INSERT INTO chats (chat_id, member1_uid, member2_uid, last_message, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [chatId, chatMembers[0], chatMembers[1], 'No messages yet']
        );

        await pool.query(
            'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [user1Id, chatId, 'private', contactName, user2CustomId, 'No messages yet']
        );
        await pool.query(
            'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [user2Id, chatId, 'private', user1Name, user1CustomId, 'No messages yet']
        );

        await pool.query(
            `INSERT INTO user_contacts (user_uid, contact_uid, contact_name, contact_custom_id, contact_username)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_uid, contact_uid) DO UPDATE SET contact_name = EXCLUDED.contact_name`,
            [user1Id, user2Id, contactName, user2CustomId, user2Name]
        );

        res.status(201).json({ message: 'Private chat created successfully!', chatId });
    } catch (err) {
        console.error('Error creating private chat:', err);
        res.status(500).json({ error: 'Failed to create private chat.' });
    }
});

// Get User Chats (Private and Group)
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    try {
        const chats = [];

        const privateChatsResult = await pool.query(
            `SELECT
                uc.chat_id,
                uc.chat_type,
                uc.chat_name,
                uc.custom_id,
                uc.last_message,
                uc.updated_at,
                c.member1_uid,
                c.member2_uid
            FROM user_chats uc
            JOIN chats c ON uc.chat_id = c.chat_id
            WHERE uc.user_uid = $1 AND uc.chat_type = 'private'
            ORDER BY uc.updated_at DESC`,
            [userId]
        );

        for (const row of privateChatsResult.rows) {
            const otherUid = row.member1_uid === userId ? row.member2_uid : row.member1_uid;
            const otherUserResult = await pool.query('SELECT profile_background_url FROM users WHERE uid = $1', [otherUid]);
            const profileBg = otherUserResult.rows.length > 0 ? otherUserResult.rows[0].profile_background_url : null;
            chats.push({
                id: row.chat_id,
                type: row.chat_type,
                name: row.chat_name,
                customId: row.custom_id,
                lastMessage: row.last_message,
                timestamp: new Date(row.updated_at).getTime(),
                profileBg: profileBg
            });
        }

        const groupChatsResult = await pool.query(
            `SELECT
                uc.chat_id,
                uc.chat_type,
                uc.chat_name,
                uc.last_message,
                uc.updated_at,
                g.name as group_name
            FROM user_chats uc
            JOIN groups g ON uc.chat_id = g.group_id
            WHERE uc.user_uid = $1 AND uc.chat_type = 'group'
            ORDER BY uc.updated_at DESC`,
            [userId]
        );

        for (const row of groupChatsResult.rows) {
            chats.push({
                id: row.chat_id,
                type: row.chat_type,
                name: row.group_name,
                customId: null,
                lastMessage: row.last_message,
                timestamp: new Date(row.updated_at).getTime(),
                profileBg: null
            });
        }

        chats.sort((a, b) => b.timestamp - a.timestamp);

        res.json(chats);
    } catch (err) {
        console.error('Error fetching user chats:', err);
        res.status(500).json({ error: 'Failed to fetch user chats.' });
    }
});

// Get Messages for a Chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = req.query.since ? new Date(parseInt(req.query.since)) : new Date(0);

    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 AND created_at > $2 ORDER BY created_at ASC',
            [chatId, sinceTimestamp]
        );
        res.json(result.rows.map(msg => ({
            id: msg.message_id,
            senderId: msg.sender_id,
            senderName: msg.sender_name,
            text: msg.message_text,
            mediaType: msg.media_type,
            mediaUrl: msg.media_url,
            timestamp: new Date(msg.created_at).getTime(),
            senderProfileBg: msg.sender_profile_bg
        })));
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

// Send Message in a Chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    let mediaUrl = null;
    const filePath = req.file ? req.file.path : null;

    try {
        if (filePath) {
            const fileName = `${req.file.originalname}_${Date.now()}`;
            const mimeType = req.file.mimetype;

            const fileBuffer = fs.readFileSync(filePath);
            const cid = await nftStorageClient.storeBlob(new File([fileBuffer], fileName, { type: mimeType }));
            mediaUrl = `https://ipfs.io/ipfs/${cid}`;
            fs.unlinkSync(filePath);
        }

        const newMessageResult = await pool.query(
            `INSERT INTO messages (chat_id, sender_id, sender_name, message_text, media_type, media_url, sender_profile_bg, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING message_id`,
            [chatId, senderId, senderName, text, mediaType || null, mediaUrl, senderProfileBg || null]
        );

        const isGroupChat = (await pool.query('SELECT * FROM groups WHERE group_id = $1', [chatId])).rows.length > 0;
        const chatTableName = isGroupChat ? 'groups' : 'chats';
        const chatPkColumn = isGroupChat ? 'group_id' : 'chat_id';

        await pool.query(
            `UPDATE ${chatTableName} SET last_message = $1, updated_at = NOW() WHERE ${chatPkColumn} = $2`,
            [text || (mediaType === 'image' ? 'New Image' : 'New Video'), chatId]
        );

        if (isGroupChat) {
            const groupMembersResult = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1', [chatId]);
            const members = groupMembersResult.rows.map(row => row.member_uid);
            for (const memberUid of members) {
                await pool.query(
                    'UPDATE user_chats SET last_message = $1, updated_at = NOW() WHERE user_uid = $2 AND chat_id = $3',
                    [text || (mediaType === 'image' ? 'New Image' : 'New Video'), memberUid, chatId]
                );
            }
        } else {
            const chatMembersResult = await pool.query('SELECT member1_uid, member2_uid FROM chats WHERE chat_id = $1', [chatId]);
            const members = [chatMembersResult.rows[0].member1_uid, chatMembersResult.rows[0].member2_uid];
            for (const memberUid of members) {
                await pool.query(
                    'UPDATE user_chats SET last_message = $1, updated_at = NOW() WHERE user_uid = $2 AND chat_id = $3',
                    [text || (mediaType === 'image' ? 'New Image' : 'New Video'), memberUid, chatId]
                );
            }
        }

        res.status(201).json({ message: 'Message sent successfully!', messageId: newMessageResult.rows[0].message_id });
    } catch (err) {
        console.error('Error sending message:', err);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'Failed to send message: ' + err.message });
    }
});

// Delete Chat (Private or Group)
app.post('/api/chats/delete', async (req, res) => {
    const { chatId, chatType, action, userId } = req.body;

    try {
        if (chatType === 'private') {
            if (action === 'forMe') {
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);
                res.status(200).json({ message: 'Chat deleted for you only.' });
            } else if (action === 'forBoth') {
                const chatMembersResult = await pool.query('SELECT member1_uid, member2_uid FROM chats WHERE chat_id = $1', [chatId]);
                if (chatMembersResult.rows.length === 0) {
                    return res.status(404).json({ error: 'Private chat not found.' });
                }
                const { member1_uid, member2_uid } = chatMembersResult.rows[0];

                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [member1_uid, chatId]);
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [member2_uid, chatId]);

                await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                await pool.query('DELETE FROM chats WHERE chat_id = $1', [chatId]);

                await pool.query('DELETE FROM user_contacts WHERE user_uid = $1 AND contact_uid = $2', [member1_uid, member2_uid]);
                await pool.query('DELETE FROM user_contacts WHERE user_uid = $1 AND contact_uid = $2', [member2_uid, member1_uid]);

                res.status(200).json({ message: 'Chat deleted for both participants.' });
            }
        } else if (chatType === 'group') {
            const groupRef = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [chatId]);
            if (groupRef.rows.length === 0) {
                return res.status(404).json({ error: 'Group chat not found.' });
            }
            const groupAdminId = groupRef.rows[0].admin_uid;

            if (action === 'forMe') {
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);
                res.status(200).json({ message: 'Group chat removed from your list.' });
            } else if (action === 'leaveGroup') {
                await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_uid = $2', [chatId, userId]);
                await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [userId, chatId]);

                const remainingMembers = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [chatId]);
                if (parseInt(remainingMembers.rows[0].count) === 0) {
                    await pool.query('DELETE FROM groups WHERE group_id = $1', [chatId]);
                    await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                    res.status(200).json({ message: 'You left the group. Group deleted as no members remained.' });
                } else {
                    const remainingAdmins = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1 AND role = \'admin\'', [chatId]);
                    if (remainingAdmins.rows.length === 0 && userId === groupAdminId) {
                        const firstRemainingMember = await pool.query('SELECT member_uid FROM group_members WHERE group_id = $1 ORDER BY joined_at ASC LIMIT 1', [chatId]);
                        if (firstRemainingMember.rows.length > 0) {
                            await pool.query('UPDATE group_members SET role = \'admin\' WHERE group_id = $1 AND member_uid = $2', [chatId, firstRemainingMember.rows[0].member_uid]);
                            console.log(`Group ${chatId}: New admin assigned to ${firstRemainingMember.rows[0].member_uid}`);
                        }
                    }
                    res.status(200).json({ message: 'You left the group.' });
                }
            }
        }
    } catch (err) {
        console.error('Error deleting chat:', err);
        res.status(500).json({ error: 'Failed to delete chat: ' + err.message });
    }
});

// Create Group
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;
    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'Group name, admin, and at least 2 members are required.' });
    }

    try {
        const newGroupResult = await pool.query(
            `INSERT INTO groups (name, description, admin_uid, last_message, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING group_id`,
            [name, description, adminId, 'Group created']
        );
        const groupId = newGroupResult.rows[0].group_id;

        const memberInsertPromises = [];
        for (const memberUid in members) {
            memberInsertPromises.push(
                pool.query('INSERT INTO group_members (group_id, member_uid, role, joined_at) VALUES ($1, $2, $3, NOW())',
                [groupId, memberUid, members[memberUid]])
            );
            const memberUserResult = await pool.query('SELECT username, custom_id FROM users WHERE uid = $1', [memberUid]);
            const memberUsername = memberUserResult.rows[0]?.username || 'Unknown user';
            const memberCustomId = memberUserResult.rows[0]?.custom_id || 'N/A';

            memberInsertPromises.push(
                pool.query(
                    'INSERT INTO user_chats (user_uid, chat_id, chat_type, chat_name, custom_id, last_message, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
                    [memberUid, groupId, 'group', name, null, 'Group created']
                )
            );
        }
        await Promise.all(memberInsertPromises);

        res.status(201).json({ message: 'Group created successfully!', groupId });
    } catch (err) {
        console.error('Error creating group:', err);
        res.status(500).json({ error: 'Failed to create group: ' + err.message });
    }
});

// Get Group Members
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const membersResult = await pool.query(
            `SELECT gm.member_uid, gm.role, u.username, u.custom_id, u.profile_background_url
            FROM group_members gm
            JOIN users u ON gm.member_uid = u.uid
            WHERE gm.group_id = $1 ORDER BY gm.joined_at ASC`,
            [groupId]
        );
        res.status(200).json(membersResult.rows.map(row => ({
            uid: row.member_uid,
            username: row.username,
            customId: row.custom_id,
            role: row.role,
            profileBg: row.profile_background_url
        })));
    } catch (err) {
        console.error('Error fetching group members:', err);
        res.status(500).json({ error: 'Failed to fetch group members.' });
    }
});

// Get Group Member Count
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [groupId]);
        res.status(200).json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Error fetching group member count:', err);
        res.status(500).json({ error: 'Failed to fetch group member count.' });
    }
});

// Change Member Role
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;
    
    try {
        const callerRoleResult = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, callerUid]);
        if (callerRoleResult.rows.length === 0 || callerRoleResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: You must be an admin to change member roles.' });
        }

        if (newRole === 'member') {
            const groupInfoResult = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [groupId]);
            const groupAdminId = groupInfoResult.rows[0]?.admin_uid;

            const currentAdminsCountResult = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = \'admin\'', [groupId]);
            const currentAdminsCount = parseInt(currentAdminsCountResult.rows[0].count);

            if (currentAdminsCount === 1 && memberUid === groupAdminId) {
                return res.status(400).json({ error: 'Cannot demote the sole admin (group creator).' });
            }
        }

        await pool.query(
            'UPDATE group_members SET role = $1 WHERE group_id = $2 AND member_uid = $3',
            [newRole, groupId, memberUid]
        );
        res.status(200).json({ message: `Member role updated to ${newRole}.` });
    } catch (err) {
        console.error('Error changing member role:', err);
        res.status(500).json({ error: 'Failed to change member role.' });
    }
});

// Remove Group Member
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    try {
        const callerRoleResult = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, callerUid]);
        if (callerRoleResult.rows.length === 0 || callerRoleResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: You must be an admin to remove members.' });
        }

        if (memberUid === callerUid) {
            return res.status(400).json({ error: 'You cannot remove yourself this way. Please use the leave group option.' });
        }

        const groupInfoResult = await pool.query('SELECT admin_uid FROM groups WHERE group_id = $1', [groupId]);
        const groupAdminId = groupInfoResult.rows[0]?.admin_uid;

        if (memberUid === groupAdminId) {
            const currentAdminsCountResult = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = \'admin\'', [groupId]);
            const currentAdminsCount = parseInt(currentAdminsCountResult.rows[0].count);
            if (currentAdminsCount === 1) {
                return res.status(400).json({ error: 'Cannot remove the sole admin (group creator).' });
            }
        }
        
        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_uid = $2', [groupId, memberUid]);
        await pool.query('DELETE FROM user_chats WHERE user_uid = $1 AND chat_id = $2', [memberUid, groupId]);

        const remainingMembers = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [groupId]);
        if (parseInt(remainingMembers.rows[0].count) === 0) {
            await pool.query('DELETE FROM groups WHERE group_id = $1', [groupId]);
            await pool.query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
            res.status(200).json({ message: 'Member removed. Group deleted as no members remained.' });
        } else {
            res.status(200).json({ message: 'Member removed successfully.' });
        }

    } catch (err) {
        console.error('Error removing member:', err);
        res.status(500).json({ error: 'Failed to remove member: ' + err.message });
    }
});


// Start Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Access it locally via: http://localhost:${port}`);
});
