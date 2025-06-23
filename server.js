// Load environment variables from .env file
require('dotenv').config();

// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL client for database interaction
const bcrypt = require('bcryptjs'); // For password hashing
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const multer = require('multer'); // For handling file uploads
const path = require('path'); // For path manipulation
const fs = require('fs'); // For file system operations

const app = express();
const PORT = process.env.PORT || 3000; // Use port from environment variable or default to 3000

// --- Configure PostgreSQL/Supabase Database Connection ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for some cloud providers like Render/Supabase
    }
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        // Log the full error stack for debugging connection issues
        console.error('Error acquiring client to PostgreSQL database:', err.stack);
        // Optionally, exit the process if DB connection is critical for startup
        // process.exit(1); 
    } else {
        console.log('Successfully connected to PostgreSQL database!');
        release(); // Release the client back to the pool
    }
});

// --- CORS Configuration ---
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- Middleware ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Multer for File Uploads ---
// Ensure 'uploads' directory exists for local testing
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${uuidv4()}-${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// Serve static files from the 'uploads' directory (for local testing of media files)
app.use('/uploads', express.static(uploadsDir));


// --- Helper Functions (for clarity and reusability) ---

// Function to generate a unique 8-digit custom ID
async function generateCustomId() {
    let customId;
    let isUnique = false;
    while (!isUnique) {
        customId = Math.floor(10000000 + Math.random() * 90000000).toString();
        const result = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [customId]);
        if (result.rows.length === 0) {
            isUnique = true;
        }
    }
    return customId;
}

// --- API Routes ---

// 1. User Authentication and Management
// Register a new user
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const userExists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (userExists.rows.length > 0) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const uid = uuidv4();
        const customId = await generateCustomId();

        const newUser = await pool.query(
            'INSERT INTO users (uid, username, password, custom_id) VALUES ($1, $2, $3, $4) RETURNING uid, username, custom_id',
            [uid, username, hashedPassword, customId]
        );
        res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal server error during registration' });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Login successful',
            user: {
                uid: user.uid,
                username: user.username,
                customId: user.custom_id,
                profileBg: user.profile_bg_url
            }
        });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

// Get user by custom ID (for initiating private chats)
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE custom_id = $1', [customId]);
        if (result.rows.length > 0) {
            res.status(200).json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('Error fetching user by custom ID:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upload profile background
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    const supabaseStorageBaseUrl = process.env.SUPABASE_STORAGE_URL;
    if (!supabaseStorageBaseUrl) {
        console.error("SUPABASE_STORAGE_URL is not set in environment variables.");
        return res.status(500).json({ error: 'Server misconfiguration: Storage URL missing.' });
    }
    const fileUrl = `${supabaseStorageBaseUrl}/public/avatars/${req.file.filename}`;

    try {
        await pool.query(
            'UPDATE users SET profile_bg_url = $1 WHERE uid = $2',
            [fileUrl, userId]
        );
        res.status(200).json({ message: 'Profile background updated', url: fileUrl });
    } catch (error) {
        console.error('Error uploading profile background:', error);
        res.status(500).json({ error: 'Internal server error during upload' });
    }
});

