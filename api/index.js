// استيراد المكتبات المطلوبة
const express = require('express'); // إطار عمل Express لإنشاء الخادم
const bodyParser = require('body-parser'); // لتحليل نصوص طلبات HTTP
const cors = require('cors'); // للتعامل مع سياسات CORS (Cross-Origin Resource Sharing)
const multer = require('multer'); // للتعامل مع تحميل الملفات (الصور والفيديوهات والرسائل الصوتية)
const { v4: uuidv4 } = require('uuid'); // لإنشاء معرفات فريدة عالمياً (UUIDs)
const { Pool } = require('pg'); // لاستخدام PostgreSQL
const fetch = require('node-fetch'); // لاستخدام fetch في Node.js للاتصال بـ Gemini API
const { createClient } = require('@supabase/supabase-js'); // لاستخدام Supabase Client
const webPush = require('web-push'); // ==== تمت إضافة هذه المكتبة للإشعارات ====
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // استخدم متغير بيئة لمفتاح Stripe السري
const axios = require('axios'); // لإجراء طلبات HTTP (سنحتاجها لـ Binance)

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000;
const FRONTEND_URL = "https://watsaligram-frontend-web.netlify.app/"; // <--- غيّر هذا إلى رابط موقعك الفعلي

// ==============================================================================
// !! تعديل هام لـ Vercel: تم نقل دالة التهيئة إلى هنا (قبل استخدامها) !!
// ==============================================================================
let initializationPromise = null;
const ensureDbInitialized = async (req, res, next) => {
    try {
        if (!initializationPromise) {
            console.log("Starting database initialization...");
            initializationPromise = initializeSupabaseClients();
        }
        await initializationPromise;
        // console.log("Database initialization complete. Proceeding with request."); // يمكن إلغاء التعليق للفحص
        next();
    } catch (error) {
        console.error("CRITICAL: Database initialization failed.", error);
        initializationPromise = null; 
        res.status(500).json({ error: "Failed to connect to the database." });
    }
};

// الآن نستخدم الدالة بعد أن تم تعريفها
app.use(ensureDbInitialized);
// ==============================================================================
// !! نهاية التعديل الهام !!
// ==============================================================================


// ==== بداية كود إعداد الإشعارات (القديم) ====
const publicVapidKey = 'BBlbt3D5lIiDN7xEbe4FfEA7ipXGsv0_fbP5xawOR3-5R7FxT9KNh_tUXklvENkADLYiv_2V8xPmncl8IcaaTIM';
const privateVapidKey = '03sShkGPnA_dYhcGL45wXj0YJWBLweuMyMfhOWLoWOw';

webPush.setVapidDetails(
  'mailto:your-email@example.com', // يمكنك وضع بريدك الإلكتروني هنا
  publicVapidKey,
  privateVapidKey
);
// ==== نهاية كود إعداد الإشعارات (القديم) ====

/**
 * دالة لإرسال إشعار عبر OneSignal باستخدام REST API
 * @param {string[]} userIds - مصفوفة بمعرفات المستخدمين (external_user_id) لإرسال الإشعار إليهم
 * @param {string} title - عنوان الإشعار
 * @param {string} body - نص الإشعار
 * @param {string} url - الرابط الذي سيتم فتحه عند النقر على الإشعار
 * @param {string} icon - رابط أيقونة الإشعار (صورة المرسل)
 */
