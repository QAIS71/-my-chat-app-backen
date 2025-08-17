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

// تهيئة تطبيق Express
const app = express();
const port = process.env.PORT || 3000; // استخدام المنفذ المحدد بواسطة البيئة (مثلاً Render) أو المنفذ 3000 افتراضياً

// ==== بداية كود إعداد الإشعارات ====
const publicVapidKey = 'BBlbt3D5lIiDN7xEbe4FfEA7ipXGsv0_fbP5xawOR3-5R7FxT9KNh_tUXklvENkADLYiv_2V8xPmncl8IcaaTIM';
const privateVapidKey = '03sShkGPnA_dYhcGL45wXj0YJWBLweuMyMfhOWLoWOw';

webPush.setVapidDetails(
  'mailto:your-email@example.com', // يمكنك وضع بريدك الإلكتروني هنا
  publicVapidKey,
  privateVapidKey
);
// ==== نهاية كود إعداد الإشعارات ====


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
// هذا هو معرف المشروع الذي سيستخدمه الخادم الخلفي لعمليات مثل تسجيل المستخدمين الجدد
// أو العمليات التي لا تتطلب تحديد مشروع مستخدم معين.
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
                    rejectUnauthorized: false // مطلوب لـ Render PostgreSQL (إذا لم يكن لديك شهادة SSL موثوقة)
                }
            });
            await projectDbPools[projectId].connect(); // اختبار الاتصال
            console.log(`تم تهيئة PostgreSQL Pool للمشروع: ${projectId}`);

            // تهيئة عميل Supabase (للتخزين والمصادقة من الخلفية)
            projectSupabaseClients[projectId] = createClient(
                config.projectUrl,
                config.serviceRoleKey,
                {
                    auth: {
                        persistSession: false, // لا نحتاج إلى جلسات مستمرة في الخلفية
                        autoRefreshToken: false,
                        detectSessionInUrl: false
                    }
                }
            );
            console.log(`تم تهيئة عميل Supabase للمشروع: ${projectId}. المفتاح يبدأ بـ: ${config.serviceRoleKey.substring(0, 10)}...`); // لتأكيد قراءة المفتاح

            // إنشاء الجداول لهذا المشروع
            await createTables(projectDbPools[projectId]);

        } catch (error) {
            console.error(`خطأ: فشل تهيئة Supabase أو PostgreSQL للمشروع ${projectId}:`, error);
            // يمكنك اختيار إيقاف الخادم هنا إذا كان المشروع ضروريًا للعمل
            // process.exit(1);
        }
    }
}

// ----------------------------------------------------------------------------------------------------
// إعدادات المدير (Admin) - **هام: قم بتغيير هذه القيم في بيئة الإنتاج أو استخدم متغيرات البيئة**
// ----------------------------------------------------------------------------------------------------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin_watsaligram"; // اسم مستخدم المدير
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin_password123"; // كلمة مرور المدير

// ----------------------------------------------------------------------------------------------------
// مفتاح Gemini API - **هام: يجب تعيينه كمتغير بيئة في Render**
// ----------------------------------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // قم بتعيين هذا في متغيرات بيئة Render

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
                user_project_id VARCHAR(255) -- **جديد: لتخزين معرف المشروع المخصص للمستخدم**
            );
        `);
        // تأكد من وجود العمود user_project_id في جدول users
        // هذا ALTER TABLE سيضيف العمود إذا لم يكن موجودًا بالفعل
        // يجب أن يتم هذا فقط للمشروع الافتراضي
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
                author_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
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
                post_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن posts قد يكون في مشروع آخر
                user_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
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
                admin_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
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
                chat_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن chats في مشروع آخر
                sender_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
                sender_name VARCHAR(255) NOT NULL,
                text TEXT,
                timestamp BIGINT NOT NULL,
                media_url VARCHAR(255),
                media_type VARCHAR(50),
                sender_profile_bg VARCHAR(255)
            );

            CREATE TABLE IF NOT EXISTS followers (
                follower_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
                followed_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
                PRIMARY KEY (follower_id, followed_id)
            );

            CREATE TABLE IF NOT EXISTS video_playback_progress (
                user_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن users في مشروع آخر
                post_id VARCHAR(255), -- لا يوجد REFERENCES هنا لأن posts قد يكون في مشروع آخر
                position_seconds REAL NOT NULL,
                last_updated BIGINT NOT NULL,
                PRIMARY KEY (user_id, post_id)
            );
        `);
        console.log(`تم إنشاء الجداول بنجاح (إذا لم تكن موجودة بالفعل) للمشروع: ${pool === projectDbPools[BACKEND_DEFAULT_PROJECT_ID] ? 'الافتراضي' : 'غير الافتراضي'}.`);

        // NEW: Create marketing_ads table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS marketing_ads (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                price VARCHAR(255),
                image_url VARCHAR(255),
                is_pinned BOOLEAN DEFAULT FALSE, -- This is the corrected line
                ad_type VARCHAR(50), 
                timestamp BIGINT NOT NULL,
                seller_id VARCHAR(255) 
            );
        `);
        console.log('تم التأكد من وجود جدول marketing_ads.');

        // التحقق من وجود حساب المدير، وإنشائه إذا لم يكن موجوداً (فقط في المشروع الافتراضي)
        if (pool === projectDbPools[BACKEND_DEFAULT_PROJECT_ID]) {
            // ==== بداية كود إضافة جدول الإشعارات ====
            await pool.query(`
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    user_id VARCHAR(255) PRIMARY KEY,
                    subscription_info JSONB NOT NULL
                );
            `);
            console.log('تم التأكد من وجود جدول push_subscriptions.');
            // ==== نهاية كود إضافة جدول الإشعارات ====

            const adminCheck = await pool.query('SELECT uid FROM users WHERE username = $1 AND user_role = $2', [ADMIN_USERNAME, 'admin']);
            if (adminCheck.rows.length === 0) {
                const adminUid = uuidv4();
                const adminCustomId = await generateCustomId(pool); // تمرير pool
                // تعيين معرف المشروع للمدير إلى المشروع الافتراضي
                await pool.query(
                    'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role, user_project_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [adminUid, ADMIN_USERNAME, ADMIN_PASSWORD, adminCustomId, true, 'admin', BACKEND_DEFAULT_PROJECT_ID]
                );
                console.log('تم إنشاء حساب المدير:', ADMIN_USERNAME, 'UID:', adminUid, 'معرف مخصص:', adminCustomId, 'معرف المشروع:', BACKEND_DEFAULT_PROJECT_ID);
            } else {
                console.log('حساب المدير موجود بالفعل.');
            }

            // التأكد من وجود محادثة "المساعدة" (البوت)
            const botChatCheck = await pool.query('SELECT id FROM chats WHERE type = $1 AND name = $2', ['private', 'المساعدة']);
            if (botChatCheck.rows.length === 0) {
                const botUid = uuidv4(); // معرف فريد للبوت
                const botCustomId = 'BOT00001'; // معرف مخصص للبوت
                const botUsername = 'المساعدة';

                // إنشاء حساب للبوت في جدول المستخدمين (في المشروع الافتراضي)
                await pool.query(
                    'INSERT INTO users (uid, username, password, custom_id, is_verified, user_role, user_project_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [botUid, botUsername, uuidv4(), botCustomId, true, 'bot', BACKEND_DEFAULT_PROJECT_ID] // البوت موثق ودوره 'bot'
                );

                const botChatId = uuidv4();
                const timestamp = Date.now();
                const participantsArray = [botUid]; // البوت هو المشارك الوحيد في هذه المحادثة من جانب قاعدة البيانات
                const contactNamesObject = { [botUid]: 'المساعدة' }; // اسم جهة الاتصال للبوت نفسه

                await pool.query(
                    `INSERT INTO chats (id, type, name, admin_id, participants, member_roles, last_message, timestamp, profile_bg_url, contact_names, send_permission)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [botChatId, 'private', 'المساعدة', null, JSON.stringify(participantsArray), JSON.stringify({}), null, timestamp, null, JSON.stringify(contactNamesObject), 'all']
                );
                console.log('تم إنشاء محادثة "المساعدة" (البوت) بمعرف UID:', botUid, 'معرف المحادثة:', botChatId);
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

// تمكين CORS لجميع الطلبات (Netlify Proxy سيتعامل مع الباقي)
app.use(cors());

// تحليل نصوص JSON في طلبات HTTP
app.use(bodyParser.json());

