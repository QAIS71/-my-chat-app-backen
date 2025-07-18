// Required libraries
const express = require('express'); // Express framework for creating the server
const bodyParser = require('body-parser'); // For parsing HTTP request bodies
const cors = require('cors'); // For handling Cross-Origin Resource Sharing policies
const multer = require('multer'); // For handling file uploads (images, videos, voice messages)
const { v4: uuidv4 } = require('uuid'); // For generating Universally Unique Identifiers (UUIDs)
const { Pool } = require('pg'); // For PostgreSQL
const fetch = require('node-fetch'); // For using fetch in Node.js to connect to Gemini API
const { createClient } = require('@supabase/supabase-js'); // For Supabase Client

// Initialize Express application
const app = express();
const port = process.env.PORT || 3000; // Use environment-defined port (e.g., Render) or default to 3000

// ----------------------------------------------------------------------------------------------------
// Multer setup for in-memory storage (for file uploads)
// THIS IS THE CRITICAL LINE FOR THE 'upload is not defined' ERROR
// ----------------------------------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

// ----------------------------------------------------------------------------------------------------
// Supabase Project Configurations - Update this object with your project information
// You can add up to 8 projects here or more as needed
// ----------------------------------------------------------------------------------------------------
const SUPABASE_PROJECT_CONFIGS = {
    'kdbtusugpqboxsaosaci': { // Project Ref as Project ID
        databaseUrl: "postgresql://postgres.kdbtusugpqboxsaosaci:Feaw%2BJu%25RWp4*Hq@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://kdbtusugpqboxsaosaci.supabase.co",
        // Note: Anon Key is used here. It is recommended to use Service Role Key in production for enhanced security and permissions.
        // You can find the Service Role Key in your Supabase project settings -> API Settings.
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYnR1c3VncHFib3hzYW9zYWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI4NTQ1NTQsImV4cCI6MjA2ODQzMDU1NH0.humKsBKLNpu3DNGwTGgEWXH7uLu0D0azUsG0q2BYOuA"
    },
    'ojuatwnwnvnzfyhicokc': { // Project Ref as Project ID
        databaseUrl: "postgresql://postgres.ojuatwnwnvnzfyhicokc:w%26qGbv4!gLVG%26Cg@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://ojuatwnwnvnzfyhicokc.supabase.co",
        // Note: Anon Key is used here. It is recommended to use Service Role Key in production for enhanced security and permissions.
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdWF0d253bnZuemZ5aGljb2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI4NTYyMTQsImV4cCI6MjA2ODQzMjIxNH0.pc1F1DzQJkqwYm4uiB6g1LCL2zsUR8L26OfQQoXWjLo"
    },
    'fznbkubzddthnboehmvq': { // Project Ref as Project ID
        databaseUrl: "postgresql://postgres.fznbkubzddthnboehmvq:j%23ZM%24q%40WjH%40dtU6@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://fznbkubzddthnboehmvq.supabase.co",
        // Note: Anon Key is used here. It is recommended to use Service Role Key in production for enhanced security and permissions.
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6bmJrdWJ6ZGR0aG5ib2VobXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI4NTcxNjAsImV4cCI6MjA2ODQzMzE2MH0.TXPBZZE2fMFCNgHVibQqVILFSndSp4sT_T2U6u_w6j8"
    },
    'woxzcoerelijbsrbdnbk': { // Project Ref as Project ID
        databaseUrl: "postgresql://postgres.woxzcoerelijbsrbdnbk:n%247j9tuvhRtQ!8y@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://woxzcoerelijbsrbdnbk.supabase.co",
        // Note: Anon Key is used here. It is recommended to use Service Role Key in production for enhanced security and permissions.
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndveHpjb2VyZWxpamJzcmJkbmJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI4NTc0MTgsImV4cCI6MjA2ODQzMzQxOH0.tX6VqEdqvpQATY29KoNKmm7DLOxBY0RqJTYbAqeK3rs"
    },
    // To add additional projects (up to 8 or more), add them here in the same format:
    // 'new_project_id_5': {
    //     databaseUrl: "postgresql://postgres.new_ref_5:[YOUR_PASSWORD_5]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
    //     projectUrl: "https://new_ref_5.supabase.co",
    //     serviceRoleKey: "your_service_role_key_5"
    // },
};

// Objects to store database connection pools and Supabase clients for each project
const projectDbPools = {};
const projectSupabaseClients = {};

// ----------------------------------------------------------------------------------------------------
// Initialize PostgreSQL Pool and Supabase Client for each project
// ----------------------------------------------------------------------------------------------------
async function initializeSupabaseClients() {
    for (const projectId in SUPABASE_PROJECT_CONFIGS) {
        const config = SUPABASE_PROJECT_CONFIGS[projectId];
        try {
            // Initialize PostgreSQL Pool
            projectDbPools[projectId] = new Pool({
                connectionString: config.databaseUrl,
                ssl: {
                    rejectUnauthorized: false // Required for Render PostgreSQL (if you don't have a trusted SSL certificate)
                }
            });
            await projectDbPools[projectId].connect(); // Test connection
            console.log(`PostgreSQL Pool initialized for project: ${projectId}`);

            // Initialize Supabase Client (for Storage and Auth from backend)
            projectSupabaseClients[projectId] = createClient(
                config.projectUrl,
                config.serviceRoleKey,
                {
                    auth: {
                        persistSession: false, // No need for persistent sessions in the backend
                        autoRefreshToken: false,
                        detectSessionInUrl: false
                    }
                }
            );
            console.log(`Supabase Client initialized for project: ${projectId}`);

            // Create tables for this project
            await createTables(projectDbPools[projectId]);

        } catch (error) {
            console.error(`ERROR: Failed to initialize Supabase or PostgreSQL for project ${projectId}:`, error);
            // You can choose to stop the server here if the project is essential for operation
            // process.exit(1);
        }
    }
}

// ----------------------------------------------------------------------------------------------------
// Admin Settings - **IMPORTANT: Change these values in production or use environment variables**
// ----------------------------------------------------------------------------------------------------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin_watsaligram"; // Admin username
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin_password123"; // Admin password

// ----------------------------------------------------------------------------------------------------
// Gemini API Key - **IMPORTANT: This should be set as an environment variable in Render**
// ----------------------------------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // Set this in Render environment variables

