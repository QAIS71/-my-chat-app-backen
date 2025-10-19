// COPIED AND MODIFIED marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const crypto = require('crypto'); // <-- مكتبة للتحقق من الويب هوك

// IMPORTANT: Added 'stripe' to the function parameters
module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID, sendOneSignalNotification, FRONTEND_URL, stripe) {

    // =================================================================
    // نسبة عمولة NOWPayments (يمكنك تعديلها إذا تغيرت)
    const NOWPAYMENTS_FEE_PERCENT = 0.005; // 0.5%
    // =================================================================

    // ========== بداية التعديل: إضافة حد أدنى لـ NOWPayments ==========
    // !! هام: تحقق من وثائق NOWPayments للحصول على القيمة الدقيقة !!
    const MINIMUM_NOWPAYMENTS_AMOUNT = 1.00; // مثال: الحد الأدنى هو 1 دولار
    // ========== نهاية التعديل ==========


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

    // MODIFIED: Added reason for failure
    async function sendWithdrawalStatusToSeller(withdrawalRequest, status, reason = '') {
        const { seller_id, amount } = withdrawalRequest;
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '💰 تحديثات السحب';

        try {
            const sellerDetails = await getUserDetailsFromDefaultProject(seller_id);
            if (!sellerDetails) return;

            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([seller_id])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp, profile_bg_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([seller_id, BOT_UID]), null, Date.now(), "https://placehold.co/100x100/1e88e5/ffffff?text=W"]
                );
            }

            let messageText = '';
            let lastMessage = '';
            if (status === 'approved') {
                messageText = `✅ تم إرسال طلب السحب الخاص بك بمبلغ ${amount} USD بنجاح. قد يستغرق المبلغ بضعة أيام للوصول.`;
                lastMessage = 'تم إرسال طلب السحب';
            } else if (status === 'rejected') {
                messageText = `❌ فشل طلب السحب الخاص بك بمبلغ ${amount} USD. تم إعادة المبلغ إلى رصيدك المتاح. السبب: ${reason}`;
                lastMessage = 'فشل طلب السحب';
            } else {
                return;
            }

            const messageId = uuidv4();
            const timestamp = Date.now();

            const { pool: sellerProjectPool } = await getUserProjectContext(seller_id);
            await sellerProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type)
                 VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );

            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [lastMessage, timestamp, chatId]);

            if (sendOneSignalNotification) {
                await sendOneSignalNotification(
                    [seller_id],
                    BOT_USERNAME,
                    messageText,
                    `${FRONTEND_URL}`,
                    sellerDetails.profile_bg_url
                );
            }

        } catch (error) {
            console.error("Error sending withdrawal status notification to seller:", error);
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
                `${FRONTEND_URL}`,
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

    // MODIFIED: This now only handles crypto withdrawals
    async function sendWithdrawalRequestToFounder(withdrawalRequest) {
        const { id, seller_id, amount, method, withdrawal_details } = withdrawalRequest;

        // This function is now only for 'crypto'
        if (method !== 'crypto') {
            return;
        }

        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '💰 طلبات السحب';

        try {
            const founderResult = await pool.query("SELECT uid, profile_bg_url FROM users WHERE user_role = 'admin' LIMIT 1");
            if (founderResult.rows.length === 0) return;
            const founder = founderResult.rows[0];

            const sellerDetails = await getUserDetailsFromDefaultProject(seller_id);

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
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([founder.uid, BOT_UID]), null, Date.now(), "https://placehold.co/100x100/1e88e5/ffffff?text=W"]
                );
            }

            const netAmount = (parseFloat(amount) - (withdrawal_details.network === 'BEP20' ? 0.20 : 1.00)).toFixed(2);
            const detailsText = `
- **الشبكة:** ${withdrawal_details.network}
- **العنوان:** ${withdrawal_details.address}
- **الصافي بعد الرسوم:** ${netAmount} USD`;

            const messageText = `
💰 طلب سحب جديد (عملات رقمية)!
---
- **البائع:** ${sellerDetails.username} (ID: ${sellerDetails.custom_id})
- **المبلغ:** ${amount} USD
- **الطريقة:** عملات رقمية
- **التفاصيل:**
${detailsText}
---
**الإجراءات (للمؤسس فقط):**
[SYSTEM_ACTION:WITHDRAWAL_ACTION,ID:${id},ACTION:APPROVE]
[SYSTEM_ACTION:WITHDRAWAL_ACTION,ID:${id},ACTION:REJECT]
            `;

            const messageId = uuidv4();
            const timestamp = Date.now();
            const { pool: founderProjectPool } = await getUserProjectContext(founder.uid);
            await founderProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', ["طلب سحب جديد", timestamp, chatId]);

            if (sendOneSignalNotification) {
                await sendOneSignalNotification([founder.uid], BOT_USERNAME, `طلب سحب جديد بقيمة ${amount}$ من ${sellerDetails.username}.`, `${FRONTEND_URL}`, founder.profile_bg_url);
            }

        } catch (error) {
            console.error("Error sending withdrawal notification to founder:", error);
        }
    }

    setInterval(async () => {
        const now = Date.now();
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                await pool.query('DELETE FROM marketing_ads WHERE ad_type = $1 AND deal_expiry < $2', ['deal', now]);
                await pool.query('UPDATE marketing_ads SET is_pinned = FALSE, pin_expiry = NULL WHERE is_pinned = TRUE AND pin_expiry < $1', [now]);
                await pool.query("UPDATE transactions SET status = 'cancelled' WHERE status = 'awaiting_payment' AND created_at < $1", [now - (15 * 60 * 1000)]);
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
        const { callerUid, pin_duration_hours } = req.body;
        const duration = parseInt(pin_duration_hours) || 1;
        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) return res.status(403).json({ error: "Unauthorized." });
                    return res.status(200).json({ message: `Pinning request for ${duration} hour(s) received. Proceed to payment.` });
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

    // START: MODIFIED - WITHDRAWAL ROUTE (AUTOMATIC STRIPE, MANUAL CRYPTO)
    router.post('/withdraw', async (req, res) => {
        const { sellerId, amount, method, details } = req.body;
        if (!sellerId || !amount || !method || !details) {
            return res.status(400).json({ error: "Missing withdrawal information." });
        }

        const parsedAmount = parseFloat(amount);
        const { pool } = await getUserProjectContext(sellerId);
        const withdrawalId = uuidv4();
        const now = Date.now();

        try {
            await pool.query('BEGIN');
            const walletResult = await pool.query("SELECT available_balance FROM wallets WHERE user_id = $1 FOR UPDATE", [sellerId]);
            if (walletResult.rows.length === 0 || parseFloat(walletResult.rows[0].available_balance) < parsedAmount) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient available balance." });
            }
            await pool.query(
                "UPDATE wallets SET available_balance = available_balance - $1, withdrawing_balance = withdrawing_balance + $1 WHERE user_id = $2",
                [parsedAmount, sellerId]
            );
            const withdrawalResult = await pool.query(
                `INSERT INTO withdrawals (id, seller_id, amount, method, status, withdrawal_details, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING *`,
                [withdrawalId, sellerId, parsedAmount, method, JSON.stringify(details), now, now]
            );
            await pool.query('COMMIT');

            const withdrawalRequest = withdrawalResult.rows[0];

            if (method === 'crypto') {
                await sendWithdrawalRequestToFounder(withdrawalRequest);
                res.status(201).json({ message: "تم استلام طلب السحب الخاص بك بنجاح، ستتم مراجعته خلال 48 ساعة." });
            } else if (method === 'stripe') {
                // AUTOMATIC STRIPE PAYOUT
                if (!stripe) {
                    throw new Error("Stripe is not configured on the server.");
                }
                try {
                    // Stripe requires amount in cents
                    const amountInCents = Math.round(parsedAmount * 100);
                    // This creates a payout to a debit card/bank account represented by the token
                    const payout = await stripe.payouts.create({
                        amount: amountInCents,
                        currency: 'usd',
                        method: 'instant', // or 'standard'
                        destination: details.token, // This should be a card or bank account token
                        description: `Payout for seller ${sellerId}`
                    });

                    // Payout initiated successfully, update status
                    await pool.query("UPDATE withdrawals SET status = 'approved', updated_at = $1 WHERE id = $2", [Date.now(), withdrawalId]);
                    await pool.query("UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1 WHERE user_id = $2", [parsedAmount, sellerId]);

                    await sendWithdrawalStatusToSeller(withdrawalRequest, 'approved');
                    res.status(200).json({ message: "تم إرسال طلب السحب بنجاح وسيتم معالجته." });

                } catch (stripeError) {
                    console.error("Stripe Payout Error:", stripeError);
                    // If payout fails, revert the balance change
                    await pool.query(
                        "UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1, available_balance = available_balance + $1 WHERE user_id = $2",
                        [parsedAmount, sellerId]
                    );
                    await pool.query("UPDATE withdrawals SET status = 'rejected', updated_at = $1 WHERE id = $2", [Date.now(), withdrawalId]);
                    await sendWithdrawalStatusToSeller(withdrawalRequest, 'rejected', stripeError.message);
                    res.status(500).json({ error: `فشل السحب عبر Stripe: ${stripeError.message}` });
                }
            }
        } catch (error) {
            await pool.query('ROLLBACK').catch(rbError => console.error("Rollback failed:", rbError));
            console.error("Error processing withdrawal:", error);
            res.status(500).json({ error: "Failed to process withdrawal." });
        }
    });
    // END: MODIFIED - WITHDRAWAL ROUTE

    router.post('/withdrawals/:id/action', async (req, res) => {
        const { id } = req.params;
        const { action, callerUid } = req.body;

        if (!callerUid || !action || !['approve', 'reject'].includes(action)) {
             return res.status(400).json({ error: "Missing or invalid parameters." });
        }

        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            if (!callerDetails || callerDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized." });
            }

            let withdrawal, withdrawalPool;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query("SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' AND method = 'crypto'", [id]);
                if (result.rows.length > 0) {
                    withdrawal = result.rows[0];
                    withdrawalPool = pool;
                    break;
                }
            }

            if (!withdrawal) {
                return res.status(404).json({ error: "Pending crypto withdrawal request not found." });
            }

            const { pool: sellerWalletPool } = await getUserProjectContext(withdrawal.seller_id);

            await sellerWalletPool.query('BEGIN');

            if (action === 'approve') {
                await sellerWalletPool.query("UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1 WHERE user_id = $2", [withdrawal.amount, withdrawal.seller_id]);
                await withdrawalPool.query("UPDATE withdrawals SET status = 'approved', updated_at = $1 WHERE id = $2", [Date.now(), id]);

                await sellerWalletPool.query('COMMIT');
                await sendWithdrawalStatusToSeller(withdrawal, 'approved');
                res.status(200).json({ message: "Withdrawal approved." });

            } else if (action === 'reject') {
                await sellerWalletPool.query(
                    "UPDATE wallets SET withdrawing_balance = withdrawing_balance - $1, available_balance = available_balance + $1 WHERE user_id = $2",
                    [withdrawal.amount, withdrawal.seller_id]
                );
                await withdrawalPool.query("UPDATE withdrawals SET status = 'rejected', updated_at = $1 WHERE id = $2", [Date.now(), id]);

                await sellerWalletPool.query('COMMIT');
                await sendWithdrawalStatusToSeller(withdrawal, 'rejected', 'تم الرفض من قبل الإدارة');
                res.status(200).json({ message: "Withdrawal rejected." });
            }

        } catch (error) {
            console.error("Error processing withdrawal action:", error);
            try {
                for (const projectId in projectDbPools) {
                   await projectDbPools[projectId].query('ROLLBACK');
                }
            } catch (rbError) {
                console.error("Rollback failed:", rbError);
            }
            res.status(500).json({ error: "Failed to process withdrawal action." });
        }
    });

    router.get('/seller/withdrawals/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            const result = await pool.query('SELECT * FROM withdrawals WHERE seller_id = $1 ORDER BY created_at DESC', [userId]);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error("Error fetching withdrawal history:", error);
            res.status(500).json({ error: "Failed to fetch withdrawal history." });
        }
    });

    router.post('/purchase', async (req, res) => {
        res.status(400).json({error: "This endpoint is deprecated. Use specific payment endpoints."});
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
            if (transaction.status !== 'pending') return res.status(400).json({ error: "Order already confirmed or refunded." });

            await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);

            const { pool: sellerWalletPool } = await getUserProjectContext(transaction.seller_id);
            const totalAmount = parseFloat(transaction.amount);
            const companyCommission = parseFloat(transaction.commission);
            const gatewayFee = parseFloat(transaction.payment_gateway_fee);
            const netAmount = totalAmount - companyCommission - gatewayFee;

            await sellerWalletPool.query(
                `UPDATE wallets SET pending_balance = pending_balance - $1, available_balance = available_balance + $2 WHERE user_id = $3`,
                [totalAmount, netAmount, transaction.seller_id]
            );
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
            const fullTransactionDetails = { ...transaction, ad_title: adDetails ? adDetails.title : 'إعلان محذوف' };
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
            const amount = parseFloat(transaction.amount);

            if (resolutionAction === 'REFUND_BUYER') {
                await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['refunded', Date.now(), transactionId]);
                await sellerWalletPool.query(`UPDATE wallets SET pending_balance = wallets.pending_balance - $1 WHERE user_id = $2`, [amount, transaction.seller_id]);
                const { pool: buyerWalletPool } = await getUserProjectContext(transaction.buyer_id);
                // For a refund, we assume the full amount is returned to the buyer's app wallet.
                // You might adjust this logic if refunds go back to the original payment method.
                await buyerWalletPool.query(
                    `INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`,
                    [transaction.buyer_id, amount]
                );
                res.status(200).json({ message: "تمت إعادة المبلغ إلى محفظة المشتري، وتم خصم المبلغ المعلق من البائع." });
            } else if (resolutionAction === 'PAY_SELLER') {
                await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);
                const companyCommission = parseFloat(transaction.commission);
                const gatewayFee = parseFloat(transaction.payment_gateway_fee);
                const netAmount = amount - companyCommission - gatewayFee;
                await sellerWalletPool.query(`UPDATE wallets SET pending_balance = wallets.pending_balance - $1, available_balance = available_balance + $2 WHERE user_id = $3`, [amount, netAmount, transaction.seller_id]);
                res.status(200).json({ message: "تم تأكيد الدفع للبائع بنجاح." });
            } else {
                return res.status(400).json({ error: "Invalid resolution action." });
            }
        } catch (error) {
            console.error("Error resolving dispute:", error);
            res.status(500).json({ error: "Failed to resolve dispute." });
        }
    });

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

    router.post('/support/start', async (req, res) => {
        const { userId } = req.body;
        const supportAgentCustomId = '88939087';
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];

        try {
            const userDetails = await getUserDetailsFromDefaultProject(userId);
            const agentResult = await defaultPool.query("SELECT uid, username, profile_bg_url FROM users WHERE custom_id = $1", [supportAgentCustomId]);

            if (!userDetails || agentResult.rows.length === 0) {
                return res.status(404).json({ error: "User or support agent not found." });
            }
            const agentDetails = agentResult.rows[0];

            let chatResult = await defaultPool.query(
                `SELECT id, contact_names FROM chats WHERE type = 'private' AND participants @> $1::jsonb AND participants @> $2::jsonb`,
                [JSON.stringify([userId]), JSON.stringify([agentDetails.uid])]
            );

            if (chatResult.rows.length > 0) {
                const chat = chatResult.rows[0];
                res.status(200).json({ chatId: chat.id, chatName: chat.contact_names[userId] || agentDetails.username, agentProfileBg: agentDetails.profile_bg_url });
            } else {
                const newChatId = uuidv4();
                const contactNames = {
                    [userId]: "الدعم الفني",
                    [agentDetails.uid]: userDetails.username
                };
                await defaultPool.query(
                    `INSERT INTO chats (id, type, participants, contact_names, timestamp) VALUES ($1, 'private', $2, $3, $4)`,
                    [newChatId, JSON.stringify([userId, agentDetails.uid]), JSON.stringify(contactNames), Date.now()]
                );
                res.status(201).json({ chatId: newChatId, chatName: "الدعم الفني", agentProfileBg: agentDetails.profile_bg_url });
            }
        } catch (error) {
            console.error("Error starting support chat:", error);
            res.status(500).json({ error: "Failed to start support chat." });
        }
    });

    router.post('/payment/stripe/create-payment-intent', async (req, res) => {
        const { items, buyerId, adId, shippingAddress, isPinning, pinHours, usePointsDiscount } = req.body;
        const transactionId = uuidv4(); // Generate transaction ID here

        if (!stripe) {
            return res.status(500).json({ error: "Stripe integration is not configured on the server." });
        }

        try {
            let totalAmount = items.reduce((sum, item) => sum + (item.amount * item.quantity), 0);
            let discountWasUsed = false;

            if (usePointsDiscount && !isPinning) {
                const { pool: buyerPool } = await getUserProjectContext(buyerId);
                const pointsResult = await buyerPool.query('SELECT points FROM user_points WHERE user_id = $1', [buyerId]);
                const userPoints = pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0;

                if (userPoints >= 100) {
                    const adInfoForPrice = await getAdFromAnyProject(adId);
                    if (!adInfoForPrice) throw new Error("Ad not found for price calculation.");
                    let originalPrice = parseFloat(adInfoForPrice.price);
                    let shipping = parseFloat(adInfoForPrice.shipping_cost) || 0;
                    totalAmount = (originalPrice * 0.90) + shipping;
                    discountWasUsed = true;
                    console.log(`Stripe: تم تطبيق خصم النقاط للمستخدم ${buyerId}. السعر الجديد: ${totalAmount}`);
                } else {
                    console.log(`Stripe: محاولة استخدام خصم النقاط للمستخدم ${buyerId} بدون رصيد كافٍ. تم تجاهل الخصم.`);
                }
            }

            const amountInCents = Math.round(totalAmount * 100);
            const adInfo = await getAdFromAnyProject(adId);
            if (!adInfo && !isPinning) throw new Error("Ad not found.");

            const sellerId = isPinning ? 'platform_owner' : adInfo.seller_id;
            const companyCommission = isPinning ? 0 : totalAmount * 0.02; // 2%
            const stripeFeeEstimate = isPinning ? 0 : (totalAmount * 0.029) + 0.30; // Estimate: 2.9% + $0.30
            const isDigital = adInfo ? adInfo.ad_type === 'digital_product' : false;

             // Insert transaction record BEFORE creating payment intent
             const { pool } = await getUserProjectContext(buyerId);
             await pool.query(
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, payment_gateway_fee, status, payment_method, shipping_address, created_at, updated_at, used_points_discount)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, 'stripe', $9, $10, $11, $12)`,
                [transactionId, adId, buyerId, sellerId, totalAmount, companyCommission, stripeFeeEstimate, 'awaiting_payment', isDigital ? null : JSON.stringify(shippingAddress), Date.now(), Date.now(), discountWasUsed]
            );


            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: 'usd',
                automatic_payment_methods: {
                    enabled: true,
                },
                metadata: {
                    // **Important:** transaction_id is crucial for webhook to link payment to order
                    transaction_id: transactionId,
                    // Other metadata remains the same
                    ad_id: adId,
                    buyer_id: buyerId,
                    is_pinning: isPinning ? 'true' : 'false', // Convert boolean to string for metadata
                    pin_hours: pinHours ? pinHours.toString() : '0', // Convert number to string
                    used_points_discount: discountWasUsed ? 'true' : 'false' // Convert boolean to string
                }
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
                transactionId: transactionId // Send transactionId back to frontend if needed
            });

        } catch (error) {
            console.error("Stripe Payment Intent Error:", error);
            res.status(500).json({ error: error.message });
        }
    });


    // #################################################################
    // ##### الكود الجديد لنظام الدفع بـ NOWPayments يبدأ هنا #####
    // #################################################################

    router.post('/payment/nowpayments/create-invoice', async (req, res) => {
    // 1. نستقبل المتغير الجديد هنا أيضاً
    let { amount, buyerId, adId, isPinning, pinHours, shippingAddress, usePointsDiscount } = req.body;

    try {
        const transactionId = uuidv4();
        const { pool } = await getUserProjectContext(buyerId);

        const adInfo = await getAdFromAnyProject(adId);
        if (!adInfo && !isPinning) {
            return res.status(404).json({ error: "Ad not found." });
        }

        let finalAmount = parseFloat(amount); // Use amount from request as base
        let discountWasUsed = false;

        // 2. نضيف نفس منطق التحقق من النقاط وحساب السعر بأمان *إذا* كان الخصم مطلوباً
        if (usePointsDiscount && !isPinning) {
            const pointsResult = await pool.query('SELECT points FROM user_points WHERE user_id = $1', [buyerId]);
            const userPoints = pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0;

            if (userPoints >= 100) {
                // نعيد حساب السعر من قاعدة البيانات لضمان عدم التلاعب
                let originalPrice = parseFloat(adInfo.price);
                let shipping = parseFloat(adInfo.shipping_cost) || 0;
                finalAmount = (originalPrice * 0.90) + shipping; // Recalculate based on DB price + shipping
                discountWasUsed = true; // نجهز العلامة للحفظ في قاعدة البيانات
                console.log(`NOWPayments: تم تطبيق خصم النقاط للمستخدم ${buyerId}. السعر الجديد: ${finalAmount}`);
            } else {
                 console.log(`NOWPayments: محاولة استخدام خصم النقاط للمستخدم ${buyerId} بدون رصيد كافٍ. تم تجاهل الخصم.`);
                 // لا نغير finalAmount إذا لم يكن هناك نقاط كافية
            }
        } else if (!isPinning) {
            // **هام:** إذا لم يتم استخدام خصم النقاط، يجب التأكد من أن السعر يتضمن تكلفة الشحن
             let originalPrice = parseFloat(adInfo.price);
             let shipping = parseFloat(adInfo.shipping_cost) || 0;
             finalAmount = originalPrice + shipping;
             console.log(`NOWPayments: لم يتم استخدام خصم النقاط. السعر النهائي (مع الشحن): ${finalAmount}`);
        }
        // إذا كان isPinning، فإن finalAmount (المستلم من الطلب) هو السعر الصحيح


        // ========== بداية التعديل: إضافة فحص الحد الأدنى ==========
        if (finalAmount < MINIMUM_NOWPAYMENTS_AMOUNT) {
            console.error(`NOWPayments Error: Amount ${finalAmount} is below the minimum required ${MINIMUM_NOWPAYMENTS_AMOUNT}`);
            return res.status(400).json({ error: `المبلغ المطلوب (${finalAmount.toFixed(2)}$) أقل من الحد الأدنى للدفع عبر NOWPayments (${MINIMUM_NOWPAYMENTS_AMOUNT.toFixed(2)}$).` });
        }
        // ========== نهاية التعديل ==========


        const sellerId = isPinning ? 'platform_owner' : adInfo.seller_id;
        const companyCommission = isPinning ? 0 : finalAmount * 0.02;
        const nowPaymentsFee = isPinning ? 0 : finalAmount * NOWPAYMENTS_FEE_PERCENT; // Use constant
        const isDigital = adInfo ? adInfo.ad_type === 'digital_product' : false;

        // 3. نعدل أمر الإضافة ليحفظ العلامة الجديدة used_points_discount
        await pool.query(
            `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, payment_gateway_fee, status, payment_method, shipping_address, created_at, updated_at, used_points_discount)
             VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, 'nowpayments', $9, $10, $11, $12)`,
            [transactionId, adId, buyerId, sellerId, finalAmount, companyCommission, nowPaymentsFee, 'awaiting_payment', isDigital ? null : JSON.stringify(shippingAddress), Date.now(), Date.now(), discountWasUsed]
        );

        // 4. نرسل السعر النهائي (بعد الخصم إن وجد) إلى NOWPayments
        console.log(`Sending amount to NOWPayments: ${finalAmount}`); // Log the amount being sent
        const response = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: finalAmount, // نستخدم السعر النهائي هنا
                price_currency: 'usd',     // Currency the price is specified in
                pay_currency: 'usdtbsc',   // Currency the user will pay with
                order_id: transactionId,
                ipn_callback_url: `${process.env.YOUR_BACKEND_URL}/api/marketing/payment/nowpayments/webhook`,
                // يمكنك إضافة معلمات أخرى مثل order_description إذا أردت
                // order_description: `Purchase of ${adInfo ? adInfo.title : 'Ad Pinning'}`,
                // is_fee_paid_by_user: false // الشركة تتحمل الرسوم
            })
        });

            const invoiceData = await response.json();

            if (!response.ok) {
                // Log detailed error from NOWPayments
                console.error("NOWPayments API Error:", invoiceData);
                 // Rollback the transaction insert if invoice creation fails? Optional, but good practice.
                 await pool.query("DELETE FROM transactions WHERE id = $1", [transactionId]).catch(delErr => console.error("Failed to rollback transaction:", delErr));
                throw new Error(invoiceData.message || 'Failed to create NOWPayments invoice.');
            }

            res.status(201).json({
                message: "Invoice created successfully.",
                transactionId: transactionId,
                paymentDetails: invoiceData // Send full details back
            });

        } catch (error) {
            console.error("Error creating NOWPayments invoice:", error);
            // Return the specific error message if available, otherwise generic
            res.status(500).json({ error: error.message || "Failed to create payment order." });
        }
    });

    router.post('/payment/nowpayments/webhook', express.json({type: '*/*'}), async (req, res) => {
        const signature = req.headers['x-nowpayments-sig'];
        const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

        try {
            // التحقق من صحة التوقيع
            const hmac = crypto.createHmac('sha512', ipnSecret);
            hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
            const expectedSignature = hmac.digest('hex');

            if (signature !== expectedSignature) {
                console.warn("Invalid NOWPayments webhook signature received.");
                return res.status(401).send('Invalid signature');
            }

            const { payment_status, order_id, actually_paid, outcome_amount } = req.body; // Added outcome_amount
            console.log(`Webhook received for order ${order_id} with status: ${payment_status}. Actually paid: ${actually_paid}, Outcome: ${outcome_amount}`);

            let transaction, transactionPool;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                // Check for 'awaiting_payment' OR 'partially_paid' if you handle partial payments
                const result = await pool.query("SELECT * FROM transactions WHERE id = $1 AND (status = 'awaiting_payment' OR status = 'partially_paid')", [order_id]);
                if (result.rows.length > 0) {
                    transaction = result.rows[0];
                    transactionPool = pool;
                    break;
                }
            }

            if (!transaction) {
                console.log(`Transaction ${order_id} not found or already processed.`);
                return res.status(200).send('OK'); // Acknowledge webhook even if transaction not found/processed
            }

            // التعامل مع حالات الدفع المختلفة
             if (payment_status === 'finished' || payment_status === 'paid' || payment_status === 'confirmed' || payment_status === 'sending') {
                // Check if the amount paid matches expected (optional but recommended)
                // Note: NOWPayments might send webhook multiple times (confirmed, sending, finished). Handle idempotency.
                const expectedAmount = parseFloat(transaction.amount);
                // Use outcome_amount if available, otherwise actually_paid
                const paidAmount = parseFloat(outcome_amount || actually_paid);

                if (paidAmount >= expectedAmount * 0.99) { // Allow for small discrepancies
                    const adDetails = await getAdFromAnyProject(transaction.ad_id);

                    if (transaction.seller_id === 'platform_owner') {
                        // Handle ad pinning
                        const pinHours = 1; // You might need to retrieve this from transaction metadata if variable hours are allowed
                        const expiry = Date.now() + (pinHours * 3600000);
                        // Find the ad in its correct project and update
                        for (const pid in projectDbPools) {
                            const adPool = projectDbPools[pid];
                            const updateResult = await adPool.query('UPDATE marketing_ads SET is_pinned = TRUE, pin_expiry = $1 WHERE id = $2', [expiry, transaction.ad_id]);
                            if (updateResult.rowCount > 0) break; // Stop once updated
                        }
                        await transactionPool.query("UPDATE transactions SET status = 'completed', updated_at = $1 WHERE id = $2", [Date.now(), transaction.id]);
                        console.log(`Ad ${transaction.ad_id} pinning confirmed via webhook.`);
                    } else {
                        // Handle regular product purchase
                        const isDigital = adDetails && adDetails.ad_type === 'digital_product';
                        const newStatus = isDigital ? 'completed' : 'pending'; // Digital completed, physical pending seller action

                         // Only update if status is still 'awaiting_payment' or 'partially_paid'
                        const updateRes = await transactionPool.query(
                            "UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3 AND (status = 'awaiting_payment' OR status = 'partially_paid')",
                            [newStatus, Date.now(), transaction.id]
                        );

                        if (updateRes.rowCount > 0) { // Check if update actually happened
                            const { pool: sellerWalletPool } = await getUserProjectContext(transaction.seller_id);
                            const totalAmount = parseFloat(transaction.amount);

                            if (isDigital) {
                                // Digital product: Add net amount directly to available balance
                                const companyCommission = parseFloat(transaction.commission);
                                const gatewayFee = parseFloat(transaction.payment_gateway_fee);
                                const netAmount = totalAmount - companyCommission - gatewayFee;
                                await sellerWalletPool.query(
                                    `INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2)
                                     ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`,
                                    [transaction.seller_id, netAmount]
                                );
                            } else {
                                // Physical product: Add total amount to pending balance
                                await sellerWalletPool.query(
                                    `INSERT INTO wallets (user_id, pending_balance) VALUES ($1, $2)
                                     ON CONFLICT (user_id) DO UPDATE SET pending_balance = wallets.pending_balance + $2`,
                                    [transaction.seller_id, totalAmount]
                                );
                            }

                             // Deduct points only AFTER successful payment confirmation
                            if (transaction.used_points_discount) {
                                try {
                                    const { pool: buyerPool } = await getUserProjectContext(transaction.buyer_id);
                                    await buyerPool.query(
                                        `UPDATE user_points SET points = points - 100 WHERE user_id = $1 AND points >= 100`,
                                        [transaction.buyer_id]
                                    );
                                    console.log(`NOWPayments: Points deducted for user ${transaction.buyer_id} after successful payment.`);
                                } catch (pointsError) {
                                    console.error(`NOWPayments: Failed to deduct points for user ${transaction.buyer_id} after payment:`, pointsError);
                                }
                            }

                            // Send notification to seller
                            const buyerDetails = await getUserDetailsFromDefaultProject(transaction.buyer_id);
                            await sendOrderNotificationToSeller(transaction.seller_id, buyerDetails.username, adDetails.title, transaction.shipping_address);
                            console.log(`Transaction ${order_id} confirmed via webhook. Status set to ${newStatus}.`);
                        } else {
                             console.log(`Transaction ${order_id} webhook received, but transaction was already processed. Ignoring.`);
                        }
                    }
                } else {
                    // Handle underpayment or other issues
                    console.warn(`Potential underpayment for order ${order_id}. Expected: ${expectedAmount}, Paid: ${paidAmount}. Status: ${payment_status}`);
                    // Optionally set status to 'underpaid' or 'failed'
                    await transactionPool.query("UPDATE transactions SET status = 'failed', updated_at = $1 WHERE id = $2", [Date.now(), transaction.id]);
                }
            } else if (['failed', 'expired', 'refunded'].includes(payment_status)) {
                // Payment failed, expired, or was refunded
                await transactionPool.query("UPDATE transactions SET status = 'cancelled', updated_at = $1 WHERE id = $2 AND status = 'awaiting_payment'", [Date.now(), transaction.id]);
                 console.log(`Transaction ${order_id} failed/expired/refunded via webhook. Status set to cancelled.`);
            } else if (payment_status === 'partially_paid') {
                 await transactionPool.query("UPDATE transactions SET status = 'partially_paid', updated_at = $1 WHERE id = $2 AND status = 'awaiting_payment'", [Date.now(), transaction.id]);
                 console.log(`Transaction ${order_id} is partially paid via webhook.`);
                 // Optionally notify admin or seller about partial payment
            }


            res.status(200).send('OK'); // Acknowledge receipt of the webhook

        } catch (error) {
            console.error("Error processing NOWPayments webhook:", error);
            res.status(500).send('Webhook processing error');
        }
    });

    // #################################################################
    // ##### الكود الجديد لنظام الدفع بـ NOWPayments ينتهي هنا #####
    // #################################################################


    router.get('/payment/status/:transactionId', async (req, res) => {
        const { transactionId } = req.params;
        try {
            let transaction;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT status FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; break; }
            }
            if (!transaction) return res.status(404).json({ error: "Transaction not found." });

            const isPaid = !['awaiting_payment', 'cancelled', 'failed', 'expired', 'partially_paid'].includes(transaction.status);

            res.status(200).json({ status: isPaid ? 'PAID' : 'UNPAID', transaction_status: transaction.status });
        } catch(error) {
             console.error("Error checking payment status:", error); // Added logging
            res.status(500).json({ error: "Failed to check payment status." });
        }
    });


    // NEW: AI Assistant Endpoint
    router.post('/ai-assistant', async (req, res) => {
        const { prompt, history } = req.body;
        if (!prompt) return res.status(400).json({ error: "Prompt is required." });

        try {
            let allAds = [];
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                // Select only necessary fields for context
                const result = await pool.query('SELECT id, title, description, price, ad_type, image_urls FROM marketing_ads');
                allAds.push(...result.rows);
            }

             // Enhance context with image URL if available
            const productContext = allAds.map(ad => ({
                id: ad.id,
                title: ad.title,
                type: ad.ad_type,
                price: ad.price,
                description: ad.description ? ad.description.substring(0, 100) + '...' : '', // Short description
                // image: (ad.image_urls && ad.image_urls.length > 0) ? ad.image_urls[0] : null // Include first image URL
            })).slice(0, 50); // Limit context size

            const systemPrompt = `
                أنت مساعد تسوق ذكي ولطيف اسمك "ذوقي". مهمتك هي مساعدة المستخدمين في العثور على المنتجات والإجابة على أسئلتهم المتعلقة بالموضة والتسوق ضمن المنتجات المتاحة في المتجر.
                تحدث باللغة العربية بأسلوب ودود وجذاب.
                استخدم الرموز التعبيرية بشكل مناسب لجعل الحديث ممتعاً.
                هذه هي قائمة المنتجات المتوفرة حالياً (معرف المنتج، العنوان، النوع، السعر، وصف مختصر): ${JSON.stringify(productContext)}.
                عندما توصي بمنتج، يجب أن تذكر اسمه وسعره وتستخدم الصيغة التالية بالضبط في نهاية توصيتك للمنتج المحدد: [PRODUCT:معرف_المنتج]. يمكنك التوصية بمنتجات متعددة إذا كان ذلك مناسباً، مع تكرار الصيغة لكل منتج.
                لا تخترع منتجات غير موجودة في القائمة المقدمة. إذا سأل المستخدم عن شيء غير موجود، اقترح بديلاً مناسباً من القائمة أو اعتذر بلطف 😔.
                إذا لم تكن متأكداً من الإجابة أو لم تجد منتجاً مناسباً، قل ذلك بصدق.
                حافظ على إجاباتك موجزة ومفيدة.
            `;

            // Combine system prompt with user history and current prompt
             const fullHistoryForAPI = [
                 // System prompt should ideally be handled differently by the Gemini API if possible,
                 // but including it as the first 'user' message works as a basic setup.
                { role: "user", parts: [{ text: systemPrompt }] },
                 // Add previous turns from the 'history' array provided by the frontend
                 ...history,
                 // Add the current user prompt
                { role: "user", parts: [{ text: prompt }] }
             ];


            // Proxy to the other Gemini endpoint defined in server.js
            const geminiResponse = await fetch(`${req.protocol}://${req.get('host')}/api/gemini-proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                 // Send the combined history
                body: JSON.stringify({ prompt: prompt, chatHistory: fullHistoryForAPI.slice(0, -1) }) // Send history *before* the current prompt
            });

            const geminiResult = await geminiResponse.json();
            if (!geminiResponse.ok) throw new Error(geminiResult.error || 'Unknown Gemini proxy error');

            let responseText = geminiResult.response || "لم أستطع معالجة طلبك الآن 😥.";
            const recommendedProductIds = new Set();
            const productRegex = /\[PRODUCT:([\w-]+)\]/g;
            let match;
            while ((match = productRegex.exec(responseText)) !== null) {
                recommendedProductIds.add(match[1]);
            }

            // Remove the [PRODUCT:id] tags from the response text shown to the user
            responseText = responseText.replace(productRegex, '').trim();

            const recommendedProducts = allAds.filter(ad => recommendedProductIds.has(ad.id));

            res.status(200).json({ text: responseText, products: recommendedProducts });

        } catch (error) {
            console.error("Error in AI Assistant endpoint:", error);
            res.status(500).json({ error: `فشل في التواصل مع المساعد الذكي: ${error.message}` });
        }
    });

    return router;
};