// برمجية وسيطة لتحديد المشروع بناءً على المستخدم أو العملية
// ملاحظة: هذه البرمجية الوسيطة لن تعمل بشكل صحيح لطلبات `multipart/form-data` (رفع الملفات)
// لأن `req.body` لن يكون متاحًا. سيتم التعامل مع هذا بشكل خاص في نقاط النهاية الخاصة بالرفع.
app.use('/api/*', async (req, res, next) => {
    // تخطي هذه البرمجية الوسيطة لطلبات رفع الملفات، سيتم التعامل معها في نقطة النهاية نفسها
    if (req.is('multipart/form-data')) {
        return next();
    }
    
    let projectIdToUse = BACKEND_DEFAULT_PROJECT_ID; // المشروع الافتراضي للعمليات العامة أو غير الموثقة
    let userId = null; // تهيئة userId إلى null

    // محاولة استخراج معرف المستخدم من أماكن مختلفة في الطلب
    if (req.body.userId) {
        userId = req.body.userId;
    } else if (req.query.userId) {
        userId = req.query.userId;
    } else if (req.params.userId) {
        userId = req.params.userId;
    } else if (req.headers['x-user-id']) {
        userId = req.headers['x-user-id'];
    }

    // معالجة خاصة لنقاط النهاية التي تستخدم معرف مستخدم مختلف في الجسم
    if (req.path === '/api/posts' && req.method === 'POST' && req.body.authorId) {
        userId = req.body.authorId;
    } else if (req.path === '/api/upload-profile-background' && req.method === 'POST' && req.body.userId) {
        userId = req.body.userId;
    } else if (req.path.startsWith('/api/chats/') && req.path.endsWith('/messages') && req.method === 'POST' && req.body.senderId) {
        userId = req.body.senderId;
    }

    // إذا لم يتم تحديد userId، فسنستخدم المشروع الافتراضي
    if (!userId) {
        projectIdToUse = BACKEND_DEFAULT_PROJECT_ID;
    } else {
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            if (defaultPool) {
                const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
                if (userResult.rows.length > 0) {
                    if (userResult.rows[0].user_project_id) {
                        projectIdToUse = userResult.rows[0].user_project_id;
                    } else {
                        // المستخدم موجود ولكن user_project_id فارغ (مستخدم قديم)
                        const assignedProjectId = projectIds[currentProjectIndex];
                        currentProjectIndex = (currentProjectIndex + 1) % projectIds.length;
                        await defaultPool.query('UPDATE users SET user_project_id = $1 WHERE uid = $2', [assignedProjectId, userId]);
                        projectIdToUse = assignedProjectId;
                    }
                } else {
                    // المستخدم غير موجود في جدول المستخدمين بالمشروع الافتراضي
                    projectIdToUse = BACKEND_DEFAULT_PROJECT_ID;
                }
            } else {
                projectIdToUse = BACKEND_DEFAULT_PROJECT_ID; // الرجوع إلى الافتراضي في حالة وجود خطأ
            }
        } catch (error) {
            console.error("خطأ في جلب أو تعيين معرف مشروع المستخدم في البرمجية الوسيطة:", error);
            projectIdToUse = BACKEND_DEFAULT_PROJECT_ID; // الرجوع إلى الافتراضي في حالة وجود خطأ في قاعدة البيانات
        }
    }

    // التحقق من أن Pool وعميل Supabase للمشروع المحدد مهيئان
    if (!projectDbPools[projectIdToUse] || !projectSupabaseClients[projectIdToUse]) {
        console.error(`خطأ: معرف المشروع ${projectIdToUse} غير صالح أو غير مهيأ.`);
        return res.status(500).json({ error: 'خطأ في تهيئة الخادم: معرف المشروع غير صالح.' });
    }

    // تعيين Pool وعميل Supabase للطلب الحالي
    req.dbPool = projectDbPools[projectIdToUse];
    req.supabase = projectSupabaseClients[projectIdToUse];
    req.currentProjectId = projectIdToUse; // لتمرير معرف المشروع إلى نقاط النهاية إذا لزم الأمر
    next();
});

// ----------------------------------------------------------------------------------------------------
// وظائف المساعدة (Helper Functions)
// ----------------------------------------------------------------------------------------------------

// **جديد**: وظيفة مساعدة للحصول على سياق المشروع الصحيح (Pool و Supabase Client) للمستخدم
async function getUserProjectContext(userId) {
    let projectId = BACKEND_DEFAULT_PROJECT_ID; // القيمة الافتراضية
    if (userId) {
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
            if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                projectId = userResult.rows[0].user_project_id;
            } else {
                 // في حالة عدم العثور على المستخدم أو عدم وجود معرف مشروع، استخدم المشروع الافتراضي
                console.warn(`تحذير: لم يتم العثور على مشروع للمستخدم ${userId}. سيتم استخدام المشروع الافتراضي.`);
                projectId = BACKEND_DEFAULT_PROJECT_ID;
            }
        } catch (error) {
            console.error(`خطأ في جلب معرف المشروع للمستخدم ${userId}:`, error);
            // الرجوع إلى الافتراضي في حالة وجود خطأ
            projectId = BACKEND_DEFAULT_PROJECT_ID;
        }
    }

    // التحقق من أن المشروع المحدد صالح ومهيأ
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

// وظيفة لإنشاء معرف مستخدم فريد مكون من 8 أرقام (تأخذ Pool كمعامل)
async function generateCustomId(pool) {
    let id;
    let userExists = true;
    while (userExists) {
        id = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 أرقام
        const res = await pool.query('SELECT 1 FROM users WHERE custom_id = $1', [id]);
        userExists = res.rows.length > 0;
    }
    return id;
}

// وظيفة مساعدة لجلب تفاصيل المستخدم من المشروع الافتراضي (حيث يوجد جدول المستخدمين)
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

// وظيفة لجلب المنشورات من قاعدة بيانات واحدة (بدون JOIN لجدول المستخدمين)
async function getPostsFromSinglePool(pool, baseQuery, initialQueryParams) {
    let selectClause = `
        p.*,
        (SELECT json_agg(json_build_object('id', c.id, 'userId', c.user_id, 'username', c.username, 'text', c.text, 'timestamp', c.timestamp, 'userProfileBg', c.user_profile_bg, 'likes', c.likes))
         FROM comments c WHERE c.post_id = p.id) AS comments_raw
    `;

    let joinClause = ``; // لا يوجد JOIN لجدول المستخدمين هنا
    let finalQueryParams = [...initialQueryParams];

    const fullQuery = `
        SELECT ${selectClause}
        FROM posts p
        ${joinClause}
        ${baseQuery}
        ORDER BY p.is_pinned DESC, p.timestamp DESC
    `;

    const result = await pool.query(fullQuery, finalQueryParams);
    return result.rows; // إرجاع الصفوف الخام، معالجة تفاصيل المستخدم عالمياً
}

// وظيفة لجلب المنشورات من جميع المشاريع وإثرائها بتفاصيل المستخدم
async function getPostsFromAllProjects(baseQuery, initialQueryParams, userIdForPlayback = null) {
    let allRawPosts = [];
    for (const projectId in projectDbPools) {
        const pool = projectDbPools[projectId];
        try {
            const postsFromProject = await getPostsFromSinglePool(pool, baseQuery, initialQueryParams);
            allRawPosts = allRawPosts.concat(postsFromProject);
        } catch (error) {
            console.error(`خطأ في جلب المنشورات الخام من المشروع ${projectId}:`, error);
        }
    }

    // الآن قم بإثراء المنشورات بتفاصيل المستخدم وموضع التشغيل
    const enrichedPosts = await Promise.all(allRawPosts.map(async row => {
        const authorDetails = await getUserDetailsFromDefaultProject(row.author_id);
        
        // جلب موضع التشغيل إذا تم توفير userIdForPlayback
        let playbackPosition = 0;
        if (userIdForPlayback && row.media_type === 'video') {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            try {
                const playbackResult = await defaultPool.query(
                    'SELECT position_seconds FROM video_playback_progress WHERE user_id = $1 AND post_id = $2',
                    [userIdForPlayback, row.id]
                );
                if (playbackResult.rows.length > 0) {
                    playbackPosition = playbackResult.rows[0].position_seconds;
                }
            } catch (error) {
                console.error(`خطأ في جلب موضع التشغيل للمنشور ${row.id} والمستخدم ${userIdForPlayback}:`, error);
            }
        }

        // إثراء التعليقات بتفاصيل المستخدم
        const commentsWithUserDetails = await Promise.all((row.comments_raw || []).map(async comment => {
            const commentUserDetails = await getUserDetailsFromDefaultProject(comment.userId);
            return {
                ...comment,
                userProfileBg: commentUserDetails ? commentUserDetails.profile_bg_url : null,
                isVerified: commentUserDetails ? commentUserDetails.is_verified : false
            };
        }));

        // جلب عدد المتابعين للمؤلف
        let authorFollowersCount = 0;
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        try {
            const followersResult = await defaultPool.query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [row.author_id]);
            authorFollowersCount = parseInt(followersResult.rows[0].count);
        } catch (error) {
            console.error(`خطأ في جلب عدد المتابعين للمؤلف ${row.author_id}:`, error);
        }


        return {
            id: row.id,
            authorId: row.author_id,
            authorName: authorDetails ? authorDetails.username : 'Unknown User', // اسم احتياطي
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

    // الفرز النهائي بعد الدمج والإثراء
    enrichedPosts.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.timestamp - a.timestamp;
    });

    return enrichedPosts;
}

// وظيفة لجلب منشور واحد من أي مشروع
async function getPostFromAnyProject(postId) {
    for (const projectId in projectDbPools) {
        const pool = projectDbPools[projectId];
        try {
            const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
            if (result.rows.length > 0) {
                return { post: result.rows[0], pool: pool, projectId: projectId };
            }
        } catch (error) {
            console.error(`خطأ في البحث عن المنشور ${postId} في المشروع ${projectId}:`, error);
        }
    }
    return null; // المنشور غير موجود في أي مشروع
}

// وظيفة لجلب محادثة واحدة من المشروع الافتراضي
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
// نقاط نهاية API - تم تعديلها للعمل مع PostgreSQL و Supabase
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية تسجيل المستخدم
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    // نستخدم Pool المشروع الافتراضي لتسجيل المستخدمين الجدد
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    if (!username || !password) {
        return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
    }

    try {
        const existingUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل.' });
        }

        const uid = uuidv4();
        const customId = await generateCustomId(pool);

        const userRole = (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) ? 'admin' : 'normal';
        const isVerified = (userRole === 'admin');

        // **جديد: تعيين معرف المشروع للمستخدم بنظام الدورة**
        const assignedProjectId = projectIds[currentProjectIndex];
        currentProjectIndex = (currentProjectIndex + 1) % projectIds.length; // الانتقال للمشروع التالي

        await pool.query(
            'INSERT INTO users (uid, username, password, custom_id, profile_bg_url, is_verified, user_role, user_project_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [uid, username, password, customId, null, isVerified, userRole, assignedProjectId]
        );

        console.log('تم تسجيل المستخدم:', username, 'UID:', uid, 'معرف مخصص:', customId, 'الدور:', userRole, 'معرف المشروع المخصص:', assignedProjectId);
        res.status(201).json({ message: 'تم التسجيل بنجاح.', user: { uid, username, customId, profileBg: null, isVerified, userRole, userProjectId: assignedProjectId } });
    } catch (error) {
        console.error('خطأ: فشل تسجيل المستخدم:', error);
        res.status(500).json({ error: 'فشل التسجيل.' });
    }
});