// Function to create tables if they don't exist (takes Pool as argument)
async function createTables(pool) {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url VARCHAR(255),
                is_verified BOOLEAN DEFAULT FALSE,
                user_role VARCHAR(50) DEFAULT 'normal'
            );

            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(255) PRIMARY KEY,
                author_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                author_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                author_profile_bg VARCHAR(255),
                likes JSONB DEFAULT '[]'::jsonb,
                views JSONB DEFAULT '[]'::jsonb,
                is_pinned BOOLEAN DEFAULT FALSE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id VARCHAR(255) PRIMARY KEY,
                post_id VARCHAR(255) REFERENCES posts(id) ON DELETE CASCADE,
                user_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                text TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                user_profile_bg VARCHAR(255),
                likes JSONB DEFAULT '[]'::jsonb
            );

            CREATE TABLE IF NOT EXISTS chats (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                name VARCHAR(255),
                description TEXT,
                admin_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                participants JSONB NOT NULL,
                member_roles JSONB,
                last_message TEXT,
                timestamp BIGINT NOT NULL,
                profile_bg_url VARCHAR(255),
                contact_names JSONB,
                send_permission VARCHAR(50) DEFAULT 'all'
            );

            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                chat_id VARCHAR(255) REFERENCES chats(id) ON DELETE CASCADE,
                sender_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                sender_profile_bg VARCHAR(255)
            );

            CREATE TABLE IF NOT EXISTS followers (
                follower_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                followed_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                PRIMARY KEY (follower_id, followed_id)
            );

            CREATE TABLE IF NOT EXISTS video_playback_progress (
                user_id VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
                post_id VARCHAR(255) REFERENCES posts(id) ON DELETE CASCADE,
                position_seconds REAL NOT NULL,
                last_updated BIGINT NOT NULL,
                PRIMARY KEY (user_id, post_id)
            );
        `);
        console.log('Tables created successfully (if not already existing).');

        // Check for admin account, create if not exists
        const adminCheck = await pool.query('SELECT uid FROM users WHERE username = $1 AND user_role = $2', [ADMIN_USERNAME, 'admin']);
        if (adminCheck.rows.length === 0) {
            const adminUid = uuidv4();
            const adminCustomId = await generateCustomId(pool); // Pass pool
            await pool.query(
                'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role) VALUES ($1, $2, $3, $4, $5, $6)',
                [adminUid, ADMIN_USERNAME, ADMIN_PASSWORD, adminCustomId, true, 'admin']
            );
            console.log('Admin account created:', ADMIN_USERNAME, 'UID:', adminUid, 'Custom ID:', adminCustomId);
        } else {
            console.log('Admin account already exists.');
        }

        // Ensure "Help" (Bot) chat exists
        const botChatCheck = await pool.query('SELECT id FROM chats WHERE type = $1 AND name = $2', ['private', 'المساعدة']);
        if (botChatCheck.rows.length === 0) {
            const botUid = uuidv4(); // Unique ID for the bot
            const botCustomId = 'BOT00001'; // Custom ID for the bot
            const botUsername = 'المساعدة';

            // Create bot account in users table
            await pool.query(
                'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role) VALUES ($1, $2, $3, $4, $5, $6)',
                [botUid, botUsername, uuidv4(), botCustomId, true, 'bot'] // Bot is verified and has 'bot' role
            );

            const botChatId = uuidv4();
            const timestamp = Date.now();
            const participantsArray = [botUid]; // Bot is the only participant in this chat from DB side
            const contactNamesObject = { [botUid]: 'المساعدة' }; // Contact name for the bot itself

            await pool.query(
                `INSERT INTO chats (id, type, name, admin_id, participants, member_roles, last_message, timestamp, profile_bg_url, contact_names, send_permission)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [botChatId, 'private', 'المساعدة', null, JSON.stringify(participantsArray), JSON.stringify({}), null, timestamp, null, JSON.stringify(contactNamesObject), 'all']
            );
            console.log('Chat "المساعدة" (Bot) created with UID:', botUid, 'Chat ID:', botChatId);
        } else {
            console.log('Chat "المساعدة" (Bot) already exists.');
        }

    } catch (err) {
        console.error('ERROR: Failed to create tables or initial data:', err);
    }
}

// ----------------------------------------------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------------------------------------------

// Enable CORS for all requests (Netlify Proxy will handle the rest)
app.use(cors());

// Parse JSON in HTTP requests
app.use(bodyParser.json());

// Middleware to check project ID and provide Pool and Supabase Client
app.use('/api/:projectId/*', (req, res, next) => {
    const { projectId } = req.params;
    if (!projectDbPools[projectId] || !projectSupabaseClients[projectId]) {
        return res.status(400).json({ error: 'Invalid or uninitialized project ID.' });
    }
    req.dbPool = projectDbPools[projectId];
    req.supabase = projectSupabaseClients[projectId];
    req.currentProjectId = projectId; // To pass project ID to functions
    next();
});

// ----------------------------------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------------------------------

// Function to generate a unique 8-digit custom user ID (takes Pool as argument)
async function generateCustomId(pool) {
    let id;
    let userExists = true;
    while (userExists) {
        id = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 digits
        const res = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [id]);
        userExists = res.rows.length > 0;
    }
    return id;
}

// Helper function to fetch posts with details (takes Pool as argument)
async function getPostsWithDetails(pool, baseQuery, initialQueryParams, userIdForPlayback = null) {
    let selectClause = `
        p.*,
        u.username AS authorName,
        u.is_verified AS authorIsVerified,
        u.user_role AS authorUserRole,
        u.profile_bg_url AS authorProfileBg,
        (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes, 'isVerified', cu.is_verified))
         FROM comments c JOIN users cu ON c.user_id = cu.uid WHERE c.post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM followers WHERE followed_id = p.author_id) AS authorFollowersCount
    `;

    let joinClause = `JOIN users u ON p.author_id = u.uid`;
    let finalQueryParams = [...initialQueryParams]; // Copy initial parameters
    let paramIndex = initialQueryParams.length + 1; // Start parameter index after initial parameters

    // If userIdForPlayback is provided, join to fetch saved playback position
    if (userIdForPlayback) {
        selectClause += `, COALESCE(vpp.position_seconds, 0) AS playbackPosition`;
        joinClause += ` LEFT JOIN video_playback_progress vpp ON p.id = vpp.post_id AND vpp.user_id = $${paramIndex++}`;
        finalQueryParams.push(userIdForPlayback); // Add userIdForPlayback as a parameter
    }

    const fullQuery = `
        SELECT ${selectClause}
        FROM posts p
        ${joinClause}
        ${baseQuery}
        ORDER BY p.is_pinned DESC, p.timestamp DESC
    `;

    const result = await pool.query(fullQuery, finalQueryParams); // Use finalQueryParams here

    return result.rows.map(row => ({
        id: row.id,
        authorId: row.author_id,
        authorName: row.authorname,
        text: row.text,
        timestamp: parseInt(row.timestamp),
        likes: row.likes,
        comments: row.comments || [],
        views: row.views,
        mediaUrl: row.media_url,
        mediaType: row.media_type,
        authorProfileBg: row.author_profile_bg,
        authorFollowersCount: parseInt(row.authorfollowerscount),
        playbackPosition: row.playbackposition || 0,
        isPinned: row.is_pinned,
        authorIsVerified: row.authorisverified,
        authorUserRole: row.authoruserrole
    }));
}


// ----------------------------------------------------------------------------------------------------
// API Endpoints - Modified to work with PostgreSQL and multiple Supabase projects
// ----------------------------------------------------------------------------------------------------