async function sendOneSignalNotification(userIds, title, body, url, icon) {
  if (!userIds || userIds.length === 0) {
    console.log("لا يوجد مستلمين لإرسال إشعار OneSignal.");
    return;
  }

  // تم نقل المتغيرات إلى داخل الدالة لتجنب مشاكل 'before initialization' المحتملة
  const ONESIGNAL_APP_ID = process.env.ONESIGNال_APP_ID || '4324b057-7a7d-442c-9d51-a42e25d30ca0';
  const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;


  const notification = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: userIds,
    
    // المحتوى الأساسي للإشعار
    contents: {
      en: body,
      ar: body
    },
    headings: {
      en: title,
      ar: title
    },
    
    // --- التعديل الأهم هنا ---
    
    // (هام جداً لتطبيق APK)
    // هذا هو الخيار الصحيح لعرض الشعار أو صورة المرسل كأيقونة كبيرة في إشعار الأندرويد.
    large_icon: icon, 
    
    // --- الإبقاء على الخيارات القديمة للتوافق مع المنصات الأخرى ---
    
    // هذا يعمل فقط على متصفح كروم على الويب
    chrome_web_icon: icon, 
    
    // هذا يعمل فقط على أجهزة iOS
    ios_attachments: { 
        id1: icon
    },
    
    // بيانات إضافية ورابط الفتح
    web_url: url, 
    data: { 
        url: url
    }
  };

  try {
    console.log(`محاولة إرسال إشعار OneSignal إلى المستلمين:`, userIds); // **إضافة سطر طباعة للتحقق**
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify(notification)
    });

    const responseData = await response.json();
    if (responseData.errors) {
        console.error('خطأ من OneSignal API:', responseData.errors);
    } else {
        console.log('تم إرسال إشعار OneSignal بنجاح:', responseData);
    }
  } catch (error) {
    console.error('خطأ في إرسال إشعار OneSignal:', error);
  }
}

// ----------------------------------------------------------------------------------------------------
// إعداد Multer لتخزين الملفات مؤقتاً في الذاكرة
const upload = multer({ storage: multer.memoryStorage() });

// ----------------------------------------------------------------------------------------------------
// إعدادات مشاريع Supabase - تم تحديثها بالمفاتيح التي قدمتها
// ----------------------------------------------------------------------------------------------------
const SUPABASE_PROJECT_CONFIGS = {
    'kdbtusugpqboxsaosaci': { // معرف المشروع 1 (الافتراضي)
        databaseUrl: "postgresql://postgres.kdbtusugpqboxsaosaci:Feaw%2BJu%25RWp4*Hq@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://kdbtusugpqboxsaosaci.supabase.co",
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYnR1c3VncHFib3hzYW9zYWNpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjg1NDU1NCwiZXhwIjoyMDY4NDMwNTU0fQ.AQKVeRlWPoXmplNRg_xKL1OMPP-TW8qCGUcftTYaky8" // مفتاح المشروع 1
    },
    'ojuatwnwnvnzfyhicokc': { // معرف المشروع 2
        databaseUrl: "postgresql://postgres.ojuatwnwnvnzfyhicokc:w%26qGbv4!gLVG%26Cg@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://ojuatwnwnvnzfyhicokc.supabase.co",
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdWF0d253bnZuemZ5aGljb2tjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjg1NjIxNCwiZXhwIjoyMDY4NDMyMjE0fQ.JLhsU2VUzF2tiAEWIkq3ivWtfLemwEJgVUkh4cHRQRQ" // مفتاح المشروع 2
    },
    'fznbkubzddthnboehmvq': { // معرف المشروع 3
        databaseUrl: "postgresql://postgres.fznbkubzddthnboehmvq:j%23ZM%24q%40WjH%40dtU6@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://fznbkubzddthnboehmvq.supabase.co",
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6bmJrdWJ6ZGR0aG5ib2VobXZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjg1NzE2MCwiZXhwIjoyMDY4NDMzMTYwfQ.v47l39S4qOooMPxMGJrUPPBqY7B0Z0fiBB1h7uWZEXg" // مفتاح المشروع 3
    },
    'woxzcoerelijbsrbdnbk': { // معرف المشروع 4
        databaseUrl: "postgresql://postgres.woxzcoerelijbsrbdnbk:n%247j9tuvhRtQ!8y@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        projectUrl: "https://woxzcoerelijbsrbdnbk.supabase.co",
        serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndveHpjb2VyZWxpamJzcmJkbmJrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjg1NzQxOCwiZXhwIjoyMDY4NDMzNDE4fQ.nwKvMDUGq6zPzQluXR_3PrQy0HAVl1sDAflT5at2AQA" // مفتاح المشروع 4
    },
};

// **معرف المشروع الافتراضي للخادم الخلفي**
const BACKEND_DEFAULT_PROJECT_ID = "kdbtusugpqboxsaosaci";

// كائنات لتخزين مجمعات اتصال قاعدة البيانات وعملاء Supabase لكل مشروع
const projectDbPools = {};
const projectSupabaseClients = {};