// نقطة نهاية تسجيل الدخول
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    // نستخدم Pool المشروع الافتراضي لجلب معلومات تسجيل الدخول (لأن المستخدمين موجودون هنا)
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url, password, is_verified, user_role, user_project_id FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
        }

        console.log('تم تسجيل دخول المستخدم:', user.username, 'الدور:', user.user_role, 'معرف المشروع المخصص:', user.user_project_id);
        res.status(200).json({ message: 'تم تسجيل الدخول بنجاح.', user: { uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url, isVerified: user.is_verified, userRole: user.user_role, userProjectId: user.user_project_id } });
    } catch (error) {
        console.error('خطأ: فشل تسجيل دخول المستخدم:', error);
        res.status(500).json({ error: 'فشل تسجيل الدخول.' });
    }
});

// نقطة نهاية للحصول على معلومات المستخدم بواسطة customId
app.get('/api/user/by-custom-id/:customId', async (req, res) => {
    const { customId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب معلومات المستخدم (لأن المستخدمين موجودون هنا)
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    try {
        const result = await pool.query('SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role, user_project_id FROM users WHERE custom_id = $1', [customId]);
        const user = result.rows[0];
        if (user) {
            res.status(200).json({ uid: user.uid, username: user.username, customId: user.custom_id, profileBg: user.profile_bg_url, isVerified: user.is_verified, userRole: user.user_role, userProjectId: user.user_project_id });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود.' });
        }
    } catch (error) {
        console.error('خطأ: فشل جلب معلومات المستخدم بواسطة المعرف المخصص:', error);
        res.status(500).json({ error: 'فشل جلب معلومات المستخدم.' });
    }
});

// نقطة نهاية لتوثيق حساب المستخدم (للمدير فقط)
app.put('/api/admin/verify-user/:customId', async (req, res) => {
    const { customId } = req.params;
    const { isVerified, callerUid } = req.body;
    // نستخدم Pool المشروع الافتراضي لأن معلومات المستخدمين موجودة هنا
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    try {
        const adminUser = await pool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (!adminUser.rows[0] || adminUser.rows[0].user_role !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لتوثيق المستخدمين.' });
        }

        const targetUserUpdate = await pool.query(
            'UPDATE users SET is_verified = $1 WHERE custom_id = $2 RETURNING username, custom_id',
            [isVerified, customId]
        );

        if (targetUserUpdate.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم المستهدف غير موجود.' });
        }

        const updatedUser = targetUserUpdate.rows[0];
        res.status(200).json({ message: `تم ${isVerified ? 'توثيق' : 'إلغاء توثيق'} المستخدم ${updatedUser.username} (${updatedUser.custom_id}) بنجاح.`, user: updatedUser });
    } catch (error) {
        console.error('خطأ: فشل توثيق المستخدم:', error);
        res.status(500).json({ error: 'فشل عملية التوثيق.' });
    }
});

// نقطة نهاية لرفع خلفية الملف الشخصي
app.post('/api/upload-profile-background', upload.single('file'), async (req, res) => {
    const { userId } = req.body;
    const uploadedFile = req.file;
    const bucketName = 'profile-backgrounds';

    if (!userId || !uploadedFile) {
        console.error('خطأ: معرف المستخدم والملف مطلوبان لرفع خلفية الملف الشخصي.');
        return res.status(400).json({ error: 'معرف المستخدم والملف مطلوبان.' });
    }
    
    // **تعديل**: احصل على سياق المشروع الصحيح للمستخدم بعد أن يقوم multer بتحليل الجسم
    const { supabase, projectId } = await getUserProjectContext(userId);
    req.currentProjectId = projectId; // تحديث معرف المشروع الحالي للتسجيل

    try {
        // التحقق من وجود المستخدم في المشروع الافتراضي (حيث يتم تخزين معلومات المستخدمين)
        const userCheckPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const userResult = await userCheckPool.query('SELECT 1 FROM users WHERE uid = $1', [userId]);
        if (userResult.rows.length === 0) {
            console.error(`خطأ: المستخدم ${userId} غير موجود لرفع خلفية الملف الشخصي.`);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const fileExtension = uploadedFile.originalname.split('.').pop();
        const fileName = `${uuidv4()}.${fileExtension}`;
        const filePath = `${userId}/${fileName}`;

        console.log(`محاولة تحميل ملف خلفية الملف الشخصي إلى المشروع ${req.currentProjectId}، Bucket: ${bucketName}, المسار: ${filePath}`);
        const { data, error: uploadError } = await supabase.storage // **استخدم supabase الصحيح**
            .from(bucketName)
            .upload(filePath, uploadedFile.buffer, {
                contentType: uploadedFile.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('خطأ: فشل تحميل الملف إلى Supabase Storage:', uploadError);
            console.error('تفاصيل خطأ Supabase:', uploadError.statusCode, uploadError.error, uploadError.message);
            return res.status(500).json({ error: 'فشل تحميل الملف إلى التخزين.' });
        }

        const { data: publicUrlData } = supabase.storage // **استخدم supabase الصحيح**
            .from(bucketName)
            .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error('خطأ: فشل الحصول على الرابط العام للملف الذي تم تحميله.');
            return res.status(500).json({ error: 'فشل الحصول على رابط الملف العام.' });
        }

        const mediaUrl = publicUrlData.publicUrl;

        // تحديث profile_bg_url في جدول users في المشروع الافتراضي
        await userCheckPool.query('UPDATE users SET profile_bg_url = $1 WHERE uid = $2', [mediaUrl, userId]);

        console.log(`تم تحميل خلفية الملف الشخصي للمستخدم ${userId} في المشروع ${req.currentProjectId}: ${mediaUrl}`);
        res.status(200).json({ message: 'تم تحميل الخلفية بنجاح.', url: mediaUrl });
    } catch (error) {
        console.error('خطأ: فشل تحميل خلفية الملف الشخصي أو تحديث قاعدة البيانات:', error);
        res.status(500).json({ error: 'فشل تحميل الخلفية.' });
    }
});

// نقطة نهاية للحصول على عدد متابعي مستخدم معين
app.get('/api/user/:userId/followers/count', async (req, res) => {
    const { userId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب عدد المتابعين (لأن جدول المتابعين موجود هنا)
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    try {
        const result = await pool.query('SELECT COUNT(*) FROM followers WHERE followed_id = $1', [userId]);
        const followerCount = parseInt(result.rows[0].count);
        res.status(200).json({ count: followerCount });
    } catch (error) {
        console.error('خطأ: فشل جلب عدد المتابعين:', error);
        res.status(500).json({ error: 'فشل جلب عدد المتابعين.' });
    }
});

// نقطة نهاية للحصول على حالة المتابعة بين مستخدمين
app.get('/api/user/:followerId/following/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب حالة المتابعة
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    try {
        const result = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
        const isFollowing = result.rows.length > 0;
        res.status(200).json({ isFollowing });
    } catch (error) {
        console.error('خطأ: فشل جلب حالة المتابعة:', error);
        res.status(500).json({ error: 'فشل جلب حالة المتابعة.' });
    }
});

// نقطة نهاية للمتابعة/إلغاء المتابعة
app.post('/api/user/:followerId/follow/:followedId', async (req, res) => {
    const { followerId, followedId } = req.params;
    // نستخدم Pool المشروع الافتراضي لعمليات المتابعة
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    if (followerId === followedId) {
        return res.status(400).json({ error: 'لا يمكنك متابعة نفسك.' });
    }

    try {
        const followerUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followerId]);
        const followedUserResult = await pool.query('SELECT 1 FROM users WHERE uid = $1', [followedId]);

        if (followerUserResult.rows.length === 0 || followedUserResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم (المتابع أو المتابع) غير موجود.' });
        }

        const existingFollow = await pool.query('SELECT 1 FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);

        let message;
        let isFollowing;
        if (existingFollow.rows.length > 0) {
            await pool.query('DELETE FROM followers WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
            message = 'تم إلغاء المتابعة بنجاح.';
            isFollowing = false;
        } else {
            await pool.query('INSERT INTO followers (follower_id, followed_id) VALUES ($1, $2)', [followerId, followedId]);
            message = 'تمت المتابعة بنجاح.';
            isFollowing = true;
        }
        console.log(`المستخدم ${followerId} ${message} المستخدم ${followedId}`);
        res.status(200).json({ message, isFollowing });
    } catch (error) {
        console.error('خطأ: فشل في عملية المتابعة/إلغاء المتابعة:', error);
        res.status(500).json({ error: 'فشل في عملية المتابعة/إلغاء المتابعة.' });
    }
});

// نقطة نهاية للحصول على جهات الاتصال (المستخدمين الذين أجرى معهم المستخدم الحالي محادثات فردية)
app.get('/api/user/:userId/contacts', async (req, res) => {
    const { userId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب جهات الاتصال (لأن معلومات المستخدمين والمحادثات الأساسية موجودة هنا)
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
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
        console.error('خطأ: فشل جلب جهات الاتصال:', error);
        res.status(500).json({ error: 'فشل جلب جهات الاتصال.' });
    }
});

// نقطة نهاية لنشر منشور جديد
app.post('/api/posts', upload.single('mediaFile'), async (req, res) => {
    const { authorId, authorName, text, mediaType, authorProfileBg } = req.body;
    const mediaFile = req.file;
    const bucketName = 'post-media';

    let postMediaUrl = null;
    let postMediaType = mediaType || 'text';

    if (!authorId || !authorName || (!text && !mediaFile)) {
        console.error('خطأ: المعرف، الاسم، والنص أو ملف الوسائط مطلوب لنشر منشور جديد.');
        return res.status(400).json({ error: 'المعرف، الاسم، والنص أو ملف الوسائط مطلوب.' });
    }
    
    // **تعديل**: احصل على سياق المشروع الصحيح للمستخدم بعد أن يقوم multer بتحليل الجسم
    const { pool, supabase, projectId } = await getUserProjectContext(authorId);
    req.currentProjectId = projectId; // تحديث معرف المشروع الحالي للتسجيل

    try {
        // التحقق من وجود المستخدم في المشروع الافتراضي (حيث يتم تخزين معلومات المستخدمين)
        const userCheckPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const userResult = await userCheckPool.query('SELECT 1 FROM users WHERE uid = $1', [authorId]);
        if (userResult.rows.length === 0) {
            console.error(`خطأ: المستخدم ${authorId} غير موجود لنشر المنشور.`);
            return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        if (mediaFile) {
            const fileExtension = mediaFile.originalname.split('.').pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const filePath = `${authorId}/${fileName}`;

            console.log(`محاولة تحميل ملف المنشور إلى المشروع ${req.currentProjectId}، Bucket: ${bucketName}, المسار: ${filePath}`);
            const { data, error: uploadError } = await supabase.storage // **استخدم supabase الصحيح**
                .from(bucketName)
                .upload(filePath, mediaFile.buffer, {
                    contentType: mediaFile.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error('خطأ: فشل تحميل الملف إلى Supabase Storage:', uploadError);
                console.error('تفاصيل خطأ Supabase:', uploadError.statusCode, uploadError.error, uploadError.message);
                return res.status(500).json({ error: 'فشل تحميل الملف إلى التخزين.' });
            }

            const { data: publicUrlData } = supabase.storage // **استخدم supabase الصحيح**
                .from(bucketName)
                .getPublicUrl(filePath);

            if (!publicUrlData || !publicUrlData.publicUrl) {
                console.error('خطأ: فشل الحصول على الرابط العام للملف الذي تم تحميله.');
                return res.status(500).json({ error: 'فشل الحصول على رابط الملف العام.' });
            }

            postMediaUrl = publicUrlData.publicUrl;
            console.log(`تم تحميل ملف الوسائط للمنشور في المشروع ${req.currentProjectId}: ${postMediaUrl}`);

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

        await pool.query( // **استخدم pool الصحيح**
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
            comments: [],
            views: [],
            mediaUrl: postMediaUrl,
            mediaType: postMediaType,
            authorProfileBg: authorProfileBg || null,
            isPinned: false
        };
        console.log(`تم نشر منشور جديد في المشروع ${req.currentProjectId}:`, newPost);
        res.status(201).json({ message: 'تم نشر المنشور بنجاح.', post: newPost });
    } catch (error) {
        console.error('خطأ: فشل نشر المنشور:', error);
        res.status(500).json({ error: 'فشل نشر المنشور.' });
    }
});

// نقطة نهاية للحصول على جميع المنشورات (الآن تجلب من جميع المشاريع)
app.get('/api/posts', async (req, res) => {
    const { userId } = req.query; // معرف المستخدم اختياري لموضع التشغيل
    try {
        const postsWithDetails = await getPostsFromAllProjects('', [], userId); // تجلب من جميع المشاريع
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('خطأ: فشل جلب جميع المنشورات:', error);
        res.status(500).json({ error: 'فشل جلب المنشورات.' });
    }
});

// نقطة نهاية للحصول على منشورات المستخدمين الذين يتابعهم المستخدم الحالي (الآن تجلب من جميع المشاريع)
app.get('/api/posts/followed/:userId', async (req, res) => {
    const { userId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب قائمة المتابعين (لأن جدول المتابعين موجود هنا)
    const followersPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    try {
        const followedUsersResult = await followersPool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
        const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);
        followedUsersIds.push(userId); // تضمين منشورات المستخدم نفسه

        if (followedUsersIds.length === 0) {
            return res.status(200).json([]);
        }

        const baseQuery = `WHERE p.author_id = ANY($1::VARCHAR[])`;
        const postsWithDetails = await getPostsFromAllProjects(baseQuery, [followedUsersIds], userId); // تجلب من جميع المشاريع
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('خطأ: فشل جلب منشورات المتابعين:', error);
        res.status(500).json({ error: 'فشل جلب منشورات المتابعين.' });
    }
});

// نقطة نهاية للبحث في المنشورات (الآن تجري البحث في جميع المشاريع)
app.get('/api/posts/search', async (req, res) => {
    const { q, filter, userId } = req.query;
    const searchTerm = q ? `%${q.toLowerCase()}%` : '';

    let baseQuery = ``;
    let queryParams = [];
    let paramIndex = 1;

    if (filter === 'followed' && userId) {
        try {
            // نستخدم Pool المشروع الافتراضي لجلب قائمة المتابعين للبحث
            const followersPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const followedUsersResult = await followersPool.query('SELECT followed_id FROM followers WHERE follower_id = $1', [userId]);
            const followedUsersIds = followedUsersResult.rows.map(row => row.followed_id);
            followedUsersIds.push(userId);
            if (followedUsersIds.length > 0) {
                queryParams.push(followedUsersIds);
                baseQuery += ` WHERE p.author_id = ANY($${paramIndex++}::VARCHAR[])`;
            } else {
                return res.status(200).json([]);
            }
        } catch (error) {
            console.error('خطأ: فشل جلب المستخدمين المتابعين للبحث:', error);
            return res.status(500).json({ error: 'فشل في البحث عن منشورات المتابعين.' });
        }
    }

    if (searchTerm) {
        queryParams.push(searchTerm);
        if (baseQuery) {
            baseQuery += ` AND (LOWER(p.text) LIKE $${paramIndex++} OR LOWER(p.author_name) LIKE $${paramIndex++})`; // تم تغيير u.username إلى p.author_name
            queryParams.push(searchTerm);
        } else {
            baseQuery += ` WHERE (LOWER(p.text) LIKE $${paramIndex++} OR LOWER(p.author_name) LIKE $${paramIndex++})`; // تم تغيير u.username إلى p.author_name
            queryParams.push(searchTerm);
        }
    }

    try {
        const postsWithDetails = await getPostsFromAllProjects(baseQuery, queryParams, userId); // تجلب من جميع المشاريع
        res.status(200).json(postsWithDetails);
    } catch (error) {
        console.error('خطأ: فشل البحث في المنشورات:', error);
        res.status(500).json({ error: 'فشل البحث في المنشورات.' });
    }
});

// نقطة نهاية لحذف منشور
app.delete('/api/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    const { callerUid } = req.body;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { post: deletedPost, pool, projectId } = postInfo;
    const supabase = projectSupabaseClients[projectId]; // عميل Supabase للمشروع الذي يوجد به المنشور
    const bucketName = 'post-media';

    try {
        // التحقق من أن المستخدم هو صاحب المنشور أو مدير (من المشروع الافتراضي)
        const adminCheckPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const callerUser = await adminCheckPool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (!callerUser.rows[0] || callerUser.rows[0].user_role !== 'admin') {
            // إذا لم يكن مديرًا، يجب أن يكون هو صاحب المنشور
            if (deletedPost.author_id !== callerUid) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا المنشور.' });
            }
        }

        if (deletedPost.media_url) {
            const url = new URL(deletedPost.media_url);
            const pathSegments = url.pathname.split('/');
            const filePathInBucket = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');

            const { data: removeData, error: deleteError } = await supabase.storage
                .from(bucketName)
                .remove([filePathInBucket]);

            if (deleteError) {
                console.error('خطأ: فشل حذف الوسائط من Supabase Storage:', deleteError);
            } else {
                console.log(`تم حذف الملف من Supabase Storage في المشروع ${projectId}: ${filePathInBucket}`);
            }
        }

        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        console.log(`تم حذف المنشور ${postId} من المشروع ${projectId}.`);
        res.status(200).json({ message: 'تم حذف المنشور بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل حذف المنشور:', error);
        res.status(500).json({ error: 'فشل حذف المنشور.' });
    }
});

// نقطة نهاية لتثبيت/إلغاء تثبيت منشور (للمدير فقط)
app.put('/api/posts/:postId/pin', async (req, res) => {
    const { postId } = req.params;
    const { isPinned, callerUid } = req.body;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool, projectId } = postInfo;

    try {
        // التحقق من أن المستخدم الذي يقوم بالطلب هو مدير (من المشروع الافتراضي)
        const adminCheckPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const adminUser = await adminCheckPool.query('SELECT user_role FROM users WHERE uid = $1', [callerUid]);
        if (!adminUser.rows[0] || adminUser.rows[0].user_role !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لتثبيت/إلغاء تثبيت المنشورات.' });
        }

        await pool.query('UPDATE posts SET is_pinned = $1 WHERE id = $2', [isPinned, postId]);
        res.status(200).json({ message: `تم ${isPinned ? 'تثبيت' : 'إلغاء تثبيت'} المنشور بنجاح في المشروع ${projectId}.`, isPinned });
    } catch (error) {
        console.error('خطأ: فشل تثبيت/إلغاء تثبيت المنشور:', error);
        res.status(500).json({ error: 'فشل تثبيت/إلغاء تثبيت المنشور.' });
    }
});

// نقطة نهاية للإعجاب بمنشور
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { post, pool } = postInfo;

    try {
        let currentLikes = post.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId);
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1);
            isLiked = false;
        }

        await pool.query('UPDATE posts SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), postId]);
        res.status(200).json({ message: 'تم تحديث الإعجاب بنجاح.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('خطأ: فشل الإعجاب بالمنشور:', error);
        res.status(500).json({ error: 'فشل تحديث الإعجاب.' });
    }
});

// نقطة نهاية لزيادة عدد المشاهدات
app.post('/api/posts/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { post, pool } = postInfo;

    try {
        let currentViews = post.views || [];

        if (!currentViews.includes(userId)) {
            currentViews.push(userId);
            await pool.query('UPDATE posts SET views = $1 WHERE id = $2', [JSON.stringify(currentViews), postId]);
        }
        res.status(200).json({ message: 'تم تحديث المشاهدات بنجاح.', viewsCount: currentViews.length });
    } catch (error) {
        console.error('خطأ: فشل تحديث مشاهدات المنشور:', error);
        res.status(500).json({ error: 'فشل تحديث المشاهدات.' });
    }
});