// User registration endpoint
app.post('/api/:projectId/register', async (req, res) => {
    const { username, password } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const existingUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const uid = uuidv4(); // Generate a unique user ID
        const customId = await generateCustomId(pool); // Generate an 8-digit custom ID

        // Determine if the registered user is the default admin
        const userRole = (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) ? 'admin' : 'normal';
        const isVerified = (userRole === 'admin'); // Admin is automatically verified

        await pool.query(
            'INSERT INTO users (uid, username, password, custom_id, profile_bg_url, is_verified, user_role) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [uid, username, password, customId, null, isVerified, userRole]
        );

        console.log('User registered:', username, 'UID:', uid, 'Custom ID:', customId, 'Role:', userRole);
        res.status(201).json({ message: 'Registration successful.', user: { uid, username, customId, profileBg: null, isVerified, userRole } });
    } catch (error) {
        console.error('ERROR: Failed to register user:', error);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

// User login endpoint
app.post('/api/:projectId/login', async (req, res) => {
    const { username, password } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url, password, is_verified, user_role FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || user.password !== password) { // In a real application, check hashed password
            return res.status(401).json({ error: 'Incorrect username or password.' });
        }

        console.log('User logged in:', user.username, 'Role:', user.user_role);
        res.status(200).json({ message: 'Login successful.', user: { uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url, isVerified: user.is_verified, userRole: user.user_role } });
    } catch (error) {
        console.error('ERROR: Failed to log in user:', error);
        res.status(500).json({ error: 'Login failed.' });
    }
});

// Endpoint to get user info by customId
app.get('/api/:projectId/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role FROM users WHERE custom_id = $1', [customId]);
        const user = result.rows[0];
        if (user) {
            res.status(200).json({ uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url, isVerified: user.is_verified, userRole: user.user_role });
        } else {
            res.status(404).json({ error: 'User not found.' });
        }
    } catch (error) {
        console.error('ERROR: Failed to get user by custom ID:', error);
        res.status(500).json({ error: 'Failed to fetch user information.' });
    }
});

// Endpoint to verify user account (Admin only)
app.put('/api/:projectId/admin/verify-user/:customId', async (req, res) => {
    const { customId } = req.params; // Target user
    const { isVerified, callerUid } = req.body; // New verification status and admin's UID making the request
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        // Check if the requesting user is an admin
        const adminUser = await pool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (!adminUser.rows[0] || adminUser.rows[0].user_role !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to verify users.' });
        }

        // Update verification status for the target user
        const targetUserUpdate = await pool.query(
            'UPDATE users SET is_verified = $1 WHERE custom_id = $2 RETURNING username, custom_id',
            [isVerified, customId]
        );

        if (targetUserUpdate.rows.length === 0) {
            return res.status(404).json({ error: 'Target user not found.' });
        }

        const updatedUser = targetUserUpdate.rows[0];
        res.status(200).json({ message: `User ${updatedUser.username} (${updatedUser.custom_id}) ${isVerified ? 'verified' : 'unverified'} successfully.`, user: updatedUser });
    } catch (error) {
        console.error('ERROR: Failed to verify user:', error);
        res.status(500).json({ error: 'Verification process failed.' });
    }
});

// Endpoint to upload profile background
app.post('/api/:projectId/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const uploadedFile = req.file;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'profile_backgrounds'; // Dedicated bucket name for profile backgrounds in Supabase Storage

    if (!userId || !uploadedFile) {
        return res.status(400).json({ error: 'User ID and file are required.' });
    }

    try {
        const userResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const fileExtension = uploadedFile.originalname.split('.').pop();
        const fileName = `${uuidv4()}.${fileExtension}`;
        const filePath = `${userId}/${fileName}`; // Storage path in the bucket (e.g., userId/fileName.jpg)

        // Upload file to Supabase Storage
        const { data, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, uploadedFile.buffer, {
                contentType: uploadedFile.mimetype,
                upsert: false // Do not update if file already exists
            });

        if (uploadError) {
            console.error('ERROR: Failed to upload file to Supabase Storage:', uploadError);
            return res.status(500).json({ error: 'Failed to upload file to storage.' });
        }

        // Get the public URL for the file
        const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error('ERROR: Failed to get public URL for uploaded file.');
            return res.status(500).json({ error: 'Failed to get public file URL.' });
        }

        const mediaUrl = publicUrlData.publicUrl;

        await pool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [mediaUrl, userId]);

        console.log(`Profile background uploaded for user ${userId}: ${mediaUrl}`);
        res.status(200).json({ message: 'Background uploaded successfully.', url: mediaUrl });
    } catch (error) {
        console.error('ERROR: Failed to upload profile background or update DB:', error);
        res.status(500).json({ error: 'Failed to upload background.' });
    }
});

// Endpoint to get follower count for a specific user
app.get('/api/:projectId/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [userId]);
        const followerCount = parseInt(result.rows[0].count);
        res.status(200).json({ count: followerCount });
    } catch (error) {
        console.error('ERROR: Failed to get follower count:', error);
        res.status(500).json({ error: 'Failed to fetch follower count.' });
    }
});

// Endpoint to get following status between users
app.get('/api/:projectId/user/:followerId/following/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
        const isFollowing = result.rows.length > 0;
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error('ERROR: Failed to get following status:', error);
        res.status(500).json({ error: 'Failed to fetch following status.' });
    }
});

// Endpoint for follow/unfollow
app.post('/api/:projectId/user/:followerId/follow/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (followerId === followedId) {
        return res.status(400).json({ error: 'You cannot follow yourself.' });
    }

    try {
        const followerUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followerId]);
        const followedUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followedId]);

        if (followerUserResult.rows.length === 0 || followedUserResult.rows.length === 0) {
            return res.status(404).json({ error: 'User (follower or followed) not found.' });
        }

        const existingFollow = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);

        let message;
        let isFollowing;
        if (existingFollow.rows.length > 0) {
            // Unfollow
            await pool.query('DELETE FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
            message = 'Unfollowed successfully.';
            isFollowing = false;
        } else {
            // Follow
            await pool.query('INSERT INTO followers (follower_id, followed_id) VALUES ($1, $2)', [followerId, followedId]);
            message = 'Followed successfully.';
            isFollowing = true;
        }
        console.log(`User ${followerId} ${message} user ${followedId}`);
        res.status(200).json({ message, isFollowing });
    } catch (error) {
        console.error('ERROR: Failed to follow/unfollow user:', error);
        res.status(500).json({ error: 'Follow/unfollow operation failed.' });
    }
});