// متغير لتتبع المشروع الحالي لتسجيل المستخدمين الجدد بنظام الدورة
let currentProjectIndex = 0;
const projectIds = Object.keys(SUPABASE_PROJECT_CONFIGS);

// ----------------------------------------------------------------------------------------------------
// تهيئة PostgreSQL Pool وعميل Supabase لكل مشروع
// ----------------------------------------------------------------------------------------------------
async function initializeSupabaseClients() {
    for (const projectId in SUPABASE_PROJECT_CONFIGS) {
        const config = SUPABASE_PROJECT_CONFIGS[projectId];
        try {
            // تهيئة PostgreSQL Pool
            projectDbPools[projectId] = new Pool({
                connectionString: config.databaseUrl,
                ssl: {
                    rejectUnauthorized: false
                }
            });
            await projectDbPools[projectId].connect();
            console.log(`تم تهيئة PostgreSQL Pool للمشروع: ${projectId}`);

            // تهيئة عميل Supabase
            projectSupabaseClients[projectId] = createClient(
                config.projectUrl,
                config.serviceRoleKey,
                {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                        detectSessionInUrl: false
                    }
                }
            );
            console.log(`تم تهيئة عميل Supabase للمشروع: ${projectId}.`);

            // إنشاء الجداول لهذا المشروع
            await createTables(projectDbPools[projectId]);

        } catch (error) {
            console.error(`خطأ: فشل تهيئة Supabase أو PostgreSQL للمشروع ${projectId}:`, error);
        }
    }
}

// ----------------------------------------------------------------------------------------------------
// إعدادات المدير (Admin)
// ----------------------------------------------------------------------------------------------------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin_watsaligram";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin_password123";