// نقطة نهاية لإضافة تعليق على منشور
app.post('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { userId, username, text } = req.body;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool, projectId } = postInfo; // استخدام pool المشروع الذي يوجد به المنشور

    if (!text) {
        return res.status(400).json({ error: 'نص التعليق مطلوب.' });
    }

    try {
        // جلب معلومات المستخدم من المشروع الافتراضي (حيث يوجد جدول المستخدمين)
        const userDetails = await getUserDetailsFromDefaultProject(userId);
        const userProfileBg = userDetails ? userDetails.profile_bg_url : null;
        const isVerified = userDetails ? userDetails.is_verified : false;

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
        res.status(201).json({ message: 'تم إضافة التعليق بنجاح.', comment: newComment });
    } catch (error) {
        console.error('خطأ: فشل إضافة التعليق:', error);
        res.status(500).json({ error: 'فشل إضافة التعليق.' });
    }
});

// نقطة نهاية للحصول على تعليقات منشور
app.get('/api/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    
    // البحث عن المنشور في أي مشروع
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool, projectId } = postInfo; // استخدام pool المشروع الذي يوجد به المنشور

    try {
        const result = await pool.query(
            `SELECT c.id, c.user_id, c.username, c.text, c.timestamp, c.user_profile_bg, c.likes
             FROM comments c
             WHERE c.post_id = $1
             ORDER BY c.timestamp ASC`,
            [postId]
        );

        // إثراء التعليقات بتفاصيل المستخدم من المشروع الافتراضي
        const comments = await Promise.all(result.rows.map(async row => {
            const userDetails = await getUserDetailsFromDefaultProject(row.user_id);
            return {
                id: row.id,
                userId: row.user_id,
                username: userDetails ? userDetails.username : row.username,
                text: row.text,
                timestamp: parseInt(row.timestamp),
                userProfileBg: userDetails ? userDetails.profile_bg_url : row.user_profile_bg,
                likes: row.likes,
                isVerified: userDetails ? userDetails.is_verified : false
            };
        }));
        res.status(200).json(comments);
    } catch (error) {
        console.error('خطأ: فشل جلب التعليقات:', error);
        res.status(500).json({ error: 'فشل جلب التعليقات.' });
    }
});