// Endpoint to get contacts (users with whom the current user has private chats)
app.get('/api/:projectId/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query(`
            SELECT DISTINCT u.uid, u.username, u.custom_id, u.profile_bg_url, u.is_verified, u.user_role
            FROM users u
            JOIN chats c ON (
                (c.type = 'private' AND c.participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND c.participants @> to_jsonb(ARRAY[u.uid]::VARCHAR[]) AND u.uid != $1)
            )
        `, [userId]);

        const userContacts = result.rows.map(row => ({
            uid: row.uid,
            username: row.username,
            customId: row.custom_id,
            profileBg: row.profile_bg_url,
            isVerified: row.is_verified,
            userRole: row.user_role
        }));

        res.status(200).json(userContacts);
    } catch (error) {
        console.error('ERROR: Failed to get user contacts:', error);
        res.status(500).json({ error: 'Failed to fetch contacts.' });
    }
});

// Endpoint to publish a new post
app.post('/api/:projectId/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'post_media'; // Dedicated bucket name for post media

    let postMediaUrl = null;
    let postMediaType = mediaType || 'text';

    if (!authorId || !authorName || (!text && !mediaFile)) {
        return res.status(400).json({ error: 'ID, name, and text or media file are required.' });
    }

    try {
        if (mediaFile) {
            const fileExtension = mediaFile.originalname.split('.').pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const filePath = `${authorId}/${fileName}`; // Storage path in the bucket

            // Upload file to Supabase Storage
            const { data, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, mediaFile.buffer, {
                    contentType: mediaFile.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error('ERROR: Failed to upload file to Supabase Storage:', uploadError);
                return res.status(500).json({ error: 'Failed to upload file to storage.' });
            }

            // Get the public URL for the file
            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);

            if (!publicUrlData || !publicUrlData.publicUrl) {
                console.error('ERROR: Failed to get public URL for uploaded file.');
                return res.status(500).json({ error: 'Failed to get public file URL.' });
            }

            postMediaUrl = publicUrlData.publicUrl;
            console.log(`Media file uploaded for post: ${postMediaUrl}`);

            if (!mediaType || mediaType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    postMediaType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    postMediaType = 'video';
                }
            }
        }

        const postId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO posts (id, author_id, author_name, text, timestamp, media_url, media_type, author_profile_bg, likes, views, is_pinned)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [postId, authorId, authorName, text || '', timestamp, postMediaUrl, postMediaType, authorProfileBg || null, '[]', '[]', false]
        );

        const newPost = {
            id: postId,
            authorId,
            authorName,
            text: text || '',
            timestamp,
            likes: [],
            comments: [], // Comments are not saved here, but in the comments table
            views: [],
            mediaUrl: postMediaUrl,
            mediaType: postMediaType,
            authorProfileBg: authorProfileBg || null,
            isPinned: false
        };
        console.log('New post published:', newPost);
        res.status(201).json({ message: 'Post published successfully.', post: newPost });
    } catch (error) {
        console.error('ERROR: Failed to publish post:', error);
        res.status(500).json({ error: 'Failed to publish post.' });
    }
});

// Endpoint to get all posts
app.get('/api/:projectId/posts', async (req, res) => {
    const { userId } = req.query; // Optional userId for playback position
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const postsWithDetails = await getPostsWithDetails(pool, '', [], userId); // Pass userId here
        console.log('DEBUG: Posts data being sent (first post):', JSON.stringify(postsWithDetails.slice(0, 1)));
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('ERROR: Failed to get all posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts.' });
    }
});

// Endpoint to get posts from followed users
app.get('/api/:projectId/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const followedUsersResult = await pool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
        const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);
        followedUsersIds.push(userId); // Include the user's own posts

        if (followedUsersIds.length === 0) {
            return res.status(200).json([]); // No followers and no posts from the user themselves
        }

        const baseQuery = `WHERE p.author_id = ANY($1::VARCHAR[])`;
        const postsWithDetails = await getPostsWithDetails(pool, baseQuery, [followedUsersIds], userId); // Pass userId here
        console.log('DEBUG: Followed posts data being sent (first post):', JSON.stringify(postsWithDetails.slice(0, 1)));
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('ERROR: Failed to get followed posts:', error);
        res.status(500).json({ error: 'Failed to fetch followed posts.' });
    }
});

// Endpoint for post search
app.get('/api/:projectId/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const searchTerm = q ? `%${q.toLowerCase()}%` : '';

    let baseQuery = ``;
    let queryParams = [];
    let paramIndex = 1;

    if (filter === 'followed' && userId) {
        try {
            const followedUsersResult = await pool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
            const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);
            followedUsersIds.push(userId);
            if (followedUsersIds.length > 0) {
                queryParams.push(followedUsersIds);
                baseQuery += ` WHERE p.author_id = ANY($${paramIndex++}::VARCHAR[])`;
            } else {
                return res.status(200).json([]);
            }
        } catch (error) {
            console.error('ERROR: Failed to get followed users for search:', error);
            return res.status(500).json({ error: 'Failed to search followed posts.' });
        }
    }

    if (searchTerm) {
        queryParams.push(searchTerm);
        if (baseQuery) {
            baseQuery += ` AND (LOWER(p.text) LIKE $${paramIndex++} OR LOWER(u.username) LIKE $${paramIndex++})`;
            queryParams.push(searchTerm); // Add searchTerm again for the second parameter
        } else {
            baseQuery += ` WHERE (LOWER(p.text) LIKE $${paramIndex++} OR LOWER(u.username) LIKE $${paramIndex++})`;
            queryParams.push(searchTerm); // Add searchTerm again for the second parameter
        }
    }

    try {
        const postsWithDetails = await getPostsWithDetails(pool, baseQuery, queryParams, userId); // Pass userId here
        console.log('DEBUG: Search results data being sent (first post):', JSON.stringify(postsWithDetails.slice(0, 1)));
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('ERROR: Failed to search posts:', error);
        res.status(500).json({ error: 'Failed to search posts.' });
    }
});

// Endpoint to delete a post
app.delete('/api/:projectId/posts/:postId', async (req, res) => {
    const { postId } = req.params; // postId in the path
    const { callerUid } = req.body; // callerUid in the body
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'post_media'; // Bucket name for post media

    try {
        const postResult = await pool.query('SELECT media_url, author_id FROM posts WHERE id = $1', [postId]);
        const deletedPost = postResult.rows[0];

        if (!deletedPost) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        // Check if the user is the post author or an admin
        const callerUser = await pool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (deletedPost.author_id !== callerUid && (!callerUser.rows[0] || callerUser.rows[0].user_role !== 'admin')) {
            return res.status(403).json({ error: 'You do not have permission to delete this post.' });
        }

        // If the post has media, delete it from Supabase Storage
        if (deletedPost.media_url) {
            // Extract the path from the public URL
            const url = new URL(deletedPost.media_url);
            const pathSegments = url.pathname.split('/');
            // The path in Supabase Storage starts after the bucket name
            // Example: /storage/v1/object/public/post_media/authorId/fileName.ext
            // We need authorId/fileName.ext
            const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');

            const { error: deleteError } = await supabase.storage
                .from(bucketName)
                .remove([filePathInBucket]);

            if (deleteError) {
                console.error('ERROR: Failed to delete media from Supabase Storage:', deleteError);
                // We don't return an error here because we want to delete the post from the database even if file deletion fails
            } else {
                console.log(`File deleted from Supabase Storage: ${filePathInBucket}`);
            }
        }

        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        console.log('Post deleted:', postId);
        res.status(200).json({ message: 'Post deleted successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to delete post:', error);
        res.status(500).json({ error: 'Failed to delete post.' });
    }
});

// Endpoint to pin/unpin a post (Admin only)
app.put('/api/:projectId/posts/:postId/pin', async (req, res) => {
    const { postId } = req.params;
    const { isPinned, callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        // Check if the requesting user is an admin
        const adminUser = await pool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (!adminUser.rows[0] || adminUser.rows[0].user_role !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to pin/unpin posts.' });
        }

        const postCheck = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
        if (postCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        await pool.query('UPDATE posts SET is_pinned = $1 WHERE id = $2', [isPinned, postId]);
        res.status(200).json({ message: `Post ${isPinned ? 'pinned' : 'unpinned'} successfully.`, isPinned });
    } catch (error) {
        console.error('ERROR: Failed to pin/unpin post:', error);
        res.status(500).json({ error: 'Failed to pin/unpin post.' });
    }
});

// Endpoint to like a post
app.post('/api/:projectId/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const postResult = await pool.query('SELECT likes FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        let currentLikes = post.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId); // Add like
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1); // Remove like
            isLiked = false;
        }

        await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);
        res.status(200).json({ message: 'Like updated successfully.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('ERROR: Failed to like post:', error);
        res.status(500).json({ error: 'Failed to update like.' });
    }
});

// Endpoint to increment view count
app.post('/api/:projectId/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const postResult = await pool.query('SELECT views FROM posts WHERE id = $1', [postId]);
        const post = postResult.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        let currentViews = post.views || [];

        // Add view only if the user hasn't viewed it before
        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE id = $2', [JSON.stringify(currentViews), postId]);
        }
        res.status(200).json({ message: 'Views updated successfully.', viewsCount: currentViews.length });
    } catch (error) {
        console.error('ERROR: Failed to update post views:', error);
        res.status(500).json({ error: 'Failed to update views.' });
    }
});

// Endpoint to add a comment to a post
app.post('/api/:projectId/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!text) {
        return res.status(400).json({ error: 'Comment text is required.' });
    }

    try {
        const postResult = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        const userResult = await pool.query('SELECT profile_bg_url, is_verified FROM users WHERE uid = $1', [userId]);
        const userProfileBg = userResult.rows[0] ? userResult.rows[0].profile_bg_url : null;
        const isVerified = userResult.rows[0] ? userResult.rows[0].is_verified : false;

        const commentId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO comments (id, post_id, user_id, username, text, timestamp, user_profile_bg, likes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [commentId, postId, userId, username, text, timestamp, userProfileBg, '[]']
        );

        const newComment = {
            id: commentId,
            userId,
            username,
            text,
            timestamp,
            likes: [],
            userProfileBg: userProfileBg,
            isVerified: isVerified
        };
        console.log('DEBUG: New comment created and sent:', newComment);
        res.status(201).json({ message: 'Comment added successfully.', comment: newComment });
    } catch (error) {
        console.error('ERROR: Failed to add comment:', error);
        res.status(500).json({ error: 'Failed to add comment.' });
    }
});

// Endpoint to get post comments
app.get('/api/:projectId/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query(`
            SELECT c.id, c.user_id, c.username, c.text, c.timestamp, c.user_profile_bg, c.likes, u.is_verified
            FROM comments c
            JOIN users u ON c.user_id = u.uid
            WHERE c.post_id = $1
            ORDER BY c.timestamp ASC
        `, [postId]);
        const comments = result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            username: row.username,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            userProfileBg: row.user_profile_bg,
            likes: row.likes, // JSONB is already an array in Node.js
            isVerified: row.is_verified
        }));
        console.log('DEBUG: Comments data being sent (first comment):', JSON.stringify(comments.slice(0, 1)));
        res.status(200).json(comments);
    } catch (error) {
        console.error('ERROR: Failed to get comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

// Endpoint to edit a comment
app.put('/api/:projectId/posts/:postId/comments/:commentId', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId, newText } = req.body; // userId is the ID of the user performing the edit
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!newText || newText.trim() === '') {
        return res.status(400).json({ error: 'New comment text is required.' });
    }

    try {
        const commentResult = await pool.query('SELECT user_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        // Check if the user is the comment owner
        if (comment.user_id !== userId) {
            return res.status(403).json({ error: 'You do not have permission to edit this comment.' });
        }

        await pool.query('UPDATE comments SET text = $1 WHERE id = $2', [newText, commentId]);
        res.status(200).json({ message: 'Comment updated successfully.', newText });
    } catch (error) {
        console.error('ERROR: Failed to edit comment:', error);
        res.status(500).json({ error: 'Failed to edit comment.' });
    }
});

// Endpoint to delete a comment
app.delete('/api/:projectId/posts/:postId/comments/:commentId', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body; // userId is the ID of the user performing the deletion
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const commentResult = await pool.query('SELECT user_id, post_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        // Check if the user is the comment owner, post owner, or an admin
        const postOwnerResult = await pool.query('SELECT author_id FROM posts WHERE id = $1', [comment.post_id]);
        const postOwnerId = postOwnerResult.rows[0] ? postOwnerResult.rows[0].author_id : null;

        const callerUser = await pool.query('SELECT user_role FROM users WHERE uid = $1', [userId]);
        const callerRole = callerUser.rows[0] ? callerUser.rows[0].user_role : 'normal';

        if (comment.user_id !== userId && postOwnerId !== userId && callerRole !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to delete this comment.' });
        }

        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
        res.status(200).json({ message: 'Comment deleted successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to delete comment:', error);
        res.status(500).json({ error: 'Failed to delete comment.' });
    }
});


// Endpoint to like a comment
app.post('/api/:projectId/posts/:postId/comments/:commentId/like', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const commentResult = await pool.query('SELECT likes FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        let currentLikes = comment.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId); // Add like
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1); // Remove like
            isLiked = false;
        }

        await pool.query('UPDATE comments SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), commentId]);
        console.log('DEBUG: Comment like updated. Likes:', currentLikes.length, 'IsLiked:', isLiked);
        res.status(200).json({ message: 'Comment like updated successfully.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('ERROR: Failed to like comment:', error);
        res.status(500).json({ error: 'Failed to update comment like.' });
    }
});

// Media file serving endpoint (images, videos, voice messages)
// Note: This path does not use projectId in the URL as the frontend is expected to get the public URL directly from Supabase Storage.
// If you want to proxy media requests through the backend, you'll need to modify this endpoint to receive projectId
// and use the Supabase Client specific to that project.
app.get('/api/media/:bucketName/:folder/:fileName', async (req, res) => {
    const { bucketName, folder, fileName } = req.params;
    const projectId = req.query.projectId; // projectId can be passed as a query parameter
    const supabase = projectSupabaseClients[projectId]; // Use the Supabase Client specific to the selected project

    if (!supabase) {
        return res.status(400).send('Invalid or uninitialized project ID for media service.');
    }

    const filePathInBucket = `${folder}/${fileName}`;

    console.log(`DEBUG: Media file request: ${filePathInBucket} from Bucket: ${bucketName} for Project: ${projectId}`);

    try {
        // Create a signed URL to access the file (for security and access control)
        const { data, error } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(filePathInBucket, 60); // URL valid for 60 seconds

        if (error || !data || !data.signedUrl) {
            console.error(`ERROR: Failed to create signed URL for file ${filePathInBucket}:`, error);
            return res.status(500).send('Failed to serve file.');
        }

        // Redirect the request to the signed URL
        res.redirect(data.signedUrl);

    } catch (error) {
        console.error(`ERROR: Failed to serve media file ${filePathInBucket} from Supabase Storage:`, error);
        res.status(500).send('Failed to serve file.');
    }
});


// ----------------------------------------------------------------------------------------------------
// Video Playback Progress Endpoints
// ----------------------------------------------------------------------------------------------------

// Endpoint to save or update video playback position
app.post('/api/:projectId/video/:postId/playback-position', async (req, res) => {
    const { postId } = req.params;
    const { userId, positionSeconds } = req.body; // playbackPosition in seconds
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!userId || positionSeconds === undefined || positionSeconds === null) {
        return res.status(400).json({ error: 'User ID and playback position are required.' });
    }

    try {
        // UPSERT operation: INSERT if not exists, UPDATE if exists
        await pool.query(`
            INSERT INTO video_playback_progress (user_id, post_id, position_seconds, last_updated)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, post_id) DO UPDATE SET
                position_seconds = EXCLUDED.position_seconds,
                last_updated = EXCLUDED.last_updated;
        `, [userId, postId, positionSeconds, Date.now()]);

        res.status(200).json({ message: 'Playback position saved successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to save video playback position:', error);
        res.status(500).json({ error: 'Failed to save playback position.' });
    }
});


// ----------------------------------------------------------------------------------------------------
// Gemini API Proxy Endpoints
// ----------------------------------------------------------------------------------------------------
app.post('/api/:projectId/gemini-proxy', async (req, res) => {
    const { prompt, chatHistory = [] } = req.body;

    if (!GEMINI_API_KEY) {
        console.error("Gemini API Key is not configured.");
        return res.status(500).json({ error: "Gemini API Key is not configured on the server." });
    }

    const payload = {
        contents: [...chatHistory, { role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            // You can add additional settings here like temperature, topP, topK
            // For example: temperature: 0.7
        }
    };

    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Gemini API Error: ${response.status} - ${errorText}`);
            return res.status(response.status).json({ error: `Gemini API Error: ${response.status} - ${errorText}` });
        }

        const result = await response.json();

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            res.status(200).json({ response: text });
        } else {
            console.warn('Gemini API response structure unexpected:', result);
            res.status(500).json({ error: 'Gemini API returned an unexpected response structure.' });
        }
    } catch (error) {
        console.error('Error calling Gemini API proxy:', error);
        res.status(500).json({ error: 'Failed to connect to Gemini API: ' + error.message });
    }
});


