// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// ===== NOTA PARA TI: =====
// Este archivo contiene la lógica del backend.
// Las funciones de pago reales (Stripe, Binance) no se pueden implementar aquí
// sin acceso a las claves API y bibliotecas en `server.js`.
// En su lugar, he creado la estructura y los endpoints, simulando que el pago
// se ha completado con éxito para que el resto del flujo de la aplicación funcione.
// También he añadido las tablas de base de datos necesarias como comentarios.
// Deberás añadir estas sentencias `CREATE TABLE` y `ALTER TABLE` a tu función `createTables` en `server.js`.
/*
--- Pega esto en tu función createTables en server.js ---

// 1. Nueva tabla para registrar las solicitudes de retiro
await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        method VARCHAR(50) NOT NULL, -- 'crypto' o 'stripe'
        details JSONB NOT NULL, -- Para la dirección de la billetera o los datos de la tarjeta
        status VARCHAR(50) DEFAULT 'pending', -- pending, completed, rejected
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );
`);

// 2. Modificar la tabla de wallets para añadir el saldo en proceso de retiro
await pool.query(`
    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS withdrawing_balance NUMERIC(10, 2) DEFAULT 0.00;
`);

*/


module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID, sendOneSignalNotification, FRONTEND_URL) {
    
    async function getUserProjectContext(userId) {
        let projectId = BACKEND_DEFAULT_PROJECT_ID;
        if (userId) {
            try {
                const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
                const userResult = await defaultPool.query('SELECT user_project_id FROM users WHERE uid = $1', [userId]);
                if (userResult.rows.length > 0 && userResult.rows[0].user_project_id) {
                    projectId = userResult.rows[0].user_project_id;
                }
            } catch (error) {
                console.error(`Error fetching project ID for user ${userId}:`, error);
            }
        }
        return {
            pool: projectDbPools[projectId],
            supabase: projectSupabaseClients[projectId],
            projectId: projectId
        };
    }

    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role, is_approved_seller FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details for ${userId}:`, error);
            return null;
        }
    }

    async function getAdFromAnyProject(adId) {
        if (!adId) return null;
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    return adResult.rows[0];
                }
            } catch (error) {
                console.error(`Error searching for ad ${adId} in project ${projectId}:`, error);
            }
        }
        return null;
    }

    // ===== INICIO DEL CÓDIGO AÑADIDO / MODIFICADO =====

    async function sendWithdrawalRequestToFounder(withdrawalId, userDetails, amount, method) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '💰 طلبات السحب';

        try {
            const founderResult = await pool.query("SELECT uid, profile_bg_url FROM users WHERE user_role = 'admin' LIMIT 1");
            if (founderResult.rows.length === 0) return;
            const founder = founderResult.rows[0];

            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([founder.uid])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp, profile_bg_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([founder.uid, BOT_UID]), null, Date.now(), "https://kdbtusugpqboxsaosaci.supabase.co/storage/v1/object/public/system-avatars/withdraw.png"]
                );
            }

            const withdrawalDetails = await pool.query("SELECT details FROM withdrawals WHERE id = $1", [withdrawalId]);
            const details = withdrawalDetails.rows[0].details;
            let detailsText = '';
            if (method === 'crypto') {
                detailsText = `\n- عنوان المحفظة (TRC20): ${details.walletAddress}`;
            } else {
                detailsText = `\n- بيانات البطاقة: (تحقق من التفاصيل في لوحة تحكم Stripe)`;
            }

            const messageText = `
🚨 طلب سحب جديد!
---
- **البائع:** ${userDetails.username} (${userDetails.custom_id})
- **المبلغ:** $${amount}
- **الطريقة:** ${method === 'crypto' ? 'عملات رقمية' : 'Stripe'}
${detailsText}
---
**الإجراءات (للمؤسس فقط):**
[SYSTEM_ACTION:WITHDRAWAL_APPROVAL,WID:${withdrawalId},ACTION:APPROVE]
[SYSTEM_ACTION:WITHDRAWAL_APPROVAL,WID:${withdrawalId},ACTION:REJECT]
            `;
            const messageId = uuidv4();
            const timestamp = Date.now();

            const { pool: founderProjectPool } = await getUserProjectContext(founder.uid);
            await founderProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );

            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [`طلب سحب جديد بقيمة $${amount}`, timestamp, chatId]);
            
            if (sendOneSignalNotification) {
                await sendOneSignalNotification([founder.uid], BOT_USERNAME, `طلب سحب جديد من ${userDetails.username} بقيمة $${amount}.`, `${FRONTEND_URL}/?chatId=${chatId}`, userDetails.profile_bg_url);
            }
        } catch (error) {
            console.error("Error sending withdrawal request notification:", error);
        }
    }
    
    // ===== FIN DEL CÓDIGO AÑADIDO / MODIFICADO =====

    async function sendSellerApplicationToFounder(applicationId, userDetails) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '😎 الاداره'; 

        try {
            const founderResult = await pool.query("SELECT uid FROM users WHERE user_role = 'admin' LIMIT 1");
            if (founderResult.rows.length === 0) return;
            const founderId = founderResult.rows[0].uid;

            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([founderId])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp, profile_bg_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([founderId, BOT_UID]), null, Date.now(), "https://kdbtusugpqboxsaosaci.supabase.co/storage/v1/object/public/system-avatars/file_00000000aa7061f98f0e2efc79e076f2.png"]
                );
            }

            const appResult = await pool.query("SELECT image_urls FROM seller_applications WHERE id = $1", [applicationId]);
            const imageUrls = (appResult.rows.length > 0 && appResult.rows[0].image_urls) ? appResult.rows[0].image_urls : [];
            let imageUrlsText = (imageUrls.length > 0) ? "\n\n🖼️ صور مرفقة:\n" + imageUrls.join("\n") : "";
            
            const messageText = `
طلب جديد للانضمام كبائع من المستخدم: ${userDetails.username} (المعرف: ${userDetails.custom_id}).${imageUrlsText}

[SYSTEM_ACTION:SELLER_APP,APP_ID:${applicationId},USER_ID:${userDetails.uid}]
            `;
            const messageId = uuidv4();
            const timestamp = Date.now();

            const { pool: founderProjectPool } = await getUserProjectContext(founderId);
            await founderProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type)
                 VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );

            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', ["طلب بائع جديد", timestamp, chatId]);
            
            if (sendOneSignalNotification) {
               await sendOneSignalNotification([founderId], BOT_USERNAME, `لديك طلب بائع جديد من ${userDetails.username}.`, `${FRONTEND_URL}/?chatId=${chatId}`, userDetails.profile_bg_url); 
            }
        } catch (error) {
            console.error("Error sending seller application notification:", error);
        }
    }

    async function sendOrderNotificationToSeller(sellerId, buyerUsername, adTitle, shippingAddress) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot'; 
        const BOT_USERNAME = '🛒 تسويق وتسليجرم'; 

        try {
            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([sellerId])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp, profile_bg_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([sellerId, BOT_UID]), null, Date.now(), "https://kdbtusugpqboxsaosaci.supabase.co/storage/v1/object/public/system-avatars/images.png"]
                );
            }

            let shippingDetailsText = "";
            if (shippingAddress) {
                shippingDetailsText = `
\n🚚 عنوان الشحن:
الدولة: ${shippingAddress.country || 'غير محدد'}
المدينة: ${shippingAddress.city || 'غير محدد'}
العنوان: ${shippingAddress.address || 'غير محدد'}
`;
            }

            const messageText = `🎉 طلب بيع جديد!
المنتج: ${adTitle}
المشتري: ${buyerUsername}${shippingDetailsText}

يرجى مراجعة "طلبات البيع" في لوحة التحكم المالية الخاصة بك.`;
            const messageId = uuidv4();
            const timestamp = Date.now();
            
            const { pool: sellerProjectPool } = await getUserProjectContext(sellerId);
            await sellerProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) 
                 VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', ["لديك طلب بيع جديد", timestamp, chatId]);
        if (sendOneSignalNotification) {
            const sellerDetails = await getUserDetailsFromDefaultProject(sellerId);
            const sellerProfileBg = sellerDetails ? sellerDetails.profile_bg_url : "https://kdbtusugpqboxsaosaci.supabase.co/storage/v1/object/public/system-avatars/images.png";

            await sendOneSignalNotification(
    [sellerId],
    BOT_USERNAME,
    `🎉 لديك طلب بيع جديد للمنتج: ${adTitle}`,
    `${FRONTEND_URL}/?chatId=${chatId}`, 
    sellerProfileBg
);
        }
    } catch (error) {
        console.error("Error sending system notification to seller:", error);
    }
    }

    async function sendProblemReportToFounder(reportDetails) {
        const { transaction, reporter, role, description } = reportDetails;
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '🚨 سجل المشاكل'; 

        try {
            const founderResult = await pool.query("SELECT uid, profile_bg_url FROM users WHERE user_role = 'admin' LIMIT 1");
            if (founderResult.rows.length === 0) return;
            const founder = founderResult.rows[0];

            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([founder.uid])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp, profile_bg_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([founder.uid, BOT_UID]), null, Date.now(), "https://kdbtusugpqboxsaosaci.supabase.co/storage/v1/object/public/system-avatars/images%20(1).jpeg"]
                );
            }

            const seller = await getUserDetailsFromDefaultProject(transaction.seller_id);
            const buyer = await getUserDetailsFromDefaultProject(transaction.buyer_id);
            const reporterRoleText = role === 'buyer' ? 'المشتري' : 'البائع';

            const messageText = `
🚨 بلاغ جديد بخصوص مشكلة في طلب!
---
- **المنتج:** ${transaction.ad_title}
- **رقم الطلب:** ${transaction.id}
- **البائع:** ${seller.username} (${seller.custom_id})
- **المشتري:** ${buyer.username} (${buyer.custom_id})
---
- **مقدم البلاغ:** ${reporter.username} (${reporterRoleText})
- **نص المشكلة:**
${description}
---
**الإجراءات المقترحة (للمؤسس فقط):**
[SYSTEM_ACTION:RESOLVE_DISPUTE,TX_ID:${transaction.id},ACTION:REFUND_BUYER]
[SYSTEM_ACTION:RESOLVE_DISPUTE,TX_ID:${transaction.id},ACTION:PAY_SELLER]
            `;
            const messageId = uuidv4();
            const timestamp = Date.now();

            const { pool: founderProjectPool } = await getUserProjectContext(founder.uid);
            await founderProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );

            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', ["بلاغ مشكلة جديد", timestamp, chatId]);
            
            if (sendOneSignalNotification) {
                await sendOneSignalNotification([founder.uid], BOT_USERNAME, `بلاغ جديد بخصوص مشكلة من ${reporter.username}.`, `${FRONTEND_URL}/?chatId=${chatId}`, founder.profile_bg_url);
            }
        } catch (error) {
            console.error("Error sending problem report notification:", error);
        }
    }

    setInterval(async () => {
        const now = Date.now();
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                await pool.query('DELETE FROM marketing_ads WHERE ad_type = $1 AND deal_expiry < $2', ['deal', now]);
                await pool.query('UPDATE marketing_ads SET is_pinned = FALSE, pin_expiry = NULL WHERE is_pinned = TRUE AND pin_expiry < $1', [now]);
            } catch (error) {
                console.error(`[Project ${projectId}] Error during cleanup job:`, error);
            }
        }
    }, 5 * 60 * 1000);

    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads');
                
                const enrichedAds = await Promise.all(result.rows.map(async (ad) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
                    return { ...ad, seller_username: sellerDetails ? sellerDetails.username : 'غير معروف', seller_is_verified: sellerDetails ? sellerDetails.is_verified : false, seller_user_role: sellerDetails ? sellerDetails.user_role : 'normal' };
                }));
                allAds = allAds.concat(enrichedAds);
            }
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    const applicationUploads = upload.array('application_images', 3);
    router.post('/seller-application', applicationUploads, async(req, res) => {
        const { userId, details } = req.body;
        const files = req.files;
        if (!userId || !details || !files || files.length === 0) {
            return res.status(400).json({ error: "Details and images are required for application." });
        }
        try {
            const userDetails = await getUserDetailsFromDefaultProject(userId);
            if (!userDetails) return res.status(404).json({ error: "User not found." });
            const { supabase } = await getUserProjectContext(userId);
            let imageUrls = [];
            const imageBucket = 'seller-applications';
            for (const file of files) {
                const fileName = `${uuidv4()}.${file.originalname.split('.').pop()}`;
                const filePath = `${userId}/${fileName}`;
                const { error: uploadError } = await supabase.storage.from(imageBucket).upload(filePath, file.buffer, { contentType: file.mimetype });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from(imageBucket).getPublicUrl(filePath);
                imageUrls.push(publicUrlData.publicUrl);
            }
            const applicationId = uuidv4();
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            await defaultPool.query(`INSERT INTO seller_applications (id, user_id, details, image_urls, status, created_at) VALUES ($1, $2, $3, $4, 'pending', $5)`, [applicationId, userId, details, JSON.stringify(imageUrls), Date.now()]);
            await sendSellerApplicationToFounder(applicationId, userDetails);
            res.status(201).json({ message: "تم إرسال طلبك بنجاح. ستتم مراجعته قريباً." });
        } catch (error) {
            console.error("Error submitting seller application:", error);
            res.status(500).json({ error: "Failed to submit application." });
        }
    });

    router.post('/applications/:appId/action', async (req, res) => {
        const { appId } = req.params;
        const { action, callerUid } = req.body; 
        if (!callerUid || !action || !['approve', 'reject'].includes(action)) {
             return res.status(400).json({ error: "Missing or invalid parameters." });
        }
        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            if (!callerDetails || callerDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized." });
            }
            const appResult = await defaultPool.query("SELECT * FROM seller_applications WHERE id = $1", [appId]);
            if (appResult.rows.length === 0) return res.status(404).json({ error: "Application not found." });
            const application = appResult.rows[0];
            const newStatus = action === 'approve' ? 'approved' : 'rejected';
            await defaultPool.query("UPDATE seller_applications SET status = $1 WHERE id = $2", [newStatus, appId]);
            if (action === 'approve') {
                await defaultPool.query("UPDATE users SET is_approved_seller = TRUE WHERE uid = $1", [application.user_id]);
            }
            res.status(200).json({ message: `Application has been ${newStatus}.` });
        } catch (error) {
             console.error("Error processing application action:", error);
            res.status(500).json({ error: "Failed to process action." });
        }
    });

    const adUploads = upload.fields([{ name: 'images', maxCount: 3 }, { name: 'digital_product_file', maxCount: 1 }]);
    router.post('/', adUploads, async (req, res) => {
        const { title, description, price, ad_type, seller_id, deal_duration_hours, original_price, digital_product_type, shipping_countries, shipping_cost } = req.body;
        const imageFiles = req.files.images; 
        const digitalFile = req.files.digital_product_file ? req.files.digital_product_file[0] : null;

        if (!title || !description || !ad_type || !seller_id || !price) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            const sellerDetails = await getUserDetailsFromDefaultProject(seller_id);
            if (!sellerDetails || (!sellerDetails.is_approved_seller && sellerDetails.user_role !== 'admin')) {
                return res.status(403).json({ error: "You are not approved to publish products." });
            }
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrls = [];
            if (imageFiles && imageFiles.length > 0) {
                const imageBucket = 'marketing-images';
                for (const file of imageFiles) {
                    const fileName = `${uuidv4()}.${file.originalname.split('.').pop()}`;
                    const { error } = await supabase.storage.from(imageBucket).upload(`${seller_id}/${fileName}`, file.buffer, { contentType: file.mimetype });
                    if (error) throw error;
                    imageUrls.push(supabase.storage.from(imageBucket).getPublicUrl(`${seller_id}/${fileName}`).data.publicUrl);
                }
            }
            let digitalFileUrl = null;
            if (ad_type === 'digital_product' && digitalFile) {
                const digitalBucket = 'digital-products';
                const fileName = `${uuidv4()}.${digitalFile.originalname.split('.').pop()}`;
                const { error } = await supabase.storage.from(digitalBucket).upload(`${seller_id}/${fileName}`, digitalFile.buffer, { contentType: digitalFile.mimetype });
                if (error) throw error;
                digitalFileUrl = `${seller_id}/${fileName}`;
            }
            const adId = uuidv4();
            const timestamp = Date.now();
            let deal_expiry = ad_type === 'deal' ? timestamp + ((parseInt(deal_duration_hours, 10) || 1) * 3600000) : null;
            const countries = shipping_countries ? shipping_countries.split(',').map(c => c.trim()).filter(c => c) : null;
            await pool.query(`INSERT INTO marketing_ads (id, title, description, price, original_price, image_urls, ad_type, digital_product_type, digital_product_url, shipping_countries, shipping_cost, timestamp, is_deal, deal_expiry, seller_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [adId, title, description, price, original_price || null, JSON.stringify(imageUrls), ad_type, digital_product_type || null, digitalFileUrl, countries, shipping_cost || 0, timestamp, ad_type === 'deal', deal_expiry, seller_id]);
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    router.delete('/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid } = req.body;
        if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            const isAdmin = callerDetails && callerDetails.user_role === 'admin';
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    const ad = adResult.rows[0];
                    if (ad.seller_id !== callerUid && !isAdmin) return res.status(403).json({ error: "Unauthorized to delete." });
                    if (ad.image_urls && ad.image_urls.length > 0) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'marketing-images';
                        const filePaths = ad.image_urls.map(url => new URL(url).pathname.split(`/${bucketName}/`)[1]);
                        await supabase.storage.from(bucketName).remove(filePaths);
                    }
                    if (ad.digital_product_url) {
                        const supabase = projectSupabaseClients[projectId];
                        await supabase.storage.from('digital-products').remove([ad.digital_product_url]);
                    }
                    await pool.query('DELETE FROM marketing_ads WHERE id = $1', [adId]);
                    return res.status(200).json({ message: 'Ad deleted.' });
                }
            }
            return res.status(404).json({ error: 'Ad not found.' });
        } catch (error) {
            console.error("Error deleting ad:", error);
            res.status(500).json({ error: "Failed to delete ad." });
        }
    });

    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid, pin_duration_hours, paymentMethod } = req.body;
        const duration = parseInt(pin_duration_hours) || 1;
        const cost = duration * 10; // $10 per hour

        // ===== INICIO DE LA MODIFICACIÓN =====
        // Paso 1: Simular la verificación del pago
        // En una aplicación real, aquí llamarías a la API de Stripe o Binance
        // para confirmar que un pago por el `cost` ha sido recibido.
        // Como no podemos hacer eso, asumiremos que el pago fue exitoso.
        console.log(`Simulando pago de $${cost} a través de ${paymentMethod} para fijar el anuncio ${adId}.`);
        const paymentSuccessful = true; // Simulación
        // ===== FIN DE LA MODIFICACIÓN =====

        if (!paymentSuccessful) {
            return res.status(402).json({ error: "Payment failed or was not confirmed." });
        }

        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    // La autorización (asegurarse de que el callerUid es el dueño) ya no es necesaria
                    // porque el flujo de pago en el frontend ya lo maneja. Pero la mantenemos por seguridad.
                    if (adResult.rows[0].seller_id !== callerUid) return res.status(403).json({ error: "Unauthorized." });
                    
                    const expiry = Date.now() + (duration * 3600000);
                    await pool.query('UPDATE marketing_ads SET is_pinned = TRUE, pin_expiry = $1 WHERE id = $2', [expiry, adId]);
                    return res.status(200).json({ message: `Ad pinned successfully for ${duration} hour(s).` });
                }
            }
            return res.status(404).json({ error: "Ad not found." });
        } catch(error) {
            console.error("Error pinning ad:", error);
            res.status(500).json({ error: "Failed to pin ad." });
        }
    });

    router.get('/seller/wallet/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
            if (wallet.rows.length === 0) {
                await pool.query('INSERT INTO wallets (user_id) VALUES ($1)', [userId]);
                wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
            }
            res.status(200).json(wallet.rows[0]);
        } catch (error) {
            console.error("Error fetching wallet:", error);
            res.status(500).json({ error: "Failed to fetch wallet." });
        }
    });

    router.post('/purchase', async (req, res) => {
        const { adId, buyerId, amount, paymentMethod, shipping_address, used_points_discount } = req.body;
        if (!adId || !buyerId || !amount || !paymentMethod) return res.status(400).json({ error: "Missing required fields." });
        
        try {
            let adInfo = null;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; break; }
            }
            if (!adInfo) return res.status(404).json({ error: "Ad not found." });
            
            const isDigital = adInfo.ad_type === 'digital_product';
    
            if (!isDigital && (!shipping_address || !shipping_address.country)) {
                 return res.status(400).json({ error: "Shipping address is required for this product." });
            }
            if (!isDigital && adInfo.shipping_countries && adInfo.shipping_countries.length > 0) {
                if (!adInfo.shipping_countries.includes(shipping_address.country)) {
                    return res.status(400).json({ error: `Sorry, the seller does not ship to ${shipping_address.country}.` });
                }
            }

            let finalAmount = parseFloat(amount);
            if (used_points_discount) {
                const { pool: buyerPointsPool } = await getUserProjectContext(buyerId);
                const pointsResult = await buyerPointsPool.query("SELECT points FROM user_points WHERE user_id = $1", [buyerId]);
                if (pointsResult.rows.length === 0 || pointsResult.rows[0].points < 100) return res.status(400).json({ error: "Insufficient points." });
                const calculatedDiscountedAmount = parseFloat(adInfo.price) * 0.90;
                if (Math.abs(finalAmount - calculatedDiscountedAmount) > 0.01) return res.status(400).json({ error: "Price mismatch." });
                finalAmount = calculatedDiscountedAmount;
            }

            // ===== INICIO DE LA MODIFICACIÓN =====
            // Paso 2: Simular la verificación del pago
            // En una aplicación real, aquí llamarías a la API de Stripe o Binance
            // para confirmar que un pago por `finalAmount` ha sido recibido.
            // Aquí, simplemente asumimos que fue exitoso para continuar con la lógica.
            console.log(`Simulando pago de $${finalAmount} a través de ${paymentMethod} para el anuncio ${adId}.`);
            const paymentSuccessful = true; // Simulación
            // ===== FIN DE LA MODIFICACIÓN =====

            if (!paymentSuccessful) {
                return res.status(402).json({ error: "Payment failed or was not confirmed." });
            }
            
            const commission = finalAmount * 0.02;
            const transactionId = uuidv4();
            const { pool: buyerProjectPool } = await getUserProjectContext(buyerId);
            await buyerProjectPool.query(`INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, shipping_address, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11)`, [transactionId, adId, buyerId, adInfo.seller_id, finalAmount, commission, isDigital ? 'completed' : 'pending', paymentMethod, isDigital ? null : JSON.stringify(shipping_address), Date.now(), Date.now()]);
            
            if (used_points_discount) await (await getUserProjectContext(buyerId)).pool.query("UPDATE user_points SET points = points - 100 WHERE user_id = $1", [buyerId]);
            
            const { pool: sellerWalletPool } = await getUserProjectContext(adInfo.seller_id);
            if (isDigital) {
                await sellerWalletPool.query(`INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`, [adInfo.seller_id, finalAmount - commission]);
            } else {
                await sellerWalletPool.query(`INSERT INTO wallets (user_id, pending_balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET pending_balance = wallets.pending_balance + $2`, [adInfo.seller_id, finalAmount]);
            }
            
            const buyerDetails = await getUserDetailsFromDefaultProject(buyerId);
            await sendOrderNotificationToSeller(adInfo.seller_id, buyerDetails.username, adInfo.title, shipping_address);
            res.status(201).json({ message: isDigital ? "تم الشراء بنجاح!" : "تم الدفع بنجاح!", transactionId: transactionId });
        } catch (error) {
            console.error("Error during purchase:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });
    
router.get('/seller/orders/:userId', async (req, res) => {
    const { userId } = req.params;
    let allOrders = [];
    try {
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            const result = await pool.query(`SELECT * FROM transactions WHERE seller_id = $1`, [userId]);
            allOrders.push(...result.rows);
        }

        const enrichedOrders = await Promise.all(allOrders.map(async (order) => {
            const adDetails = await getAdFromAnyProject(order.ad_id);
            const buyerDetails = await getUserDetailsFromDefaultProject(order.buyer_id);
            return { 
                ...order, 
                ad_title: adDetails ? adDetails.title : 'إعلان محذوف',
                buyer_username: buyerDetails ? buyerDetails.username : 'N/A' 
            };
        }));

        enrichedOrders.sort((a,b) => b.created_at - a.created_at);
        res.status(200).json(enrichedOrders);
    } catch (error) {
        console.error("Error fetching seller orders:", error);
        res.status(500).json({ error: "Failed to fetch seller orders." });
    }
});

router.get('/buyer/orders/:userId', async (req, res) => {
    const { userId } = req.params;
    let allOrders = [];
    try {
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            const result = await pool.query(`SELECT * FROM transactions WHERE buyer_id = $1`, [userId]);
            allOrders.push(...result.rows);
        }

        const enrichedOrders = await Promise.all(allOrders.map(async (order) => {
            const adDetails = await getAdFromAnyProject(order.ad_id);
            const sellerDetails = await getUserDetailsFromDefaultProject(order.seller_id);
            return { 
                ...order, 
                ad_title: adDetails ? adDetails.title : 'إعلان محذوف',
                ad_type: adDetails ? adDetails.ad_type : null,
                digital_product_url: adDetails ? adDetails.digital_product_url : null,
                seller_username: sellerDetails ? sellerDetails.username : 'N/A' 
            };
        }));

        enrichedOrders.sort((a,b) => b.created_at - a.created_at);
        res.status(200).json(enrichedOrders);
    } catch (error) {
        console.error("Error fetching buyer orders:", error);
        res.status(500).json({ error: "Failed to fetch buyer orders." });
    }
});
    
    router.get('/seller/notifications/count/:userId', async (req, res) => {
        const { userId } = req.params;
        let totalCount = 0;
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query("SELECT COUNT(*) FROM transactions WHERE seller_id = $1 AND status = 'pending'", [userId]);
                totalCount += parseInt(result.rows[0].count, 10);
            }
            res.status(200).json({ count: totalCount });
        } catch (error) {
            console.error("Error fetching notification count:", error);
            res.status(500).json({ error: "Failed to fetch notification count." });
        }
    });

    router.post('/order/:transactionId/confirm', async (req, res) => {
        const { transactionId } = req.params;
        const { buyerId } = req.body; 
        try {
            let transaction, transactionPool;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; transactionPool = projectDbPools[projectId]; break; }
            }
            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== buyerId) return res.status(403).json({ error: "Unauthorized." });
            if (transaction.status !== 'pending') return res.status(400).json({ error: "Order already confirmed." });
            await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);
            const { pool: sellerWalletPool } = await getUserProjectContext(transaction.seller_id);
            const netAmount = parseFloat(transaction.amount) - parseFloat(transaction.commission);
            await sellerWalletPool.query(`UPDATE wallets SET pending_balance = wallets.pending_balance - $1, available_balance = wallets.available_balance + $2 WHERE user_id = $3`, [parseFloat(transaction.amount), netAmount, transaction.seller_id]);
            res.status(200).json({ message: "تم تأكيد الاستلام بنجاح!" });
        } catch (error) {
            console.error("Error confirming order:", error);
            res.status(500).json({ error: "Failed to confirm order." });
        }
    });
    