// Get user profile background URL
app.get('/api/user/:uid/profile-background', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [uid]);
        if (result.rows.length > 0) {
            res.status(200).json({ url: result.rows[0].profile_bg_url });
        } else {
            res.status(404).json({ error: 'User not found or no profile background' });
        }
    } catch (error) {
        console.error('Error fetching profile background:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get contacts (currently all users for selection in new chats/groups)
app.get('/api/user/:uid/contacts', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url FROM users WHERE uid != $1', [uid]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// 2. Following System
// Toggle follow/unfollow
app.post('/api/user/:followerId/follow/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    if (!followerId || !followedId) {
        return res.status(400).json({ error: 'Follower ID and Followed ID are required.' });
    }
    if (followerId === followedId) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    try {
        const usersExistResult = await pool.query('SELECT uid FROM users WHERE uid = $1 OR uid = $2', [followerId, followedId]);
        if (usersExistResult.rows.length < 2) {
            return res.status(404).json({ error: 'One or both users not found.' });
        }

        const existingFollow = await pool.query(
            'SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2',
            [followerId, followedId]
        );

        if (existingFollow.rows.length > 0) {
            // Unfollow
            await pool.query(
                'DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2',
                [followerId, followedId]
            );
            res.status(200).json({ message: 'Unfollowed successfully', isFollowing: false });
        } else {
            // Follow
            await pool.query(
                'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)',
                [followerId, followedId]
            );
            res.status(200).json({ message: 'Followed successfully', isFollowing: true });
        }
    } catch (error) {
        console.error('Error toggling follow status:', error);
        res.status(500).json({ error: 'Internal server error during follow operation' });
    }
});

// Check if a user is following another
app.get('/api/user/:followerId/following/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    try {
        const result = await pool.query(
            'SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2',
            [followerId, followedId]
        );
        res.status(200).json({ isFollowing: result.rows.length > 0 });
    } catch (error) {
        console.error('Error checking follow status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get follower count for a user
app.get('/api/user/:uid/followers/count', async (req, res) => {
    const { uid } = req.params;
    if (!uid) {
        return res.status(400).json({ error: 'User ID is required.' });
    }
    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM follows WHERE followed_id = $1',
            [uid]
        );
        res.status(200).json({ count: parseInt(result.rows[0].count, 10) });
    } catch (error) {
        console.error('Error fetching follower count:', error);
        res.status(500).json({ error: 'Internal server error during follower count fetch' });
    }
});


// 3. Post Management (World/Feed)
// Create a new post
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    let mediaUrl = null;

    if (!authorId || !authorName || (!text && !req.file)) {
        return res.status(400).json({ error: 'Post must have text or media, and author info' });
    }

    if (req.file) {
        const supabaseStorageBaseUrl = process.env.SUPABASE_STORAGE_URL;
        if (!supabaseStorageBaseUrl) {
            console.error("SUPABASE_STORAGE_URL is not set in environment variables.");
            return res.status(500).json({ error: 'Server misconfiguration: Storage URL missing.' });
        }
        mediaUrl = `${supabaseStorageBaseUrl}/public/posts/${req.file.filename}`;
    }

    try {
        const newPost = await pool.query(
            `INSERT INTO posts (id, author_id, author_name, text_content, media_type, media_url, timestamp, author_profile_bg_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [uuidv4(), authorId, authorName, text, mediaType || (req.file ? (req.file.mimetype.startsWith('image/') ? 'image' : 'video') : 'text'), mediaUrl, Date.now(), authorProfileBg]
        );
        res.status(201).json({ message: 'Post published successfully', post: newPost.rows[0] });
    } catch (error) {
        console.error('Error publishing post:', error);
        res.status(500).json({ error: 'Internal server error during post creation' });
    }
});

// Helper function to construct the common post SELECT clause
// This ensures consistent column naming (camelCase) and data formatting for frontend
function getPostSelectClause() {
    return `
        p.id,
        p.author_id AS "authorId",
        p.author_name AS "authorName",
        p.text_content AS text,
        p.media_type AS "mediaType",
        p.media_url AS "mediaUrl",
        p.timestamp,
        p.author_profile_bg_url AS "authorProfileBg",
        COALESCE(json_agg(l.user_id) FILTER (WHERE l.user_id IS NOT NULL), '[]'::json) AS likes,
        COALESCE(json_agg(DISTINCT v.user_id) FILTER (WHERE v.user_id IS NOT NULL), '[]'::json) AS views,
        COALESCE(json_agg(jsonb_build_object('user', c.username, 'text', c.comment_text, 'timestamp', c.timestamp)) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS comments,
        (SELECT COUNT(*) FROM follows WHERE followed_id = p.author_id) AS "followerCount"
    `;
}

// Get all posts
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ${getPostSelectClause()}
            FROM posts p
            LEFT JOIN post_likes l ON p.id = l.post_id
            LEFT JOIN post_views v ON p.id = v.post_id
            LEFT JOIN post_comments c ON p.id = c.post_id
            GROUP BY p.id
            ORDER BY p.timestamp DESC;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching all posts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get followed posts
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required to fetch followed posts.' });
    }
    try {
        const result = await pool.query(
            `SELECT ${getPostSelectClause()}
            FROM posts p
            JOIN follows f ON p.author_id = f.followed_id
            LEFT JOIN post_likes l ON p.id = l.post_id
            LEFT JOIN post_views v ON p.id = v.post_id
            LEFT JOIN post_comments c ON p.id = c.post_id
            WHERE f.follower_id = $1
            GROUP BY p.id
            ORDER BY p.timestamp DESC;`,
            [userId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching followed posts:', error);
        res.status(500).json({ error: 'Internal server error fetching followed posts' });
    }
});


// Search posts
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    const searchTerm = `%${q}%`;
    let queryText = `
        SELECT ${getPostSelectClause()}
        FROM posts p
        LEFT JOIN post_likes l ON p.id = l.post_id
        LEFT JOIN post_views v ON p.id = v.post_id
        LEFT JOIN post_comments c ON p.id = c.post_id
    `;
    const queryParams = [];

    let whereClauseParts = [];
    if (q) {
        whereClauseParts.push(`(p.text_content ILIKE $${queryParams.length + 1} OR p.author_name ILIKE $${queryParams.length + 1})`);
        queryParams.push(searchTerm);
    }
    
    if (filter === 'followed' && userId) {
        queryText += ` JOIN follows f ON p.author_id = f.followed_id `;
        whereClauseParts.push(`f.follower_id = $${queryParams.length + 1}`);
        queryParams.push(userId);
    }

    if (whereClauseParts.length > 0) {
        queryText += ` WHERE ` + whereClauseParts.join(' AND ');
    }

    queryText += `
        GROUP BY p.id
        ORDER BY p.timestamp DESC;
    `;

    try {
        const result = await pool.query(queryText, queryParams);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Toggle like on a post
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const existingLike = await pool.query(
            'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2',
            [postId, userId]
        );

        let isLiked;
        if (existingLike.rows.length > 0) {
            // Unlike
            await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            isLiked = false;
        } else {
            // Like
            await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            isLiked = true;
        }

        const likesCountResult = await pool.query('SELECT COUNT(*) FROM post_likes WHERE post_id = $1', [postId]);
        const likesCount = parseInt(likesCountResult.rows[0].count, 10);

        res.status(200).json({ message: 'Like toggled', isLiked, likesCount });
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Increment post view count
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const existingView = await pool.query(
            'SELECT 1 FROM post_views WHERE post_id = $1 AND user_id = $2',
            [postId, userId]
        );

        if (existingView.rows.length === 0) {
            await pool.query(
                'INSERT INTO post_views (post_id, user_id, timestamp) VALUES ($1, $2, $3)',
                [postId, userId, Date.now()]
            );
        }
        res.status(200).json({ message: 'View recorded' });
    } catch (error) {
        console.error('Error recording view:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    if (!userId || !username || !text) {
        return res.status(400).json({ error: 'User ID, username, and comment text are required' });
    }

    try {
        await pool.query(
            'INSERT INTO post_comments (id, post_id, user_id, username, comment_text, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
            [uuidv4(), postId, userId, username, text, Date.now()]
        );
        res.status(201).json({ message: 'Comment added successfully' });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get comments for a post
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    try {
        const result = await pool.query(
            'SELECT user_id, username AS user, comment_text AS text, timestamp FROM post_comments WHERE post_id = $1 ORDER BY timestamp ASC',
            [postId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a post
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        await pool.query('DELETE FROM post_likes WHERE post_id = $1', [postId]);
        await pool.query('DELETE FROM post_comments WHERE post_id = $1', [postId]);
        await pool.query('DELETE FROM post_views WHERE post_id = $1', [postId]);

        const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [postId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.status(200).json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. Chat Management
// Get user's chat list (private and group chats)
app.get('/api/user/:uid/chats', async (req, res) => {
    const { uid } = req.params;
    if (!uid) {
        return res.status(400).json({ error: 'User ID is required.' });
    }
    try {
        const privateChatsResult = await pool.query(
            `SELECT
                pc.id,
                'private' AS type,
                CASE
                    WHEN pc.user1_id = $1 THEN u2.username
                    ELSE u1.username
                END AS name,
                CASE
                    WHEN pc.user1_id = $1 THEN u2.custom_id
                    ELSE u1.custom_id
                END AS custom_id,
                CASE
                    WHEN pc.user1_id = $1 THEN u2.profile_bg_url
                    ELSE u1.profile_bg_url
                END AS "profileBg",
                COALESCE((SELECT message_text FROM messages WHERE chat_id = pc.id ORDER BY timestamp DESC LIMIT 1), 'لا توجد رسائل بعد.') AS "lastMessage",
                COALESCE((SELECT timestamp FROM messages WHERE chat_id = pc.id ORDER BY timestamp DESC LIMIT 1), 0) AS timestamp
            FROM private_chats pc
            JOIN users u1 ON pc.user1_id = u1.uid
            JOIN users u2 ON pc.user2_id = u2.uid
            WHERE pc.user1_id = $1 OR pc.user2_id = $1;
            `, [uid]
        );

        const groupChatsResult = await pool.query(
            `SELECT
                gc.id,
                'group' AS type,
                gc.name,
                NULL AS custom_id,
                NULL AS "profileBg",
                COALESCE((SELECT message_text FROM messages WHERE chat_id = gc.id ORDER BY timestamp DESC LIMIT 1), 'لا توجد رسائل بعد.') AS "lastMessage",
                COALESCE((SELECT timestamp FROM messages WHERE chat_id = gc.id ORDER BY timestamp DESC LIMIT 1), 0) AS timestamp
            FROM group_chats gc
            JOIN group_members gm ON gc.id = gm.group_id
            WHERE gm.member_id = $1;
            `, [uid]
        );

        const allChats = [...privateChatsResult.rows, ...groupChatsResult.rows];
        allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); 

        res.status(200).json(allChats);
    } catch (error) {
        console.error('Error fetching chat list:', error);
        res.status(500).json({ error: 'Internal server error during chat list fetch' });
    }
});


// Create or get a private chat
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'Missing required chat parameters' });
    }

    try {
        const [id1, id2] = [user1Id, user2Id].sort();

        const existingChat = await pool.query(
            'SELECT id FROM private_chats WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [id1, id2]
        );

        let chatId;
        if (existingChat.rows.length > 0) {
            chatId = existingChat.rows[0].id;
            res.status(200).json({ message: 'Chat already exists', chatId });
        } else {
            chatId = uuidv4();
            await pool.query(
                `INSERT INTO private_chats (id, user1_id, user2_id, user1_name, user2_name, user1_custom_id, user2_custom_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [chatId, id1, id2, user1Name, user2Name, user1CustomId, user2CustomId]
            );
            res.status(201).json({ message: 'Private chat created successfully', chatId });
        }
    } catch (error) {
        console.error('Error creating/getting private chat:', error);
        res.status(500).json({ error: 'Internal server error during private chat creation' });
    }
});