// ----------------------------------------------------------------------------------------------------
// Chat Functions - Modified to work with PostgreSQL
// ----------------------------------------------------------------------------------------------------

// Endpoint to create a private chat
app.post('/api/:projectId/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'All user data is required to create a private chat.' });
    }

    try {
        // Check if chat already exists
        const existingChatResult = await pool.query(`
            SELECT id FROM chats
            WHERE type = 'private'
            AND (participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[]))
        `, [user1Id, user2Id]);

        if (existingChatResult.rows.length > 0) {
            const existingChatId = existingChatResult.rows[0].id;
            console.log('Private chat already exists:', existingChatId);
            return res.status(200).json({ message: 'Chat already exists.', chatId: existingChatId });
        }

        const newChatId = uuidv4();
        const timestamp = Date.now();
        const participantsArray = [user1Id, user2Id];
        const contactNamesObject = {
            [user1Id]: contactName,
            [user2Id]: user1Name
        };

        // Fetch the other user's profile background to set as private chat background
        const user2Profile = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [user2Id]);
        const chatProfileBg = user2Profile.rows[0] ? user2Profile.rows[0].profile_bg_url : null;


        await pool.query(
            `INSERT INTO chats (id, type, participants, last_message, timestamp, contact_names, profile_bg_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newChatId, 'private', JSON.stringify(participantsArray), null, timestamp, JSON.stringify(contactNamesObject), chatProfileBg]
        );

        console.log('New private chat created:', newChatId);
        res.status(201).json({ message: 'Chat created.', chatId: newChatId });
    } catch (error) {
        console.error('ERROR: Failed to create private chat:', error);
        res.status(500).json({ error: 'Failed to create chat.' });
    }
});

// Endpoint to update contact name in a private chat
app.put('/api/:projectId/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const chatResult = await pool.query('SELECT contact_names FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found or you do not have permission to edit.' });
        }

        let currentContactNames = chat.contact_names || {};
        currentContactNames[userId] = newContactName;

        await pool.query('UPDATE chats SET contact_names = $1 WHERE id = $2', [JSON.stringify(currentContactNames), chatId]);
        console.log(`Contact name for chat ${chatId} updated by ${userId} to ${newContactName}`);
        res.status(200).json({ message: 'Contact name updated successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to update contact name:', error);
        res.status(500).json({ error: 'Failed to update contact name.' });
    }
});

// Endpoint to get all chats for a specific user
app.get('/api/:projectId/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const result = await pool.query(`
            SELECT id, type, name, last_message, timestamp, profile_bg_url, admin_id, contact_names, participants, send_permission
            FROM chats
            WHERE participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) OR (type = 'private' AND name = 'المساعدة')
            ORDER BY CASE WHEN name = 'المساعدة' THEN 0 ELSE 1 END, timestamp DESC
        `, [userId]);

        const userChats = [];
        for (const row of result.rows) {
            let chatName = '';
            let chatCustomId = null;
            let chatProfileBg = row.profile_bg_url; // Use profile_bg_url directly from chats table
            let chatAdminId = null;
            let chatSendPermission = row.send_permission;

            if (row.type === 'private') {
                if (row.name === 'المساعدة') {
                    chatName = 'المساعدة';
                    const botUserResult = await pool.query('SELECT custom_id FROM users WHERE username = $1 AND user_role = $2', ['المساعدة', 'bot']);
                    chatCustomId = botUserResult.rows[0] ? botUserResult.rows[0].custom_id : null;
                } else {
                    chatName = row.contact_names ? row.contact_names[userId] : 'Unknown Contact';
                    const otherParticipantId = row.participants.find(pId => pId !== userId);
                    if (otherParticipantId) {
                        const otherUserResult = await pool.query('SELECT custom_id, profile_bg_url FROM users WHERE uid = $1', [otherParticipantId]);
                        const otherUser = otherUserResult.rows[0];
                        if (otherUser) {
                            chatCustomId = otherUser.custom_id;
                            // If it's a private chat, the chat background is the other party's profile background
                            chatProfileBg = otherUser.profile_bg_url;
                        }
                    }
                }
            } else if (row.type === 'group') {
                chatName = row.name;
                chatAdminId = row.admin_id;
            }

            userChats.push({
                id: row.id,
                type: row.type,
                name: chatName,
                lastMessage: row.last_message,
                timestamp: parseInt(row.timestamp),
                customId: chatCustomId,
                profileBg: chatProfileBg,
                adminId: chatAdminId,
                sendPermission: chatSendPermission
            });
        }
        console.log('DEBUG: User chats data being sent (first chat):', JSON.stringify(userChats.slice(0, 1)));
        res.status(200).json(userChats);
    } catch (error) {
        console.error('ERROR: Failed to get user chats:', error);
        res.status(500).json({ error: 'Failed to fetch chats.' });
    }
});

// Endpoint to send a message in a chat
app.post('/api/:projectId/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'chat_media'; // Bucket name for chat media

    let messageMediaUrl = null;
    let messageMediaType = mediaType || 'text';

    try {
        const chatResult = await pool.query('SELECT participants, type, admin_id, member_roles, send_permission FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found.' });
        }
        if (!chat.participants.includes(senderId)) {
            return res.status(403).json({ error: 'User is not a member of this chat.' });
        }

        // Check send permission in groups
        if (chat.type === 'group' && chat.send_permission === 'admins_only') {
            const senderRole = chat.member_roles[senderId];
            if (senderRole !== 'admin') {
                return res.status(403).json({ error: 'Only admins can send messages in this group.' });
            }
        }

        if (mediaFile) {
            const fileExtension = mediaFile.originalname.split('.').pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const filePath = `${senderId}/${fileName}`; // Storage path in the bucket

            // Upload file to Supabase Storage
            const { data, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, mediaFile.buffer, {
                    contentType: mediaFile.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error('ERROR: Failed to upload file to Supabase Storage:', uploadError);
                return res.status(500).json({ error: 'Failed to upload file to storage.' });
            }

            // Get the public URL for the file
            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);

            if (!publicUrlData || !publicUrlData.publicUrl) {
                console.error('ERROR: Failed to get public URL for uploaded file.');
                return res.status(500).json({ error: 'Failed to get public file URL.' });
            }

            messageMediaUrl = publicUrlData.publicUrl;
            console.log(`Media file uploaded for message: ${messageMediaUrl}`);

            if (!mediaType || mediaType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    messageMediaType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    messageMediaType = 'video';
                } else if (mediaFile.mimetype.startsWith('audio/')) { // New: audio support
                    messageMediaType = 'audio';
                }
            }
        }

        const messageId = uuidv4();
        const timestamp = Date.now();

        await pool.query(
            `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_url, media_type, sender_profile_bg)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [messageId, chatId, senderId, senderName, text || '', timestamp, messageMediaUrl, messageMediaType, senderProfileBg || null]
        );

        let lastMessageText = '';
        if (messageMediaType === 'image') {
            lastMessageText = 'صورة';
        } else if (messageMediaType === 'video') {
            lastMessageText = 'فيديو';
        } else if (messageMediaType === 'audio') {
            lastMessageText = 'رسالة صوتية';
        } else {
            lastMessageText = text || '';
        }

        await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [lastMessageText, timestamp, chatId]);

        const newMessage = {
            id: messageId,
            senderId,
            senderName,
            text: text || '',
            timestamp,
            mediaUrl: messageMediaUrl,
            mediaType: messageMediaType,
            senderProfileBg: senderProfileBg || null
        };

        console.log('DEBUG: New message sent in chat:', chatId, newMessage);
        res.status(201).json({ message: 'Message sent successfully.', messageData: newMessage });
    } catch (error) {
        console.error('ERROR: Failed to send message:', error);
        res.status(500).json({ error: 'Failed to send message.' });
    }
});