// ----------------------------------------------------------------------------------------------------
// مفتاح Gemini API
// ----------------------------------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// وظيفة لإنشاء الجداول إذا لم تكن موجودة (تأخذ Pool كمعامل)
async function createTables(pool) {
    try {
        // تحديث جدول users لإضافة user_project_id إذا لم يكن موجودًا
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                uid VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                custom_id VARCHAR(8) UNIQUE NOT NULL,
                profile_bg_url VARCHAR(255),
                is_verified BOOLEAN DEFAULT FALSE,
                user_role VARCHAR(50) DEFAULT 'normal',
                user_project_id VARCHAR(255)
            );
        `);
        if (pool === projectDbPools[BACKEND_DEFAULT_PROJECT_ID]) {
            try {
                await pool.query(`
                    ALTER TABLE users
                    ADD COLUMN IF NOT EXISTS user_project_id VARCHAR(255);
                `);
                console.log('تم التأكد من وجود العمود user_project_id في جدول users في المشروع الافتراضي.');
            } catch (alterError) {
                console.error('خطأ في إضافة العمود user_project_id:', alterError);
            }
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(255) PRIMARY KEY,
                author_id VARCHAR(255),
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
                post_id VARCHAR(255),
                user_id VARCHAR(255),
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
                admin_id VARCHAR(255),
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
                chat_id VARCHAR(255),
                sender_id VARCHAR(255),
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                sender_profile_bg VARCHAR(255)
            );

            CREATE TABLE IF NOT EXISTS followers (
                follower_id VARCHAR(255),
                followed_id VARCHAR(255),
                PRIMARY KEY (follower_id, followed_id)
            );

            CREATE TABLE IF NOT EXISTS video_playback_progress (
                user_id VARCHAR(255),
                post_id VARCHAR(255),
                position_seconds REAL NOT NULL,
                last_updated BIGINT NOT NULL,
                PRIMARY KEY (user_id, post_id)
            );
        `);
        console.log(`تم إنشاء الجداول الأساسية بنجاح للمشروع.`);

      // جداول التسويق
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved_seller BOOLEAN DEFAULT FALSE;`);
      await pool.query(`
          CREATE TABLE IF NOT EXISTS seller_applications (
              id VARCHAR(255) PRIMARY KEY,
              user_id VARCHAR(255) NOT NULL,
              details TEXT,
              image_urls JSONB,
              status VARCHAR(50) DEFAULT 'pending',
              created_at BIGINT NOT NULL
          );
      `);
      const createAdsTableQuery = `
          CREATE TABLE IF NOT EXISTS marketing_ads (
              id VARCHAR(255) PRIMARY KEY,
              title VARCHAR(255) NOT NULL,
              description TEXT,
              price VARCHAR(255),
              original_price VARCHAR(255),
              image_urls JSONB,
              ad_type VARCHAR(50),
              digital_product_type VARCHAR(50),
              digital_product_url VARCHAR(255),
              shipping_countries TEXT[],
              timestamp BIGINT NOT NULL,
              seller_id VARCHAR(255),
              is_pinned BOOLEAN DEFAULT FALSE,
              pin_expiry BIGINT,
              is_deal BOOLEAN DEFAULT FALSE,
              deal_expiry BIGINT,
              shipping_cost NUMERIC(10, 2) DEFAULT 0
          );
      `;
      await pool.query(createAdsTableQuery);
      await pool.query(`
          CREATE TABLE IF NOT EXISTS transactions (
              id VARCHAR(255) PRIMARY KEY,
              ad_id VARCHAR(255),
              buyer_id VARCHAR(255),
              seller_id VARCHAR(255),
              amount NUMERIC(10, 2) NOT NULL,
              currency VARCHAR(10) NOT NULL,
              commission NUMERIC(10, 2) NOT NULL,
              status VARCHAR(50) DEFAULT 'pending',
              payment_method VARCHAR(50),
              created_at BIGINT,
              updated_at BIGINT,
              shipping_address JSONB
          );
      `);
      await pool.query(`
          CREATE TABLE IF NOT EXISTS withdrawals (
              id VARCHAR(255) PRIMARY KEY,
              seller_id VARCHAR(255) NOT NULL,
              amount NUMERIC(10, 2) NOT NULL,
              method VARCHAR(50) NOT NULL,
              status VARCHAR(50) DEFAULT 'pending',
              withdrawal_details JSONB,
              created_at BIGINT NOT NULL,
              updated_at BIGINT
          );
      `);
      await pool.query(`
          CREATE TABLE IF NOT EXISTS wallets (
              user_id VARCHAR(255) PRIMARY KEY,
              pending_balance NUMERIC(10, 2) DEFAULT 0.00,
              available_balance NUMERIC(10, 2) DEFAULT 0.00,
              currency VARCHAR(10) DEFAULT 'USD',
              withdrawing_balance NUMERIC(10, 2) DEFAULT 0.00
          );
      `);
      await pool.query(`
          CREATE TABLE IF NOT EXISTS user_points (
              user_id VARCHAR(255) PRIMARY KEY,
              points INTEGER DEFAULT 0,
              last_updated BIGINT
          );
      `);
      console.log('تم التأكد من وجود جميع جداول التسويق.');

        // التحقق من وجود حساب المدير والبيانات الأولية (فقط في المشروع الافتراضي)
        if (pool === projectDbPools[BACKEND_DEFAULT_PROJECT_ID]) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    user_id VARCHAR(255) PRIMARY KEY,
                    subscription_info JSONB NOT NULL
                );
            `);
            console.log('تم التأكد من وجود جدول push_subscriptions.');

            const adminCheck = await pool.query('SELECT uid FROM users WHERE username = $1 AND user_role = $2', [ADMIN_USERNAME, 'admin']);
            if (adminCheck.rows.length === 0) {
                const adminUid = uuidv4();
                const adminCustomId = await generateCustomId(pool);
                await pool.query(
                    'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role, user_project_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [adminUid, ADMIN_USERNAME, ADMIN_PASSWORD, adminCustomId, true, 'admin', BACKEND_DEFAULT_PROJECT_ID]
                );
                console.log('تم إنشاء حساب المدير.');
            } else {
                console.log('حساب المدير موجود بالفعل.');
            }

            const botChatCheck = await pool.query('SELECT id FROM chats WHERE type = $1 AND name = $2', ['private', 'المساعدة']);
            if (botChatCheck.rows.length === 0) {
                const botUid = uuidv4();
                const botCustomId = 'BOT00001';
                const botUsername = 'المساعدة';
                await pool.query(
                    'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role, user_project_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [botUid, botUsername, uuidv4(), botCustomId, true, 'bot', BACKEND_DEFAULT_PROJECT_ID]
                );
                const botChatId = uuidv4();
                const timestamp = Date.now();
                const participantsArray = [botUid];
                const contactNamesObject = { [botUid]: 'المساعدة' };
                await pool.query(
                    `INSERT INTO chats (id, type, name, admin_id, participants, member_roles, last_message, timestamp, profile_bg_url, contact_names, send_permission)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [botChatId, 'private', 'المساعدة', null, JSON.stringify(participantsArray), JSON.stringify({}), null, timestamp, null, JSON.stringify(contactNamesObject), 'all']
                );
                console.log('تم إنشاء محادثة "المساعدة" (البوت).');
            } else {
                console.log('محادثة "المساعدة" (البوت) موجودة بالفعل.');
            }
        }
    } catch (err) {
        console.error('خطأ: فشل إنشاء الجداول أو البيانات الأولية:', err);
    }
}


// ----------------------------------------------------------------------------------------------------
// البرمجيات الوسيطة (Middleware)
// ----------------------------------------------------------------------------------------------------
app.use(cors());
app.use(bodyParser.json());

app.use('/api/*', async (req, res, next) => {
    if (req.is('multipart/form-data')) {
        return next();
    }
    
    let projectIdToUse = BACKEND_DEFAULT_PROJECT_ID;
    let userId = req.body.userId || req.query.userId || req.params.userId || req.headers['x-user-id'] || null;

    if (req.path === '/api/posts' && req.method === 'POST' && req.body.authorId) {
        userId = req.body.authorId;
    } else if (req.path === '/api/upload-profile-background' && req.method === 'POST' && req.body.userId) {
        userId = req.body.userId;
    } else if (req.path.startsWith('/api/chats/') && req.path.endsWith('/messages') && req.method === 'POST' && req.body.senderId) {
        userId = req.body.senderId;
    }

    if (userId) {
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            if (defaultPool) {
                const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
                if (userResult.rows.length > 0) {
                    if (userResult.rows[0].user_project_id) {
                        projectIdToUse = userResult.rows[0].user_project_id;
                    } else {
                        const assignedProjectId = projectIds[currentProjectIndex];
                        currentProjectIndex = (currentProjectIndex + 1) % projectIds.length;
                        await defaultPool.query('UPDATE users SET user_project_id = $1 WHERE uid = $2', [assignedProjectId, userId]);
                        projectIdToUse = assignedProjectId;
                    }
                }
            }
        } catch (error) {
            console.error("خطأ في جلب أو تعيين معرف مشروع المستخدم في البرمجية الوسيطة:", error);
        }
    }

    if (!projectDbPools[projectIdToUse] || !projectSupabaseClients[projectIdToUse]) {
        console.error(`خطأ: معرف المشروع ${projectIdToUse} غير صالح أو غير مهيأ.`);
        return res.status(500).json({ error: 'خطأ في تهيئة الخادم: معرف المشروع غير صالح.' });
    }

    req.dbPool = projectDbPools[projectIdToUse];
    req.supabase = projectSupabaseClients[projectIdToUse];
    req.currentProjectId = projectIdToUse;
    next();
});

// ----------------------------------------------------------------------------------------------------
// وظائف المساعدة (Helper Functions)
// ----------------------------------------------------------------------------------------------------
async function getUserProjectContext(userId) {
    let projectId = BACKEND_DEFAULT_PROJECT_ID;
    if (userId) {
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
            if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                projectId = userResult.rows[0].user_project_id;
            } else {
                console.warn(`تحذير: لم يتم العثور على مشروع للمستخدم ${userId}. سيتم استخدام المشروع الافتراضي.`);
            }
        } catch (error) {
            console.error(`خطأ في جلب معرف المشروع للمستخدم ${userId}:`, error);
        }
    }

    if (!projectDbPools[projectId] || !projectSupabaseClients[projectId]) {
        console.error(`خطأ: معرف المشروع ${projectId} غير صالح أو غير مهيأ. سيتم الرجوع إلى المشروع الافتراضي.`);
        projectId = BACKEND_DEFAULT_PROJECT_ID;
    }

    return {
        pool: projectDbPools[projectId],
        supabase: projectSupabaseClients[projectId],
        projectId: projectId
    };
}

async function generateCustomId(pool) {
    let id;
    let userExists = true;
    while (userExists) {
        id = Math.floor(10000000 + Math.random() * 90000000).toString();
        const res = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [id]);
        userExists = res.rows.length > 0;
    }
    return id;
}

async function getUserDetailsFromDefaultProject(userId) {
    const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    if (!defaultPool) {
        console.error("Default project pool not initialized.");
        return null;
    }
    try {
        const userResult = await defaultPool.query(
            'SELECT username, is_verified, user_role, profile_bg_url FROM users WHERE uid = $1',
            [userId]
        );
        return userResult.rows[0] || null;
    } catch (error) {
        console.error(`خطأ في جلب تفاصيل المستخدم ${userId} من المشروع الافتراضي:`, error);
        return null;
    }
}

async function getPostsFromSinglePool(pool, baseQuery, initialQueryParams) {
    const fullQuery = `
        SELECT p.*,
        (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes))
         FROM comments c WHERE c.post_id = p.id) AS comments_raw
        FROM posts p
        ${baseQuery}
        ORDER BY p.is_pinned DESC, p.timestamp DESC
    `;
    const result = await pool.query(fullQuery, [...initialQueryParams]);
    return result.rows;
}

async function getPostsFromAllProjects(baseQuery, initialQueryParams, userIdForPlayback = null) {
    let allRawPosts = [];
    for (const projectId in projectDbPools) {
        try {
            const postsFromProject = await getPostsFromSinglePool(projectDbPools[projectId], baseQuery, initialQueryParams);
            allRawPosts = allRawPosts.concat(postsFromProject);
        } catch (error) {
            console.error(`خطأ في جلب المنشورات الخام من المشروع ${projectId}:`, error);
        }
    }

    const enrichedPosts = await Promise.all(allRawPosts.map(async row => {
        const authorDetails = await getUserDetailsFromDefaultProject(row.author_id);
        
        let playbackPosition = 0;
        if (userIdForPlayback && row.media_type === 'video') {
            try {
                const playbackResult = await projectDbPools[BACKEND_DEFAULT_PROJECT_ID].query(
                    'SELECT position_seconds FROM video_playback_progress WHERE user_id = $1 AND post_id = $2',
                    [userIdForPlayback, row.id]
                );
                if (playbackResult.rows.length > 0) {
                    playbackPosition = playbackResult.rows[0].position_seconds;
                }
            } catch (error) {
                console.error(`خطأ في جلب موضع التشغيل للمنشور ${row.id}:`, error);
            }
        }

        const commentsWithUserDetails = await Promise.all((row.comments_raw || []).map(async comment => {
            const commentUserDetails = await getUserDetailsFromDefaultProject(comment.userId);
            return {
                ...comment,
                userProfileBg: commentUserDetails ? commentUserDetails.profile_bg_url : null,
                isVerified: commentUserDetails ? commentUserDetails.is_verified : false
            };
        }));
        
        let authorFollowersCount = 0;
        try {
            const followersResult = await projectDbPools[BACKEND_DEFAULT_PROJECT_ID].query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [row.author_id]);
            authorFollowersCount = parseInt(followersResult.rows[0].count);
        } catch (error) {
            console.error(`خطأ في جلب عدد المتابعين للمؤلف ${row.author_id}:`, error);
        }

        return {
            id: row.id,
            authorId: row.author_id,
            authorName: authorDetails ? authorDetails.username : 'Unknown User',
            text: row.text,
            timestamp: parseInt(row.timestamp),
            likes: row.likes,
            comments: commentsWithUserDetails,
            views: row.views,
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            authorProfileBg: authorDetails ? authorDetails.profile_bg_url : null,
            authorFollowersCount: authorFollowersCount,
            playbackPosition: playbackPosition,
            isPinned: row.is_pinned,
            authorIsVerified: authorDetails ? authorDetails.is_verified : false,
            authorUserRole: authorDetails ? authorDetails.user_role : 'normal'
        };
    }));

    enrichedPosts.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.timestamp - a.timestamp;
    });

    return enrichedPosts;
}

async function getPostFromAnyProject(postId) {
    for (const projectId in projectDbPools) {
        try {
            const result = await projectDbPools[projectId].query('SELECT * FROM posts WHERE id = $1', [postId]);
            if (result.rows.length > 0) {
                return { post: result.rows[0], pool: projectDbPools[projectId], projectId: projectId };
            }
        } catch (error) {
            console.error(`خطأ في البحث عن المنشور ${postId} في المشروع ${projectId}:`, error);
        }
    }
    return null;
}

async function getChatFromDefaultProject(chatId) {
    const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    if (!defaultPool) return null;
    try {
        const chatResult = await defaultPool.query('SELECT * FROM chats WHERE id = $1', [chatId]);
        return chatResult.rows[0] || null;
    } catch (error) {
        console.error(`خطأ في جلب المحادثة ${chatId} من المشروع الافتراضي:`, error);
        return null;
    }
}

// ----------------------------------------------------------------------------------------------------
// نقاط نهاية API
// ----------------------------------------------------------------------------------------------------
// ... (كل نقاط النهاية الخاصة بك تأتي هنا، بدون أي تغيير)
// ... (app.post('/api/register', ...))
// ... (app.post('/api/login', ...))
// ... (وهكذا لجميع نقاط النهاية)
// ...
// ----------------------------------------------------------------------------------------------------


// NEW: Import and use marketing routes
const marketingRoutes = require('./marketingRoutes.js'); 
app.use('/api/marketing', marketingRoutes(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID, sendOneSignalNotification, FRONTEND_URL, stripe));

// ==== بداية كود نقطة نهاية حفظ اشتراك الإشعارات ====
app.post('/api/subscribe', async (req, res) => {
    const { subscription, userId } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; 

    if (!subscription || !userId) {
        return res.status(400).json({ error: 'Subscription and userId are required.' });
    }

    try {
        await pool.query(
            `INSERT INTO push_subscriptions (user_id, subscription_info) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET subscription_info = EXCLUDED.subscription_info`,
            [userId, JSON.stringify(subscription)]
        );
        console.log(`تم حفظ/تحديث اشتراك الإشعارات للمستخدم: ${userId}`);
        res.status(201).json({ message: 'Subscription saved successfully.' });
    } catch (error) {
        console.error('Error saving subscription:', error);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});
// ==== نهاية كود نقطة نهاية حفظ اشتراك الإشعارات ====

// Webhook endpoint for Stripe
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`❌ Stripe webhook signature error:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { transaction_id, ad_id, pin_details } = session.metadata;

        console.log(`✅ Stripe payment successful for session: ${session.id}`);

        if (transaction_id) {
            try {
                let transaction, transactionPool;
                for (const projectId in projectDbPools) {
                    const pool = projectDbPools[projectId];
                    const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transaction_id]);
                    if (result.rows.length > 0) {
                        transaction = result.rows[0];
                        transactionPool = pool;
                        break;
                    }
                }

                if (transaction && transaction.status === 'awaiting_payment') {
                    await transactionPool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['pending', transaction_id]);
                    console.log(`Transaction ${transaction_id} updated to 'pending' after Stripe payment.`);
                }
            } catch (error) {
                console.error(`Error updating transaction status for ${transaction_id}:`, error);
            }
        } else if (pin_details) {
            const { adId, hours } = JSON.parse(pin_details);
             try {
                let adPool;
                for (const projectId in projectDbPools) {
                    const pool = projectDbPools[projectId];
                    const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                     if (adResult.rows.length > 0) {
                        adPool = pool;
                        break;
                    }
                }
                 if (adPool) {
                    const expiry = Date.now() + (parseInt(hours, 10) * 3600000);
                    await adPool.query('UPDATE marketing_ads SET is_pinned = TRUE, pin_expiry = $1 WHERE id = $2', [expiry, adId]);
                    console.log(`Ad ${adId} has been pinned for ${hours} hours via Stripe payment.`);
                }
            } catch (error) {
                console.error(`Error pinning ad ${adId} after Stripe payment:`, error);
            }
        }
    }

    res.json({received: true});
});



// !! تعديل هام لـ Vercel !!
// Vercel يتطلب تصدير التطبيق بدلاً من الاستماع على منفذ.
module.exports = app;