// نقطة نهاية لتعديل تعليق
app.put('/api/posts/:postId/comments/:commentId', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId, newText } = req.body;
    
    // البحث عن المنشور في أي مشروع لتحديد الـ pool الصحيح للتعليق
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool } = postInfo;

    if (!newText || newText.trim() === '') {
        return res.status(400).json({ error: 'نص التعليق الجديد مطلوب.' });
    }

    try {
        const commentResult = await pool.query('SELECT user_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        if (comment.user_id !== userId) {
            return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا التعليق.' });
        }

        await pool.query('UPDATE comments SET text = $1 WHERE id = $2', [newText, commentId]);
        res.status(200).json({ message: 'تم تعديل التعليق بنجاح.', newText });
    } catch (error) {
        console.error('خطأ: فشل تعديل التعليق:', error);
        res.status(500).json({ error: 'فشل تعديل التعليق.' });
    }
});

// نقطة نهاية لحذف تعليق
app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    
    // البحث عن المنشور في أي مشروع لتحديد الـ pool الصحيح للتعليق
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool } = postInfo;

    try {
        const commentResult = await pool.query('SELECT user_id, post_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        // جلب معلومات مالك المنشور ودور المستخدم من المشروع الافتراضي
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const postOwnerResult = await defaultPool.query('SELECT author_id FROM posts WHERE id = $1', [comment.post_id]);
        const postOwnerId = postOwnerResult.rows[0] ? postOwnerResult.rows[0].author_id : null;

        const callerUser = await defaultPool.query('SELECT user_role FROM users WHERE uid = $1', [userId]);
        const callerRole = callerUser.rows[0] ? callerUser.rows[0].user_role : 'normal';

        if (comment.user_id !== userId && postOwnerId !== userId && callerRole !== 'admin') {
            return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا التعليق.' });
        }

        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
        res.status(200).json({ message: 'تم حذف التعليق بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل حذف التعليق:', error);
        res.status(500).json({ error: 'فشل حذف التعليق.' });
    }
});


// نقطة نهاية للإعجاب بتعليق
app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    
    // البحث عن المنشور في أي مشروع لتحديد الـ pool الصحيح للتعليق
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool } = postInfo;

    try {
        const commentResult = await pool.query('SELECT likes FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
        const comment = commentResult.rows[0];

        if (!comment) {
            return res.status(404).json({ error: 'التعليق غير موجود.' });
        }

        let currentLikes = comment.likes || [];
        const userIndex = currentLikes.indexOf(userId);
        let isLiked;

        if (userIndex === -1) {
            currentLikes.push(userId);
            isLiked = true;
        } else {
            currentLikes.splice(userIndex, 1);
            isLiked = false;
        }

        await pool.query('UPDATE comments SET likes = $1 WHERE id = $2', [JSON.stringify(currentLikes), commentId]);
        res.status(200).json({ message: 'تم تحديث الإعجاب بالتعليق بنجاح.', likesCount: currentLikes.length, isLiked });
    } catch (error) {
        console.error('خطأ: فشل الإعجاب بالتعليق:', error);
        res.status(500).json({ error: 'فشل تحديث الإعجاب بالتعليق.' });
    }
});

// نقطة نهاية خدمة ملفات الوسائط (الصور والفيديوهات والرسائل الصوتية)
app.get('/api/media/:bucketName/:folder/:fileName', async (req, res) => {
    const { bucketName, folder, fileName } = req.params;
    // هذه النقطة لا تستخدم req.currentProjectId لأن الملف قد يكون في أي مشروع
    // يجب أن نحدد المشروع من خلال مسار الملف إذا أمكن
    // أو نستخدم جميع عملاء Supabase للبحث عن الملف

    let targetSupabaseClient = null;
    let foundProjectId = null;

    // محاولة تحديد المشروع من خلال معرف المستخدم في المسار
    // هذا افتراض بأن folder هو userId
    const potentialUserId = folder;
    const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    if (defaultPool) {
        try {
            const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [potentialUserId]);
            if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                foundProjectId = userResult.rows[0].user_project_id;
                targetSupabaseClient = projectSupabaseClients[foundProjectId];
            }
        } catch (error) {
            console.error(`خطأ في تحديد المشروع لخدمة الوسائط للمستخدم ${potentialUserId}:`, error);
        }
    }

    // إذا لم يتم تحديد مشروع، حاول البحث في جميع المشاريع
    if (!targetSupabaseClient) {
        console.warn(`لم يتم تحديد مشروع لخدمة الوسائط. سأبحث في جميع المشاريع عن الملف: ${folder}/${fileName} في ${bucketName}`);
        for (const projectId in projectSupabaseClients) {
            const supabaseClient = projectSupabaseClients[projectId];
            try {
                // محاولة الحصول على توقيع URL، إذا نجحت، فهذا هو المشروع الصحيح
                // نستخدم getPublicUrl لأن الملفات يجب أن تكون عامة
                const { data, error } = await supabaseClient.storage
                    .from(bucketName)
                    .getPublicUrl(`${folder}/${fileName}`);
                if (!error && data && data.publicUrl) {
                    targetSupabaseClient = supabaseClient;
                    foundProjectId = projectId;
                    break;
                }
            } catch (error) {
                // تجاهل الأخطاء، فقط حاول في المشروع التالي
            }
        }
    }

    if (!targetSupabaseClient) {
        console.error(`خطأ: لم يتم العثور على الملف ${folder}/${fileName} في أي مشروع.`);
        return res.status(404).send('الملف غير موجود في أي من المشاريع المتاحة.');
    }

    const filePathInBucket = `${folder}/${fileName}`;

    try {
        const { data, error } = await targetSupabaseClient.storage
            .from(bucketName)
            .getPublicUrl(filePathInBucket); // استخدام getPublicUrl مباشرة بدلاً من createSignedUrl لملفات Public

        if (error || !data || !data.publicUrl) {
            console.error(`خطأ: فشل الحصول على الرابط العام للملف ${filePathInBucket}:`, error);
            return res.status(500).send('فشل في خدمة الملف.');
        }

        res.redirect(data.publicUrl); // إعادة التوجيه إلى الرابط العام مباشرة

    } catch (error) {
        console.error(`خطأ: فشل خدمة ملف الوسائط ${filePathInBucket} من Supabase Storage:`, error);
        res.status(500).send('فشل في خدمة الملف.');
    }
});


// ----------------------------------------------------------------------------------------------------
// نقاط نهاية تقدم تشغيل الفيديو
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لحفظ أو تحديث موضع تشغيل الفيديو
app.post('/api/video/:postId/playback-position', async (req, res) => {
    const { postId } = req.params;
    const { userId, positionSeconds } = req.body;
    
    // البحث عن المنشور لتحديد الـ pool الصحيح
    const postInfo = await getPostFromAnyProject(postId);
    if (!postInfo) {
        return res.status(404).json({ error: 'المنشور غير موجود.' });
    }
    const { pool } = postInfo; // استخدام pool المشروع الذي يوجد به المنشور

    if (!userId || positionSeconds === undefined || positionSeconds === null) {
        return res.status(400).json({ error: 'معرف المستخدم وموضع التشغيل مطلوبان.' });
    }

    try {
        await pool.query(`
            INSERT INTO video_playback_progress (user_id, post_id, position_seconds, last_updated)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, post_id) DO UPDATE SET
                position_seconds = EXCLUDED.position_seconds,
                last_updated = EXCLUDED.last_updated;
        `, [userId, postId, positionSeconds, Date.now()]);

        res.status(200).json({ message: 'تم حفظ موضع التشغيل بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل حفظ موضع تشغيل الفيديو:', error);
        res.status(500).json({ error: 'فشل حفظ موضع التشغيل.' });
    }
});


// ----------------------------------------------------------------------------------------------------
// نقاط نهاية وكيل Gemini API
// ----------------------------------------------------------------------------------------------------
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, chatHistory = [] } = req.body;

    if (!GEMINI_API_KEY) {
        console.error("لم يتم تكوين مفتاح Gemini API.");
        return res.status(500).json({ error: "لم يتم تكوين مفتاح Gemini API على الخادم." });
    }

    const payload = {
        contents: [...chatHistory, { role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
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
            console.error(`خطأ في Gemini API: ${response.status} - ${errorText}`);
            return res.status(response.status).json({ error: `خطأ في Gemini API: ${response.status} - ${errorText}` });
        }

        const result = await response.json();

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            res.status(200).json({ response: text });
        } else {
            console.warn('هيكل استجابة Gemini API غير متوقع:', result);
            res.status(500).json({ error: 'أرجع Gemini API هيكل استجابة غير متوقع.' });
        }
    } catch (error) {
        console.error('خطأ عند استدعاء وكيل Gemini API:', error);
        res.status(500).json({ error: 'فشل الاتصال بـ Gemini API: ' + error.message });
    }
});