// Endpoint to get messages for a specific chat (with time filter)
app.get('/api/:projectId/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = parseInt(req.query.since || '0');
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const result = await pool.query(
            `SELECT m.*, u.is_verified AS sender_is_verified, u.user_role AS sender_user_role
             FROM messages m
             JOIN users u ON m.sender_id = u.uid
             WHERE m.chat_id = $1 AND m.timestamp > $2 ORDER BY m.timestamp ASC`,
            [chatId, sinceTimestamp]
        );

        const messages = result.rows.map(row => ({
            id: row.id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            senderProfileBg: row.sender_profile_bg,
            senderIsVerified: row.sender_is_verified,
            senderUserRole: row.user_role
        }));
        console.log('DEBUG: Chat messages data being sent (first message):', JSON.stringify(messages.slice(0, 1)));
        res.status(200).json(messages);
    } catch (error) {
        console.error('ERROR: Failed to get chat messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

// Endpoint to delete a chat for a specific user (in this model, deletion from the chats table)
app.delete('/api/:projectId/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found or user is not a member.' });
        }

        let updatedParticipants = chat.participants.filter(p => p !== userId);

        if (updatedParticipants.length === 0) {
            // If no participants remain, delete the chat entirely
            await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
            console.log(`Chat ${chatId} completely deleted because user ${userId} was the last participant.`);
            res.status(200).json({ message: 'Chat completely deleted successfully.' });
        } else {
            // Update the list of participants
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatId]);
            console.log(`Chat ${chatId} deleted for user ${userId} only.`);
            res.status(200).json({ message: 'Chat deleted from your view successfully.' });
        }
    } catch (error) {
        console.error('ERROR: Failed to delete chat for user:', error);
        res.status(500).json({ error: 'Failed to delete chat.' });
    }
});