// Get messages for a chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const { since } = req.query;

    try {
        let queryText = 'SELECT id, chat_id, sender_id AS "senderId", sender_name AS "senderName", message_text AS "messageText", media_type AS "mediaType", media_url AS "mediaUrl", timestamp, sender_profile_bg_url AS "senderProfileBg" FROM messages WHERE chat_id = $1';
        const queryParams = [chatId];

        if (since && !isNaN(since) && parseInt(since, 10) > 0) {
            queryText += ' AND timestamp > $2';
            queryParams.push(parseInt(since, 10));
        }

        queryText += ' ORDER BY timestamp ASC';

        const result = await pool.query(queryText, queryParams);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Internal server error during message fetch' });
    }
});

// Send a message in a chat
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    let mediaUrl = null;

    if (!senderId || !senderName || !chatId || (!text && !req.file)) {
        return res.status(400).json({ error: 'Missing required message parameters' });
    }

    if (req.file) {
        const supabaseStorageBaseUrl = process.env.SUPABASE_STORAGE_URL;
        if (!supabaseStorageBaseUrl) {
            console.error("SUPABASE_STORAGE_URL is not set in environment variables.");
            return res.status(500).json({ error: 'Server misconfiguration: Storage URL missing.' });
        }
        mediaUrl = `${supabaseStorageBaseUrl}/public/messages/${req.file.filename}`;
    }

    try {
        const newMessage = await pool.query(
            `INSERT INTO messages (id, chat_id, sender_id, sender_name, message_text, media_type, media_url, timestamp, sender_profile_bg_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [uuidv4(), chatId, senderId, senderName, text, mediaType || (req.file ? (req.file.mimetype.startsWith('image/') ? 'image' : 'video') : 'text'), mediaUrl, Date.now(), senderProfileBg]
        );
        res.status(201).json({ message: 'Message sent successfully', messageData: newMessage.rows[0] });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Internal server error during message send' });
    }
});


// Delete chat (for user only, or for both, or leave group)
app.post('/api/chats/delete', async (req, res) => {
    const { chatId, chatType, action, userId } = req.body;

    if (!chatId || !chatType || !action || !userId) {
        return res.status(400).json({ error: 'Missing required parameters for chat deletion' });
    }

    try {
        if (chatType === 'private') {
            if (action === 'forMe') {
                res.status(200).json({ message: 'Chat messages hidden for you.' });
            } else if (action === 'forBoth') {
                await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                await pool.query('DELETE FROM private_chats WHERE id = $1', [chatId]);
                res.status(200).json({ message: 'Chat deleted for both parties.' });
            } else {
                return res.status(400).json({ error: 'Invalid action for private chat' });
            }
        } else if (chatType === 'group') {
            if (action === 'leaveGroup') {
                await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_id = $2', [chatId, userId]);
                
                const remainingMembers = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [chatId]);
                if (parseInt(remainingMembers.rows[0].count, 10) === 0) {
                    await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                    await pool.query('DELETE FROM group_chats WHERE id = $1', [chatId]);
                }
                res.status(200).json({ message: 'You have left the group.' });
            } else if (action === 'forMe') {
                res.status(200).json({ message: 'Group hidden from your chat list.' });
            } else {
                return res.status(400).json({ error: 'Invalid action for group chat' });
            }
        } else {
            return res.status(400).json({ error: 'Invalid chat type' });
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        res.status(500).json({ error: 'Internal server error during chat deletion' });
    }
});


// 5. Group Chat Specific Routes
// Create a new group
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members } = req.body;

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'Group name, admin, and at least two members are required' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
         return res.status(400).json({ error: 'Admin must be one of the members and have admin role.' });
    }

    try {
        const groupId = uuidv4();
        await pool.query(
            'INSERT INTO group_chats (id, name, description, admin_id, created_at) VALUES ($1, $2, $3, $4, $5)',
            [groupId, name, description, adminId, Date.now()]
        );

        const memberInserts = Object.keys(members).map(memberId =>
            pool.query('INSERT INTO group_members (group_id, member_id, role) VALUES ($1, $2, $3)',
                       [groupId, memberId, members[memberId]])
        );
        await Promise.all(memberInserts);

        res.status(201).json({ message: 'Group created successfully', groupId });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Internal server error during group creation' });
    }
});

// Get group members
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query(
            `SELECT gm.member_id AS uid, u.username, u.custom_id, gm.role
             FROM group_members gm
             JOIN users u ON gm.member_id = u.uid
             WHERE gm.group_id = $1
             ORDER BY gm.role DESC, u.username ASC;`,
            [groupId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching group members:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get group member count
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
            [groupId]
        );
        res.status(200).json({ count: parseInt(result.rows[0].count, 10) });
    } catch (error) {
        console.error('Error fetching group member count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Change a member's role (admin/member)
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;

    if (!newRole || !callerUid) {
        return res.status(400).json({ error: 'New role and caller UID are required' });
    }

    try {
        const callerRoleResult = await pool.query(
            'SELECT role FROM group_members WHERE group_id = $1 AND member_id = $2',
            [groupId, callerUid]
        );
        const callerRole = callerRoleResult.rows[0]?.role;

        if (callerRole !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized: Only group admins can change roles' });
        }

        if (newRole === 'member') {
            const adminCountResult = await pool.query(
                'SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = $2',
                [groupId, 'admin']
            );
            if (parseInt(adminCountResult.rows[0].count, 10) === 1 && memberUid === callerUid) {
                 return res.status(400).json({ error: 'Cannot demote the only admin of the group' });
            }
        }

        await pool.query(
            'UPDATE group_members SET role = $1 WHERE group_id = $2 AND member_id = $3',
            [newRole, groupId, memberUid]
        );
        res.status(200).json({ message: `Member role updated to ${newRole}` });
    } catch (error) {
        console.error('Error changing member role:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove a member from the group
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;

    if (!callerUid) {
        return res.status(400).json({ error: 'Caller UID is required' });
    }

    try {
        const callerRoleResult = await pool.query(
            'SELECT role FROM group_members WHERE group_id = $1 AND member_id = $2',
            [groupId, callerUid]
        );
        const callerRole = callerRoleResult.rows[0]?.role;

        if (callerRole !== 'admin' && callerUid !== memberUid) {
            return res.status(403).json({ error: 'Unauthorized: Only group admins can remove members' });
        }

        const currentMemberRoleResult = await pool.query(
            'SELECT role FROM group_members WHERE group_id = $1 AND member_id = $2',
            [groupId, memberUid]
        );
        const currentMemberRole = currentMemberRoleResult.rows[0]?.role;

        if (currentMemberRole === 'admin') {
            const adminCountResult = await pool.query(
                'SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = $2',
                [groupId, 'admin']
            );
            if (parseInt(adminCountResult.rows[0].count, 10) === 1) {
                const totalMembersResult = await pool.query(
                    'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
                    [groupId]
                );
                if (parseInt(totalMembersResult.rows[0].count, 10) > 1) {
                    return res.status(400).json({ error: 'Cannot remove the only admin if other members exist. Assign a new admin first.' });
                }
            }
        }

        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND member_id = $2', [groupId, memberUid]);
        res.status(200).json({ message: 'Member removed successfully' });
    } catch (error) {
        console.error('Error removing member:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