// ----------------------------------------------------------------------------------------------------
// وظائف الدردشة - تم تعديلها للعمل مع PostgreSQL
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء محادثة فردية
app.post('/api/chats/private', async (req, res) => {
    const { user1Id, user2Id, user1Name, user2Name, user1CustomId, user2CustomId, contactName } = req.body;
    // نستخدم Pool المشروع الافتراضي لإنشاء محادثة فردية (لأن معلومات المستخدمين موجودة هنا)
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    if (!user1Id || !user2Id || !user1Name || !user2Name || !user1CustomId || !user2CustomId || !contactName) {
        return res.status(400).json({ error: 'جميع بيانات المستخدمين مطلوبة لإنشاء محادثة فردية.' });
    }

    try {
        const existingChatResult = await pool.query(`
            SELECT id FROM chats
            WHERE type = 'private'
            AND (participants @> to_jsonb(ARRAY[$1]::VARCHAR[]) AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[]))
        `, [user1Id, user2Id]);

        if (existingChatResult.rows.length > 0) {
            const existingChatId = existingChatResult.rows[0].id;
            console.log('محادثة فردية موجودة بالفعل:', existingChatId);
            return res.status(200).json({ message: 'المحادثة موجودة بالفعل.', chatId: existingChatId });
        }

        const newChatId = uuidv4();
        const timestamp = Date.now();
        const participantsArray = [user1Id, user2Id];
        const contactNamesObject = {
            [user1Id]: contactName,
            [user2Id]: user1Name
        };

        const user2Profile = await pool.query('SELECT profile_bg_url FROM users WHERE uid = $1', [user2Id]);
        const chatProfileBg = user2Profile.rows[0] ? user2Profile.rows[0].profile_bg_url : null;


        await pool.query(
            `INSERT INTO chats (id, type, participants, last_message, timestamp, contact_names, profile_bg_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newChatId, 'private', JSON.stringify(participantsArray), null, timestamp, JSON.stringify(contactNamesObject), chatProfileBg]
        );

        console.log('تم إنشاء محادثة فردية جديدة:', newChatId);
        res.status(201).json({ message: 'تم إنشاء المحادثة.', chatId: newChatId });
    } catch (error) {
        console.error('خطأ: فشل إنشاء محادثة فردية:', error);
        res.status(500).json({ error: 'فشل إنشاء المحادثة.' });
    }
});

// نقطة نهاية لتعديل اسم جهة الاتصال في محادثة فردية
app.put('/api/chats/private/:chatId/contact-name', async (req, res) => {
    const { chatId } = req.params;
    const { userId, newContactName } = req.body;
    // نستخدم Pool المشروع الافتراضي لتعديل اسم جهة الاتصال
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    try {
        const chatResult = await pool.query('SELECT contact_names FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية التعديل.' });
        }

        let currentContactNames = chat.contact_names || {};
        currentContactNames[userId] = newContactName;

        await pool.query('UPDATE chats SET contact_names = $1 WHERE id = $2', [JSON.stringify(currentContactNames), chatId]);
        console.log(`تم تحديث اسم جهة الاتصال للمحادثة ${chatId} بواسطة ${userId} إلى ${newContactName}`);
        res.status(200).json({ message: 'تم تحديث اسم جهة الاتصال بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل تحديث اسم جهة الاتصال:', error);
        res.status(500).json({ error: 'فشل تحديث اسم جهة الاتصال.' });
    }
});

// نقطة نهاية للحصول على جميع المحادثات لمستخدم معين
// ملاحظة: هذه النقطة ستجلب المحادثات من المشروع الافتراضي فقط.
app.get('/api/user/:userId/chats', async (req, res) => {
    const { userId } = req.params;
    // نستخدم Pool المشروع الافتراضي لجلب المحادثات
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
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
            let chatProfileBg = row.profile_bg_url;
            let chatAdminId = null;
            let chatSendPermission = row.send_permission;

            if (row.type === 'private') {
                if (row.name === 'المساعدة') {
                    chatName = 'المساعدة';
                    const botUserResult = await pool.query('SELECT custom_id FROM users WHERE username = $1 AND user_role = $2', ['المساعدة', 'bot']);
                    chatCustomId = botUserResult.rows[0] ? botUserResult.rows[0].custom_id : null;
                } else {
                    chatName = row.contact_names ? row.contact_names[userId] : 'جهة اتصال غير معروفة';
                    const otherParticipantId = row.participants.find(pId => pId !== userId);
                    if (otherParticipantId) {
                        const otherUserResult = await pool.query('SELECT custom_id, profile_bg_url FROM users WHERE uid = $1', [otherParticipantId]);
                        const otherUser = otherUserResult.rows[0];
                        if (otherUser) {
                            chatCustomId = otherUser.custom_id;
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
        res.status(200).json(userChats);
    } catch (error) {
        console.error('خطأ: فشل جلب محادثات المستخدم:', error);
        res.status(500).json({ error: 'فشل جلب المحادثات.' });
    }
});

// وظيفة لجلب الرسائل من جميع المشاريع وإثرائها بتفاصيل المرسل
async function getMessagesFromAllProjects(chatId, sinceTimestamp) {
    let allRawMessages = [];
    for (const projectId in projectDbPools) {
        const pool = projectDbPools[projectId];
        try {
            const result = await pool.query(
                `SELECT m.* FROM messages m WHERE m.chat_id = $1 AND m.timestamp > $2 ORDER BY m.timestamp ASC`,
                [chatId, sinceTimestamp]
            );
            allRawMessages = allRawMessages.concat(result.rows);
        } catch (error) {
            console.error(`خطأ في جلب الرسائل الخام من المشروع ${projectId} للمحادثة ${chatId}:`, error);
        }
    }

    // الآن قم بإثراء الرسائل بتفاصيل المرسل
    const enrichedMessages = await Promise.all(allRawMessages.map(async row => {
        const senderDetails = await getUserDetailsFromDefaultProject(row.sender_id);
        return {
            id: row.id,
            senderId: row.sender_id,
            senderName: senderDetails ? senderDetails.username : row.sender_name,
            text: row.text,
            timestamp: parseInt(row.timestamp),
            mediaUrl: row.media_url,
            mediaType: row.media_type,
            senderProfileBg: senderDetails ? senderDetails.profile_bg_url : row.sender_profile_bg,
            senderIsVerified: senderDetails ? senderDetails.is_verified : false,
            senderUserRole: senderDetails ? senderDetails.user_role : 'normal'
        };
    }));

    enrichedMessages.sort((a, b) => a.timestamp - b.timestamp);
    return enrichedMessages;
}

// نقطة نهاية لإرسال رسالة في محادثة
app.post('/api/chats/:chatId/messages', upload.single('mediaFile'), async (req, res) => {
    const { chatId } = req.params;
    const { senderId, senderName, text, mediaType, senderProfileBg } = req.body;
    const mediaFile = req.file;
    const bucketName = 'chat-media';

    let messageMediaUrl = null;
    let messageMediaType = mediaType || 'text';

    if (!senderId || !senderName || (!text && !mediaFile)) {
        console.error('خطأ: المعرف، الاسم، والنص أو ملف الوسائط مطلوب لإرسال رسالة.');
        return res.status(400).json({ error: 'المعرف، الاسم، والنص أو ملف الوسائط مطلوب.' });
    }

    // **تعديل**: احصل على سياق المشروع الصحيح للمستخدم بعد أن يقوم multer بتحليل الجسم
    const { pool, supabase, projectId } = await getUserProjectContext(senderId);
    req.currentProjectId = projectId; // تحديث معرف المشروع الحالي للتسجيل

    try {
        // نستخدم Pool المشروع الافتراضي للتحقق من معلومات المحادثة (لأن المحادثات موجودة هنا)
        const chatCheckPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const chatResult = await chatCheckPool.query('SELECT participants, type, admin_id, member_roles, send_permission FROM chats WHERE id = $1', [chatId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            console.error(`خطأ: المحادثة ${chatId} غير موجودة.`);
            return res.status(404).json({ error: 'المحادثة غير موجودة.' });
        }
        if (!chat.participants.includes(senderId)) {
            console.error(`خطأ: المستخدم ${senderId} ليس عضواً في المحادثة ${chatId}.`);
            return res.status(403).json({ error: 'المستخدم ليس عضواً في هذه المحادثة.' });
        }

        if (chat.type === 'group' && chat.send_permission === 'admins_only') {
            const senderRole = chat.member_roles[senderId];
            if (senderRole !== 'admin') {
                console.error(`خطأ: المستخدم ${senderId} ليس مشرفاً في المجموعة ${chatId} ولا يمكنه الإرسال.`);
                return res.status(403).json({ error: 'فقط المشرفون يمكنهم إرسال الرسائل في هذه المجموعة.' });
            }
        }

        if (mediaFile) {
            const fileExtension = mediaFile.originalname.split('.').pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const filePath = `${senderId}/${fileName}`;

            console.log(`محاولة تحميل ملف رسالة إلى المشروع ${req.currentProjectId}، Bucket: ${bucketName}, المسار: ${filePath}`);
            const { data, error: uploadError } = await supabase.storage // **استخدم supabase الصحيح**
                .from(bucketName)
                .upload(filePath, mediaFile.buffer, {
                    contentType: mediaFile.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error('خطأ: فشل تحميل الملف إلى Supabase Storage:', uploadError);
                console.error('تفاصيل خطأ Supabase:', uploadError.statusCode, uploadError.error, uploadError.message);
                return res.status(500).json({ error: 'فشل تحميل الملف إلى التخزين.' });
            }

            const { data: publicUrlData } = supabase.storage // **استخدم supabase الصحيح**
                .from(bucketName)
                .getPublicUrl(filePath);

            if (!publicUrlData || !publicUrlData.publicUrl) {
                console.error('خطأ: فشل الحصول على الرابط العام للملف الذي تم تحميله.');
                return res.status(500).json({ error: 'فشل الحصول على رابط الملف العام.' });
            }

            messageMediaUrl = publicUrlData.publicUrl;
            console.log(`تم تحميل ملف الوسائط للرسالة في المشروع ${req.currentProjectId}: ${messageMediaUrl}`);

            if (!mediaType || mediaType === 'text') {
                if (mediaFile.mimetype.startsWith('image/')) {
                    messageMediaType = 'image';
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    messageMediaType = 'video';
                } else if (mediaFile.mimetype.startsWith('audio/')) {
                    messageMediaType = 'audio';
                }
            }
        }

        const messageId = uuidv4();
        const timestamp = Date.now();

        await pool.query( // **استخدم pool الصحيح** - سيتم حفظ الرسالة في مشروع المستخدم
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

        // تحديث آخر رسالة في المحادثة في المشروع الافتراضي
        await chatCheckPool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [lastMessageText, timestamp, chatId]);

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
        
        // ==== بداية كود إرسال الإشعار ====
        try {
            const recipients = chat.participants.filter(pId => pId !== senderId); // كل المشاركين عدا المرسل
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    
            for (const recipientId of recipients) {
                const subResult = await defaultPool.query('SELECT subscription_info FROM push_subscriptions WHERE user_id = $1', [recipientId]);
                if (subResult.rows.length > 0) {
                    const subscription = subResult.rows[0].subscription_info;
                    const payload = JSON.stringify({
    title: `رسالة جديدة من ${senderName}`,
    body: lastMessageText,
    url: `/?chatId=${chatId}`,
    icon: senderProfileBg // <<<<<< أضف هذا السطر فقط
});
                    
                    webPush.sendNotification(subscription, payload).catch(error => {
                        console.error(`فشل إرسال إشعار إلى ${recipientId}:`, error);
                        // يمكن إضافة كود هنا لحذف الاشتراك إذا كان غير صالح (مثل خطأ 410)
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            console.log(`اشتراك المستخدم ${recipientId} غير صالح. سيتم حذفه.`);
                            defaultPool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [recipientId]);
                        }
                    });
                }
            }
        } catch (pushError) {
            console.error("خطأ عام في إرسال الإشعارات:", pushError);
        }
        // ==== نهاية كود إرسال الإشعار ====

        res.status(201).json({ message: 'تم إرسال الرسالة بنجاح.', messageData: newMessage });
    } catch (error) {
        console.error('خطأ: فشل إرسال الرسالة:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة.' });
    }
});

// نقطة نهاية للحصول على رسائل محادثة معينة (مع فلتر زمني) - الآن تجلب من جميع المشاريع
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const sinceTimestamp = parseInt(req.query.since || '0');
    try {
        const messages = await getMessagesFromAllProjects(chatId, sinceTimestamp); // تجلب من جميع المشاريع
        res.status(200).json(messages);
    } catch (error) {
        console.error('خطأ: فشل جلب رسائل المحادثة:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل.' });
    }
});

// نقطة نهاية لحذف محادثة لمستخدم معين (في هذا النموذج، حذف من جدول chats)
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي (حيث يتم تخزين معلومات المحادثات)
app.delete('/api/chats/:chatId/delete-for-user', async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        const chatResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, userId]);
        const chat = chatResult.rows[0];

        if (!chat) {
            return res.status(404).json({ error: 'المحادثة غير موجودة أو المستخدم ليس عضواً فيها.' });
        }

        let updatedParticipants = chat.participants.filter(p => p !== userId);

        if (updatedParticipants.length === 0) {
            await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
            console.log(`تم حذف المحادثة ${chatId} بالكامل لأن المستخدم ${userId} كان آخر مشارك.`);
            res.status(200).json({ message: 'تم حذف المحادثة بالكامل بنجاح.' });
        } else {
            await pool.query('UPDATE chats SET participants = $1 WHERE id = $2', [JSON.stringify(updatedParticipants), chatId]);
            console.log(`تم حذف المحادثة ${chatId} للمستخدم ${userId} فقط.`);
            res.status(200).json({ message: 'تم حذف المحادثة من عندك بنجاح.' });
        }
    } catch (error) {
        console.error('خطأ: فشل حذف المحادثة للمستخدم:', error);
        res.status(500).json({ error: 'فشل حذف المحادثة.' });
    }
});

// نقطة نهاية لحذف محادثة فردية من الطرفين
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي (حيث يتم تخزين معلومات المحادثات)
// **تحذير: حذف الوسائط من جميع المشاريع يتطلب منطقًا إضافيًا لتحديد مكان وجود كل رسالة**
app.delete('/api/chats/private/:chatId/delete-for-both', async (req, res) => {
    const { chatId } = req.params;
    const { callerUid } = req.body;
    const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        // الخطوة 1: حذف الرسائل من جميع المشاريع
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            const supabase = projectSupabaseClients[projectId];
            const bucketName = 'chat-media';

            try {
                const messagesResult = await pool.query('SELECT media_url FROM messages WHERE chat_id = $1', [chatId]);
                const messagesMediaUrls = messagesResult.rows.map(row => row.media_url).filter(Boolean);

                if (messagesMediaUrls.length > 0) {
                    const filePathsToDelete = messagesMediaUrls.map(url => {
                        const urlObj = new URL(url);
                        const pathSegments = urlObj.pathname.split('/');
                        return pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
                    });

                    const { data: removeData, error: deleteError } = await supabase.storage
                        .from(bucketName)
                        .remove(filePathsToDelete);

                    if (deleteError) {
                        console.error(`خطأ: فشل حذف وسائط الرسالة من Supabase Storage في المشروع ${projectId}:`, deleteError);
                    } else {
                        console.log(`تم حذف ملفات الوسائط من Supabase Storage للمحادثة ${chatId} في المشروع ${projectId}.`);
                    }
                }
                await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
                console.log(`تم حذف الرسائل من قاعدة بيانات المشروع ${projectId} للمحادثة ${chatId}.`);
            } catch (error) {
                console.error(`خطأ: فشل حذف الرسائل أو وسائطها من المشروع ${projectId}:`, error);
            }
        }

        // الخطوة 2: حذف المحادثة من المشروع الافتراضي
        await defaultPool.query('DELETE FROM chats WHERE id = $1 AND type = \'private\' AND participants @> to_jsonb(ARRAY[$2]::VARCHAR[])', [chatId, callerUid]);

        console.log(`تم حذف المحادثة الفردية ${chatId} من الطرفين بواسطة ${callerUid}.`);
        res.status(200).json({ message: 'تم حذف المحادثة من الطرفين بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل حذف المحادثة الفردية من الطرفين:', error);
        res.status(500).json({ error: 'فشل حذف المحادثة من الطرفين.' });
    }
});

// ----------------------------------------------------------------------------------------------------
// وظائف المجموعة - تم تعديلها للعمل مع PostgreSQL
// ----------------------------------------------------------------------------------------------------

// نقطة نهاية لإنشاء مجموعة جديدة
app.post('/api/groups', async (req, res) => {
    const { name, description, adminId, members, profileBgUrl } = req.body;
    // نستخدم Pool المشروع الافتراضي لإنشاء المجموعات
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    if (!name || !adminId || !members || Object.keys(members).length < 2) {
        return res.status(400).json({ error: 'اسم المجموعة، معرف المشرف، وعضوان على الأقل مطلوبان.' });
    }
    if (!members[adminId] || members[adminId] !== 'admin') {
        return res.status(400).json({ error: 'يجب أن يكون المشرف المحدد عضواً ومشرفاً.' });
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

        console.log('تم إنشاء مجموعة جديدة:', newGroupId);
        res.status(201).json({ message: 'تم إنشاء المجموعة بنجاح.', groupId: newGroupId });
    } catch (error) {
        console.error('خطأ: فشل إنشاء المجموعة:', error);
        res.status(500).json({ error: 'فشل إنشاء المجموعة.' });
    }
});

// نقطة نهاية لتغيير اسم المجموعة
app.put('/api/groups/:groupId/name', async (req, res) => {
    const { groupId } = req.params;
    const { newName, callerUid } = req.body;
    // نستخدم Pool المشروع الافتراضي لتغيير اسم المجموعة
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير اسم المجموعة.' });
        }

        await pool.query('UPDATE chats SET name = $1 WHERE id = $2', [newName, groupId]);
        console.log(`تم تغيير اسم المجموعة ${groupId} إلى ${newName}`);
        res.status(200).json({ message: 'تم تغيير اسم المجموعة بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل تغيير اسم المجموعة:', error);
        res.status(500).json({ error: 'فشل تغيير اسم المجموعة.' });
    }
});

// نقطة نهاية لتغيير خلفية المجموعة
app.post('/api/groups/:groupId/background', upload.single('file'), async (req, res) => {
    const { groupId } = req.params;
    const { callerUid } = req.body;
    const uploadedFile = req.file;
    // نستخدم Pool المشروع الافتراضي للتحقق من صلاحيات المجموعة
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
    const supabase = projectSupabaseClients[BACKEND_DEFAULT_PROJECT_ID]; // يستخدم عميل Supabase للمشروع الافتراضي
    const bucketName = 'group-backgrounds';

    if (!callerUid || !uploadedFile) {
        console.error('خطأ: معرف المستخدم والملف مطلوبان لرفع خلفية المجموعة.');
        return res.status(400).json({ error: 'معرف المستخدم والملف مطلوبان.' });
    }

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            console.error(`خطأ: المجموعة ${groupId} غير موجودة.`);
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            console.error(`خطأ: المستخدم ${callerUid} ليس مشرفاً في المجموعة ${groupId} ولا يملك صلاحية تغيير الخلفية.`);
            return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير خلفية المجموعة.' });
        }

        const fileExtension = uploadedFile.originalname.split('.').pop();
        const fileName = `${uuidv4()}.${fileExtension}`;
        const filePath = `${groupId}/${fileName}`;

        console.log(`محاولة تحميل ملف خلفية المجموعة إلى المشروع ${BACKEND_DEFAULT_PROJECT_ID}، Bucket: ${bucketName}, المسار: ${filePath}`);
        const { data, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, uploadedFile.buffer, {
                contentType: uploadedFile.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('خطأ: فشل تحميل الملف إلى Supabase Storage:', uploadError);
            console.error('تفاصيل خطأ Supabase:', uploadError.statusCode, uploadError.error, uploadError.message);
            return res.status(500).json({ error: 'فشل تحميل الملف إلى التخزين.' });
        }

        const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error('خطأ: فشل الحصول على الرابط العام للملف الذي تم تحميله.');
            return res.status(500).json({ error: 'فشل الحصول على رابط الملف العام.' });
        }

        const mediaUrl = publicUrlData.publicUrl;

        await pool.query('UPDATE chats SET profile_bg_url = $1 WHERE id = $2', [mediaUrl, groupId]);

        console.log(`تم تحميل خلفية المجموعة ${groupId} في المشروع الافتراضي: ${mediaUrl}`);
        res.status(200).json({ message: 'تم تحميل خلفية المجموعة بنجاح.', url: mediaUrl });
    } catch (error) {
        console.error('خطأ: فشل تحميل خلفية المجموعة أو تحديث قاعدة البيانات:', error);
        res.status(500).json({ error: 'فشل تحميل الخلفية.' });
    }
});

// نقطة نهاية لتغيير إذن الإرسال في المجموعة
app.put('/api/groups/:groupId/send-permission', async (req, res) => {
    const { groupId } = req.params;
    const { callerUid, newPermission } = req.body;
    // نستخدم Pool المشروع الافتراضي لتغيير إذن الإرسال
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

    if (!newPermission || !['all', 'admins_only'].includes(newPermission)) {
        return res.status(400).json({ error: 'إذن الإرسال غير صالح.' });
    }

    try {
        const groupResult = await pool.query('SELECT member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية لتغيير إذن الإرسال في هذه المجموعة.' });
        }

        await pool.query('UPDATE chats SET send_permission = $1 WHERE id = $2', [newPermission, groupId]);
        res.status(200).json({ message: 'تم تحديث إذن الإرسال بنجاح.', sendPermission: newPermission });
    } catch (error) {
        console.error('خطأ: فشل تحديث إذن الإرسال في المجموعة:', error);
        res.status(500).json({ error: 'فشل تحديث إذن الإرسال في المجموعة.' });
    }
});


// نقطة نهاية للحصول على أعضاء المجموعة (مع الأدوار)
// ملاحظة: هذه النقطة ستجلب الأعضاء من المشروع الافتراضي (حيث يتم تخزين معلومات المجموعات)
app.get('/api/group/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي
    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const memberUids = group.participants;
        const memberRoles = group.member_roles;

        // جلب معلومات المستخدمين من المشروع الافتراضي
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
        res.status(200).json(membersInfo);
    } catch (error) {
        console.error('خطأ: فشل جلب أعضاء المجموعة:', error);
        res.status(500).json({ error: 'فشل جلب أعضاء المجموعة.' });
    }
});

// نقطة نهاية للحصول على عدد أعضاء المجموعة
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي
app.get('/api/group/:groupId/members/count', async (req, res) => {
    const { groupId } = req.params;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي
    try {
        const groupResult = await pool.query('SELECT participants FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }
        res.status(200).json({ count: group.participants.length });
    } catch (error) {
        console.error('خطأ: فشل جلب عدد أعضاء المجموعة:', error);
        res.status(500).json({ error: 'فشل جلب عدد الأعضاء.' });
    }
});

// نقطة نهاية لإضافة أعضاء إلى مجموعة موجودة
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي
app.post('/api/groups/:groupId/add-members', async (req, res) => {
    const { groupId } = req.params;
    const { newMemberUids, callerUid } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        const groupResult = await pool.query('SELECT participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية إضافة أعضاء إلى هذه المجموعة.' });
        }

        let currentParticipants = group.participants;
        let currentMemberRoles = group.member_roles;
        const addedMembers = [];

        for (const uid of newMemberUids) {
            if (!currentParticipants.includes(uid)) {
                // جلب معلومات المستخدم من المشروع الافتراضي
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
            console.log(`تم إضافة أعضاء جدد إلى المجموعة ${groupId}: ${addedMembers.join(', ')}`);
            res.status(200).json({ message: `تم إضافة ${addedMembers.length} أعضاء بنجاح: ${addedMembers.join(', ')}` });
        } else {
            res.status(200).json({ message: 'لم يتم إضافة أعضاء جدد (ربما كانوا موجودين بالفعل).' });
        }
    } catch (error) {
        console.error('خطأ: فشل إضافة أعضاء إلى المجموعة:', error);
        res.status(500).json({ error: 'فشل إضافة أعضاء إلى المجموعة.' });
    }
});

// نقطة نهاية لتغيير دور عضو في المجموعة (مشرف/عضو)
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي
app.put('/api/group/:groupId/members/:memberUid/role', async (req, res) => {
    const { groupId, memberUid } = req.params;
    const { newRole, callerUid } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير أدوار الأعضاء.' });
        }

        if (memberUid === group.admin_id && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية تغيير دور مالك المجموعة.' });
        }

        if (group.member_roles[memberUid] === 'admin' && newRole === 'member' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر من الإشراف.' });
        }

        if (!group.participants.includes(memberUid)) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        let updatedMemberRoles = group.member_roles;
        updatedMemberRoles[memberUid] = newRole;

        await pool.query('UPDATE chats SET member_roles = $1 WHERE id = $2', [JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تم تغيير دور العضو بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل تغيير دور العضو:', error);
        res.status(500).json({ error: 'فشل تغيير دور العضو.' });
    }
});

// نقطة نهاية لإزالة عضو من المجموعة
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي
app.delete('/api/group/:groupId/members/:memberUid', async (req, res) => {
    const { groupId, memberUid, callerUid } = req.body; // **تعديل: يجب أن يأتي memberUid من الرابط**
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        if (!group.member_roles[callerUid] || group.member_roles[callerUid] !== 'admin') {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة أعضاء من هذه المجموعة.' });
        }

        if (req.params.memberUid === group.admin_id) {
            return res.status(403).json({ error: 'لا يمكنك إزالة مالك المجموعة.' });
        }

        if (group.member_roles[req.params.memberUid] === 'admin' && callerUid !== group.admin_id) {
            return res.status(403).json({ error: 'لا تملك صلاحية إزالة مشرف آخر.' });
        }

        const memberIndex = group.participants.indexOf(req.params.memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'العضو غير موجود في هذه المجموعة.' });
        }

        let updatedParticipants = group.participants.filter(id => id !== req.params.memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[req.params.memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تم إزالة العضو بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل إزالة عضو من المجموعة:', error);
        res.status(500).json({ error: 'فشل إزالة العضو.' });
    }
});

// نقطة نهاية لمغادرة المجموعة
// ملاحظة: هذه النقطة ستعمل على المشروع الافتراضي
app.delete('/api/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { memberUid } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // يعمل على المشروع الافتراضي

    try {
        const groupResult = await pool.query('SELECT admin_id, participants, member_roles FROM chats WHERE id = $1 AND type = \'group\'', [groupId]);
        const group = groupResult.rows[0];

        if (!group) {
            return res.status(404).json({ error: 'المجموعة غير موجودة.' });
        }

        const memberIndex = group.participants.indexOf(memberUid);
        if (memberIndex === -1) {
            return res.status(404).json({ error: 'أنت لست عضواً في هذه المجموعة.' });
        }

        if (memberUid === group.admin_id) {
            if (group.participants.length > 1) {
                 return res.status(403).json({ error: 'لا يمكنك مغادرة المجموعة بصفتك المالك. يرجى تعيين مالك جديد أولاً.' });
            } else {
                await pool.query('DELETE FROM chats WHERE id = $1', [groupId]);
                console.log(`تم حذف المجموعة ${groupId} لأن المالك غادر وكان العضو الوحيد.`);
                return res.status(200).json({ message: 'تم حذف المجموعة بنجاح بعد مغادرتك.' });
            }
        }

        let updatedParticipants = group.participants.filter(id => id !== memberUid);
        let updatedMemberRoles = group.member_roles;
        delete updatedMemberRoles[memberUid];

        await pool.query('UPDATE chats SET participants = $1, member_roles = $2 WHERE id = $3', [JSON.stringify(updatedParticipants), JSON.stringify(updatedMemberRoles), groupId]);
        res.status(200).json({ message: 'تمت مغادرة المجموعة بنجاح.' });
    } catch (error) {
        console.error('خطأ: فشل مغادرة المجموعة:', error);
        res.status(500).json({ error: 'فشل مغادرة المجموعة.' });
    }
});

// NEW: Import and use marketing routes
const marketingRoutes = require('./marketingRoutes'); 
app.use('/api/marketing', marketingRoutes(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID));


// ==== بداية كود نقطة نهاية حفظ اشتراك الإشعارات ====
app.post('/api/subscribe', async (req, res) => {
    const { subscription, userId } = req.body;
    const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID]; // الاشتراكات تُحفظ دائماً في المشروع الافتراضي

    if (!subscription || !userId) {
        return res.status(400).json({ error: 'Subscription and userId are required.' });
    }

    try {
        // استخدام ON CONFLICT لتحديث الاشتراك إذا كان موجوداً بالفعل
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


// بدء تشغيل الخادم
app.listen(port, async () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
    console.log(`رابط الواجهة الخلفية (Backend URL): http://localhost:${port}`);
    await initializeSupabaseClients();
});