// Endpoint to delete a private chat for both parties
app.delete('/api/:projectId/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'chat_media'; // Bucket name for chat media

    try {
        const messagesResult = await pool.query('SELECT media_url FROM messages WHERE chat_id = $1', [chatId]);
        const messagesMediaUrls = messagesResult.rows.map(row => row.media_url).filter(Boolean);

        // Delete media files associated with messages in this chat from Supabase Storage
        if (messagesMediaUrls.length > 0) {
            const filePathsToDelete = messagesMediaUrls.map(url => {
                const urlObj = new URL(url);
                const pathSegments = urlObj.pathname.split('/');
                return pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
            });

            const { error: deleteError } = await supabase.storage
                .from(bucketName)
                .remove(filePathsToDelete);

            if (deleteError) {
                console.error('ERROR: Failed to delete message media from Supabase Storage:', deleteError);
            } else {
                console.log(`Media files deleted from Supabase Storage for chat ${chatId}.`);
            }
        }

        // Delete all messages related to the chat
        await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        // Delete the chat itself
        await pool.query('DELETE FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, callerUid]);

        console.log(`Private chat ${chatId} deleted for both parties by ${callerUid}.`);
        res.status(200).json({ message: 'Chat deleted for both parties successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to delete private chat for both:', error);
        res.status(500).json({ error: 'Failed to delete chat for both parties.' });
    }
});

// ----------------------------------------------------------------------------------------------------
// Group Functions - Modified to work with PostgreSQL
// ----------------------------------------------------------------------------------------------------

// Endpoint to create a new group
app.post('/api/:projectId/groups', async (req, res) => {
    const { name, description, adminId, members, profileBgUrl } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'Group name, admin ID, and at least two members are required.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
        return res.status(400).json({ error: 'The specified admin must be a member and an admin.' });
    }

    try {
        const newGroupId = uuidv4();
        const timestamp = Date.now();
        const participantsArray = Object.keys(members);

        await pool.query(
            `INSERT INTO chats (id, type, name, description, admin_id, participants, member_roles, last_message, timestamp, profile_bg_url, send_permission)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [newGroupId, 'group', name, description || '', adminId, JSON.stringify(participantsArray), JSON.stringify(members), null, timestamp, profileBgUrl || null, 'all']
        );

        console.log('New group created:', newGroupId);
        res.status(201).json({ message: 'Group created successfully.', groupId: newGroupId });
    } catch (error) {
        console.error('ERROR: Failed to create group:', error);
        res.status(500).json({ error: 'Failed to create group.' });
    }
});

// Endpoint to change group name
app.put('/api/:projectId/groups/:groupId/name', async (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to change the group name.' });
        }

        await pool.query('UPDATE chats SET name = $1 WHERE id = $2', [newName, groupId]);
        console.log(`Group ${groupId} name changed to ${newName}`);
        res.status(200).json({ message: 'Group name changed successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to change group name:', error);
        res.status(500).json({ error: 'Failed to change group name.' });
    }
});

// Endpoint to change group background
app.post('/api/:projectId/groups/:groupId/background', upload.single('file'), async (req, res) => {
    const { groupId } = req.params;
    const { callerUid } = req.body;
    const uploadedFile = req.file;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    const supabase = req.supabase; // Use the Supabase Client specific to the selected project
    const bucketName = 'group_backgrounds'; // Dedicated bucket name for group backgrounds

    if (!callerUid || !uploadedFile) {
        return res.status(400).json({ error: 'User ID and file are required.' });
    }

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        // Check if the user has admin permissions
        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to change the group background.' });
        }

        const fileExtension = uploadedFile.originalname.split('.').pop();
        const fileName = `${uuidv4()}.${fileExtension}`;
        const filePath = `${groupId}/${fileName}`; // Storage path in the bucket

        // Upload file to Supabase Storage
        const { data, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, uploadedFile.buffer, {
                contentType: uploadedFile.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('ERROR: Failed to upload file to Supabase Storage:', uploadError);
            return res.status(500).json({ error: 'Failed to upload file to storage.' });
        }

        // Get the public URL for the file
        const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error('ERROR: Failed to get public URL for uploaded file.');
            return res.status(500).json({ error: 'Failed to get public file URL.' });
        }

        const mediaUrl = publicUrlData.publicUrl;

        await pool.query('UPDATE chats SET profile_bg_url = $1 WHERE id = $2', [mediaUrl, groupId]);

        console.log(`Group background uploaded for group ${groupId}: ${mediaUrl}`);
        res.status(200).json({ message: 'Group background uploaded successfully.', url: mediaUrl });
    } catch (error) {
        console.error('ERROR: Failed to upload group background or update DB:', error);
        res.status(500).json({ error: 'Failed to upload group background.' });
    }
});

// Endpoint to change send permission in the group
app.put('/api/:projectId/groups/:groupId/send-permission', async (req, res) => {
    const { groupId } = req.params;
    const { callerUid, newPermission } = req.body; // 'all' or 'admins_only'
    const pool = req.dbPool; // Use the Pool specific to the selected project

    if (!newPermission || !['all', 'admins_only'].includes(newPermission)) {
        return res.status(400).json({ error: 'Invalid send permission.' });
    }

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        // Check if the user has admin permissions
        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to change send permission in this group.' });
        }

        await pool.query('UPDATE chats SET send_permission = $1 WHERE id = $2', [newPermission, groupId]);
        res.status(200).json({ message: 'Send permission updated successfully.', sendPermission: newPermission });
    } catch (error) {
        console.error('ERROR: Failed to update group send permission:', error);
        res.status(500).json({ error: 'Failed to update send permission in group.' });
    }
});


// Endpoint to get group members (with roles)
app.get('/api/:projectId/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        const memberUids = group.participants;
        const memberRoles = group.member_roles;

        const usersResult = await pool.query('SELECT uid, username, custom_id, is_verified, user_role FROM users WHERE uid = ANY($1::VARCHAR[])', [memberUids]);
        const usersMap = new Map(usersResult.rows.map(u => [u.uid, u]));

        const membersInfo = memberUids.map(pId => {
            const user = usersMap.get(pId);
            if (user) {
                return {
                    uid: user.uid,
                    username: user.username,
                    customId: user.custom_id,
                    role: memberRoles[pId] || 'member',
                    isVerified: user.is_verified,
                    userRole: user.user_role
                };
            }
            return null;
        }).filter(Boolean);
        console.log('DEBUG: Group members data being sent:', JSON.stringify(membersInfo.slice(0, 1)));
        res.status(200).json(membersInfo);
    } catch (error) {
        console.error('ERROR: Failed to get group members:', error);
        res.status(500).json({ error: 'Failed to fetch group members.' });
    }
});

// Endpoint to get group member count
app.get('/api/:projectId/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    const pool = req.dbPool; // Use the Pool specific to the selected project
    try {
        const groupResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        res.status(200).json({ count: group.participants.length });
    } catch (error) {
        console.error('ERROR: Failed to get group members count:', error);
        res.status(500).json({ error: 'Failed to fetch group member count.' });
    }
});

// Endpoint to add members to an existing group
app.post('/api/:projectId/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to add members to this group.' });
        }

        let currentParticipants = group.participants;
        let currentMemberRoles = group.member_roles;
        const addedMembers = [];

        for (const uid of newMemberUids) {
            if (!currentParticipants.includes(uid)) {
                const userResult = await pool.query('SELECT username FROM users WHERE uid = $1', [uid]);
                const user = userResult.rows[0];
                if (user) {
                    currentParticipants.push(uid);
                    currentMemberRoles[uid] = 'member';
                    addedMembers.push(user.username);
                }
            }
        }

        if (addedMembers.length > 0) {
            await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(currentParticipants), JSON.stringify(currentMemberRoles), groupId]);
            console.log(`New members added to group ${groupId}: ${addedMembers.join(', ')}`);
            res.status(200).json({ message: `${addedMembers.length} members added successfully: ${addedMembers.join(', ')}` });
        } else {
            res.status(200).json({ message: 'No new members added (perhaps they were already present).' });
        }
    } catch (error) {
        console.error('ERROR: Failed to add members to group:', error);
        res.status(500).json({ error: 'Failed to add members to group.' });
    }
});

// Endpoint to change a member's role in a group (admin/member)
app.put('/api/:projectId/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to change member roles.' });
        }

        if (memberUid === group.admin_id && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'You do not have permission to change the group owner\'s role.' });
        }

        if (group.member_roles[memberUid] === 'admin' && newRole === 'member' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'You do not have permission to remove another admin from admin status.' });
        }

        if (!group.participants.includes(memberUid)) {
            return res.status(404).json({ error: 'Member not found in this group.' });
        }

        let updatedMemberRoles = group.member_roles;
        updatedMemberRoles[memberUid] = newRole;

        await pool.query('UPDATE chats SET member_roles = $1 WHERE id = $2', [JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'Member role changed successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to change member role:', error);
        res.status(500).json({ error: 'Failed to change member role.' });
    }
});

// Endpoint to remove a member from the group
app.delete('/api/:projectId/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { callerUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'You do not have permission to remove members from this group.' });
        }

        if (memberUid === group.admin_id) {
            return res.status(403).json({ error: 'You cannot remove the group owner.' });
        }

        if (group.member_roles[memberUid] === 'admin' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'You do not have permission to remove another admin.' });
        }

        const memberIndex = group.participants.indexOf(memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'Member not found in this group.' });
        }

        let updatedParticipants = group.participants.filter(id => id !== memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'Member removed successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to remove member from group:', error);
        res.status(500).json({ error: 'Failed to remove member.' });
    }
});

// Endpoint to leave a group
app.delete('/api/:projectId/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;
    const pool = req.dbPool; // Use the Pool specific to the selected project

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        const memberIndex = group.participants.indexOf(memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'You are not a member of this group.' });
        }

        if (memberUid === group.admin_id) {
            if (group.participants.length > 1) {
                 return res.status(403).json({ error: 'You cannot leave the group as the owner. Please assign a new owner first.' });
            } else {
                await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                console.log(`Group ${groupId} deleted because the owner left and was the only member.`);
                return res.status(200).json({ message: 'Group deleted successfully after you left.' });
            }
        }

        let updatedParticipants = group.participants.filter(id => id !== memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'Left group successfully.' });
    } catch (error) {
        console.error('ERROR: Failed to leave group:', error);
        res.status(500).json({ error: 'Failed to leave group.' });
    }
});


// Start the server
app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Backend URL: http://localhost:${port}`);
    await initializeSupabaseClients(); // Call to initialize Supabase clients and databases
});