router.post('/report-problem', async (req, res) => {
    const { transactionId, reporterId, reporterRole, problemDescription } = req.body;
    if (!transactionId || !reporterId || !reporterRole || !problemDescription) {
        return res.status(400).json({ error: "Missing required fields for problem report." });
    }
    try {
        let transaction = null;
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
            if (result.rows.length > 0) {
                transaction = result.rows[0];
                break; 
            }
        }

        if (!transaction) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        const adDetails = await getAdFromAnyProject(transaction.ad_id);

        const fullTransactionDetails = {
            ...transaction,
            ad_title: adDetails ? adDetails.title : 'إعلان محذوف'
        };

        const reporterDetails = await getUserDetailsFromDefaultProject(reporterId);
        if (!reporterDetails) {
            return res.status(404).json({ error: "Reporter not found." });
        }

        await sendProblemReportToFounder({
            transaction: fullTransactionDetails,
            reporter: reporterDetails,
            role: reporterRole,
            description: problemDescription
        });

        res.status(200).json({ message: "تم إرسال بلاغك إلى الإدارة بنجاح." });
    } catch (error) {
        console.error("Error reporting problem:", error);
        res.status(500).json({ error: "Failed to report problem." });
    }
});

    router.post('/resolve-dispute', async (req, res) => {
        const { transactionId, callerUid, resolutionAction } = req.body; 
        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            if (!callerDetails || callerDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized: Admin access required." });
            }
            let transaction, transactionPool;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; transactionPool = projectDbPools[projectId]; break; }
            }
            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.status !== 'pending') return res.status(400).json({ error: "Dispute already resolved." });

            const { pool: sellerWalletPool } = await getUserProjectContext(transaction.seller_id);
            const { pool: buyerWalletPool } = await getUserProjectContext(transaction.buyer_id);
            const amount = parseFloat(transaction.amount);

            if (resolutionAction === 'REFUND_BUYER') {
                await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['refunded', Date.now(), transactionId]);
                // Quitar del saldo pendiente del vendedor
                await sellerWalletPool.query(`UPDATE wallets SET pending_balance = wallets.pending_balance - $1 WHERE user_id = $2`, [amount, transaction.seller_id]);
                // ===== INICIO DE LA MODIFICACIÓN =====
                // Devolver el monto al saldo disponible del comprador
                await buyerWalletPool.query(`
                    INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2) 
                    ON CONFLICT (user_id) 
                    DO UPDATE SET available_balance = wallets.available_balance + $2
                `, [transaction.buyer_id, amount]);
                // ===== FIN DE LA MODIFICACIÓN =====
                res.status(200).json({ message: "تمت إعادة المبلغ للمشتري بنجاح، وتم خصم المبلغ المعلق من البائع." });
            } else if (resolutionAction === 'PAY_SELLER') {
                await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);
                const netAmount = amount - parseFloat(transaction.commission);
                await sellerWalletPool.query(`UPDATE wallets SET pending_balance = wallets.pending_balance - $1, available_balance = wallets.available_balance + $2 WHERE user_id = $3`, [amount, netAmount, transaction.seller_id]);
                res.status(200).json({ message: "تم تأكيد الدفع للبائع بنجاح." });
            } else {
                return res.status(400).json({ error: "Invalid resolution action." });
            }
        } catch (error) {
            console.error("Error resolving dispute:", error);
            res.status(500).json({ error: "Failed to resolve dispute." });
        }
    });

    // ===== INICIO DEL CÓDIGO AÑADIDO / MODIFICADO (NUEVOS ENDPOINTS DE RETIRO) =====

    router.post('/withdraw', async (req, res) => {
        const { userId, amount, method, details } = req.body;
        if (!userId || !amount || !method || !details) {
            return res.status(400).json({ error: "Missing required withdrawal information." });
        }
        if ((method === 'crypto' && !details.walletAddress) || (method === 'stripe' && !details.cardInfo)) {
             return res.status(400).json({ error: "Missing payment details for withdrawal method." });
        }

        try {
            const userDetails = await getUserDetailsFromDefaultProject(userId);
            if (!userDetails) return res.status(404).json({ error: "User not found." });

            const { pool } = await getUserProjectContext(userId);
            
            const walletResult = await pool.query('SELECT available_balance FROM wallets WHERE user_id = $1', [userId]);
            if (walletResult.rows.length === 0 || parseFloat(walletResult.rows[0].available_balance) < parseFloat(amount)) {
                return res.status(400).json({ error: "Insufficient available balance." });
            }
            
            // Mover el balance de disponible a en proceso de retiro
            await pool.query(
                `UPDATE wallets SET 
                    available_balance = available_balance - $1, 
                    withdrawing_balance = withdrawing_balance + $1 
                 WHERE user_id = $2`, 
                [parseFloat(amount), userId]
            );

            // Crear el registro de retiro
            const withdrawalId = uuidv4();
            const timestamp = Date.now();
            await pool.query(
                `INSERT INTO withdrawals (id, user_id, amount, method, details, status, created_at, updated_at) 
                 VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
                [withdrawalId, userId, parseFloat(amount), method, JSON.stringify(details), timestamp, timestamp]
            );

            // Enviar notificación al fundador
            await sendWithdrawalRequestToFounder(withdrawalId, userDetails, amount, method);

            res.status(201).json({ message: "Your withdrawal request has been submitted and will be reviewed within 48 hours." });

        } catch (error) {
            console.error("Error processing withdrawal request:", error);
            // Revertir la transacción en la billetera si falla la inserción
            const { pool } = await getUserProjectContext(userId);
            await pool.query(
                `UPDATE wallets SET 
                    available_balance = available_balance + $1, 
                    withdrawing_balance = withdrawing_balance - $1 
                 WHERE user_id = $2`, 
                [parseFloat(amount), userId]
            );
            res.status(500).json({ error: "Failed to process withdrawal request." });
        }
    });

    router.get('/withdrawals/:userId', async (req, res) => {
        const { userId } = req.params;
        try {
            const { pool } = await getUserProjectContext(userId);
            const result = await pool.query("SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Error fetching withdrawal history:", error);
            res.status(500).json({ error: "Failed to fetch withdrawal history." });
        }
    });
    
    // Este endpoint es para el fundador para aprobar/rechazar retiros
    router.post('/withdrawals/:withdrawalId/action', async (req, res) => {
        const { withdrawalId } = req.params;
        const { action, callerUid } = req.body; // action: 'approve' o 'reject'

        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            if (!callerDetails || callerDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized." });
            }

            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const withdrawalResult = await defaultPool.query("SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending'", [withdrawalId]);
            if (withdrawalResult.rows.length === 0) {
                return res.status(404).json({ error: "Pending withdrawal request not found." });
            }
            const withdrawal = withdrawalResult.rows[0];
            const { pool: userPool } = await getUserProjectContext(withdrawal.user_id);
            const amount = parseFloat(withdrawal.amount);
            
            if (action === 'approve') {
                // El dinero ya se movió. Solo actualiza el estado y el balance en proceso de retiro.
                await userPool.query("UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1 WHERE user_id = $2", [amount, withdrawal.user_id]);
                await defaultPool.query("UPDATE withdrawals SET status = 'completed', updated_at = $1 WHERE id = $2", [Date.now(), withdrawalId]);
                // Aquí, el fundador enviaría manualmente el dinero a través de Binance/Stripe.
                // Luego, envía una notificación al usuario.
                // (La lógica de notificación se puede añadir aquí)
                res.status(200).json({ message: `Withdrawal ${withdrawalId} approved. You must now manually send $${amount} to the user.` });
            } else if (action === 'reject') {
                // Devuelve el dinero del balance en proceso de retiro al balance disponible.
                await userPool.query("UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1, available_balance = available_balance + $1 WHERE user_id = $2", [amount, withdrawal.user_id]);
                await defaultPool.query("UPDATE withdrawals SET status = 'rejected', updated_at = $1 WHERE id = $2", [Date.now(), withdrawalId]);
                // (La lógica de notificación se puede añadir aquí para informar al usuario sobre el rechazo)
                res.status(200).json({ message: `Withdrawal ${withdrawalId} rejected. The amount has been returned to the user's available balance.` });
            } else {
                return res.status(400).json({ error: "Invalid action." });
            }

        } catch (error) {
            console.error("Error processing withdrawal action:", error);
            res.status(500).json({ error: "Failed to process withdrawal action." });
        }
    });

    // ===== FIN DEL CÓDIGO AÑADIDO / MODIFICADO =====

    router.get('/download/:transactionId', async (req, res) => {
        const { transactionId } = req.params;
        const { callerUid } = req.query; 
        if (!callerUid) return res.status(401).json({ error: "Unauthorized." });
        try {
            let transaction;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; break; }
            }
            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== callerUid) return res.status(403).json({ error: "Unauthorized." });
            if (transaction.status !== 'completed') return res.status(400).json({ error: "Purchase not completed." });

            let adInfo, adProjectId;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT digital_product_url FROM marketing_ads WHERE id = $1', [transaction.ad_id]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; adProjectId = projectId; break; }
            }
            if (!adInfo || !adInfo.digital_product_url) return res.status(404).json({ error: "Digital file not found." });

            const supabase = projectSupabaseClients[adProjectId];
            const { data, error } = await supabase.storage.from('digital-products').createSignedUrl(adInfo.digital_product_url, 300); 
            if (error) throw error;
            res.status(200).json({ downloadUrl: data.signedUrl });
        } catch (error) {
            console.error("Error generating download link:", error);
            res.status(500).json({ error: "Failed to generate download link." });
        }
    });

    router.get('/points/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            const result = await pool.query('SELECT points FROM user_points WHERE user_id = $1', [userId]);
            res.status(200).json({ points: result.rows.length > 0 ? result.rows[0].points : 0 });
        } catch (error) {
            console.error("Error fetching points:", error);
            res.status(500).json({ error: "Failed to fetch points." });
        }
    });

    router.post('/points', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });
        const { pool } = await getUserProjectContext(userId);
        try {
            await pool.query(`INSERT INTO user_points (user_id, points, last_updated) VALUES ($1, 1, $2) ON CONFLICT (user_id) DO UPDATE SET points = user_points.points + 1, last_updated = $2`, [userId, Date.now()]);
            res.status(200).json({ message: "Point added." });
        } catch (error) {
            console.error("Error adding point:", error);
            res.status(500).json({ error: "Failed to add point." });
        }
    });

    return router;
};
