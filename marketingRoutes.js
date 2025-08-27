// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // Helper to get user context (No changes here)
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

    // Helper to get user details (Added 'can_sell' field)
    async function getUserDetailsFromDefaultProject(userId) {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        if (!defaultPool || !userId) return null;
        try {
            const userResult = await defaultPool.query(
                'SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role, can_sell FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details for ${userId}:`, error);
            return null;
        }
    }

    // Helper function to send a system message (Updated for shipping address)
    async function sendOrderNotificationToSeller(sellerId, buyerUsername, adTitle, shippingAddress) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '🔔 إشعارات النظام';

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
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp) 
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([sellerId, BOT_UID]), null, Date.now()]
                );
            }

            // تعديل: إضافة عنوان الشحن للرسالة إذا كان موجوداً
            let shippingText = '';
            if (shippingAddress) {
                shippingText = `\n\n🚚 **عنوان الشحن:**\nالدولة: ${shippingAddress.country}\nالمدينة: ${shippingAddress.city}\nالحي: ${shippingAddress.street}\nالشقة/المنزل: ${shippingAddress.apt || 'غير محدد'}`;
            }

            const messageText = `🎉 طلب بيع جديد!\nالمنتج: ${adTitle}\nالمشتري: ${buyerUsername}${shippingText}\n\nيرجى مراجعة "طلبات البيع" في لوحة التحكم.`;
            const messageId = uuidv4();
            const timestamp = Date.now();
            
            const { pool: sellerProjectPool } = await getUserProjectContext(sellerId);
            await sellerProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) 
                 VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, timestamp, chatId]);
            console.log(`Sent order notification to seller ${sellerId} for ad "${adTitle}"`);

        } catch (error) {
            console.error("Error sending system notification to seller:", error);
        }
    }
    
    // --- NEW: Helper to send notifications to Admin ---
    async function sendAdminNotification(title, message) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin_watsaligram";

        try {
            // 1. Find Admin UID
            const adminResult = await pool.query('SELECT uid FROM users WHERE username = $1', [ADMIN_USERNAME]);
            if (adminResult.rows.length === 0) {
                console.error("Admin user not found, cannot send notification.");
                return;
            }
            const adminId = adminResult.rows[0].uid;

            // 2. Use the same logic as seller notifications
            const BOT_UID = 'system-admin-bot';
            const BOT_USERNAME = '🚨 تنبيهات الإدارة';

            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([adminId])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([adminId, BOT_UID]), null, Date.now()]
                );
            }

            const messageText = `${title}\n\n${message}\n\nيرجى اتخاذ الإجراء اللازم.`;
            const messageId = uuidv4();
            const timestamp = Date.now();

            const { pool: adminProjectPool } = await getUserProjectContext(adminId);
            await adminProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, timestamp, chatId]);
            console.log(`Sent notification to admin: "${title}"`);

        } catch (error) {
            console.error("Error sending system notification to admin:", error);
        }
    }


    // Periodic cleanup job (No changes here)
    setInterval(async () => {
        console.log("Running cleanup job for expired deals and pins...");
        const now = Date.now();
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                // ... (no changes in this block)
            } catch (error) {
                console.error(`[Project ${projectId}] Error during cleanup job:`, error);
            }
        }
    }, 5 * 60 * 1000);

    // GET /api/marketing - Fetch all ads (Added shipping_info)
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                // Added shipping_info to the select statement
                const result = await pool.query('SELECT id, title, description, price, original_price, image_urls, ad_type, digital_product_type, timestamp, is_deal, deal_expiry, seller_id, is_pinned, pin_expiry, shipping_info FROM marketing_ads');
                
                const enrichedAds = await Promise.all(result.rows.map(async (ad) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(ad.seller_id);
                    return {
                        ...ad,
                        seller_username: sellerDetails ? sellerDetails.username : 'غير معروف',
                        seller_is_verified: sellerDetails ? sellerDetails.is_verified : false,
                        seller_user_role: sellerDetails ? sellerDetails.user_role : 'normal'
                    };
                }));
                allAds = allAds.concat(enrichedAds);
            }
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - Create new ad (Updated for shipping_info)
    const adUploads = upload.fields([
        { name: 'images', maxCount: 3 },
        { name: 'digital_product_file', maxCount: 1 }
    ]);
    router.post('/', adUploads, async (req, res) => {
        const { title, description, price, ad_type, seller_id, deal_duration_hours, original_price, digital_product_type, shipping_info } = req.body;
        const imageFiles = req.files.images;
        const digitalFile = req.files.digital_product_file ? req.files.digital_product_file[0] : null;

        if (!title || !description || !ad_type || !seller_id || !price) {
            return res.status(400).json({ error: "All fields are required." });
        }
        
        // --- NEW: Check if user is allowed to sell ---
        const sellerDetails = await getUserDetailsFromDefaultProject(seller_id);
        if (!sellerDetails || !sellerDetails.can_sell) {
             return res.status(403).json({ error: "ليس لديك صلاحية لنشر المنتجات. يرجى تقديم طلب أولاً." });
        }

        try {
            const { pool, supabase } = await getUserProjectContext(seller_id);
            let imageUrls = [];

            if (imageFiles && imageFiles.length > 0) {
                const imageBucket = 'marketing-images';
                for (const file of imageFiles) {
                    const fileName = `${uuidv4()}.${file.originalname.split('.').pop()}`;
                    const filePath = `${seller_id}/${fileName}`;
                    const { error: uploadError } = await supabase.storage.from(imageBucket).upload(filePath, file.buffer, { contentType: file.mimetype });
                    if (uploadError) throw uploadError;
                    const { data: publicUrlData } = supabase.storage.from(imageBucket).getPublicUrl(filePath);
                    imageUrls.push(publicUrlData.publicUrl);
                }
            }
            
            let digitalFileUrl = null;
            if (ad_type === 'digital_product' && digitalFile) {
                const digitalBucket = 'digital-products';
                const fileName = `${uuidv4()}-${digitalFile.originalname}`;
                const filePath = `${seller_id}/${fileName}`;
                const { error: uploadError } = await supabase.storage.from(digitalBucket).upload(filePath, digitalFile.buffer, { contentType: digitalFile.mimetype });
                if (uploadError) throw uploadError;
                digitalFileUrl = filePath;
            }

            const adId = uuidv4();
            const timestamp = Date.now();
            const is_deal = ad_type === 'deal';
            
            let deal_expiry = null;
            if (is_deal) {
                const duration = parseInt(deal_duration_hours, 10) || 1;
                deal_expiry = timestamp + (duration * 60 * 60 * 1000);
            }
            
            // --- NEW: Parse shipping_info JSON string ---
            const shippingData = shipping_info ? JSON.parse(shipping_info) : null;

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, original_price, image_urls, ad_type, digital_product_type, digital_product_url, shipping_info, timestamp, is_deal, deal_expiry, seller_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [adId, title, description, price, original_price || null, JSON.stringify(imageUrls), ad_type, digital_product_type || null, digitalFileUrl, shippingData, timestamp, is_deal, deal_expiry, seller_id]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // DELETE /api/marketing/:adId - (No changes here)
    router.delete('/:adId', async (req, res) => {
        // ... (no changes in this block)
    });

    // POST /api/marketing/pin/:adId - (No changes here)
    router.post('/pin/:adId', async (req, res) => {
        // ... (no changes in this block)
    });

    // --- Financial & Orders Endpoints ---

    router.get('/seller/wallet/:userId', async (req, res) => {
        // ... (no changes in this block)
    });
    
    // --- NEW: Endpoint to handle seller requests ---
    router.post('/seller-request', async (req, res) => {
        const { userId, requestText } = req.body;
        if (!userId || !requestText) {
            return res.status(400).json({ error: "Missing user ID or request text." });
        }
        
        try {
            const userDetails = await getUserDetailsFromDefaultProject(userId);
            if (!userDetails) {
                return res.status(404).json({ error: "User not found." });
            }
            
            const title = "📬 طلب صلاحية بيع جديد";
            const message = `من المستخدم: ${userDetails.username} (ID: ${userDetails.custom_id})\n\nنص الطلب:\n"${requestText}"`;

            // This helper function will find the admin and send them a private message
            await sendAdminNotification(title, message);
            
            res.status(200).json({ message: "تم إرسال طلبك إلى الإدارة بنجاح. سيتم مراجعته قريباً." });
        } catch (error) {
             console.error("Error processing seller request:", error);
             res.status(500).json({ error: "Failed to process seller request." });
        }
    });


    // POST /purchase - (HEAVILY MODIFIED for points and shipping)
    router.post('/purchase', async (req, res) => {
        const { adId, buyerId, amount, paymentMethod, pointsToUse = 0, shippingAddress = null } = req.body;
        if (!adId || !buyerId || !paymentMethod) {
            return res.status(400).json({ error: "Missing required fields." });
        }
    
        const { pool: buyerProjectPool, supabase: buyerSupabase } = await getUserProjectContext(buyerId);

        try {
            let adInfo = null;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; break; }
            }
    
            if (!adInfo) return res.status(404).json({ error: "Ad not found." });
            
            const sellerId = adInfo.seller_id;
            const isDigital = adInfo.ad_type === 'digital_product';
            const commission = parseFloat(amount) * 0.02;
            const transactionId = uuidv4();
            const now = Date.now();
            
            // --- NEW: Points Discount Validation ---
            let finalAmount = parseFloat(amount);
            const pointsToUseNum = parseInt(pointsToUse, 10);
            if (pointsToUseNum > 0) {
                 const pointsResult = await buyerProjectPool.query('SELECT points FROM user_points WHERE user_id = $1', [buyerId]);
                 const userPoints = pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0;
                 if (userPoints < pointsToUseNum) {
                     return res.status(400).json({ error: "نقاط غير كافية لتطبيق الخصم." });
                 }
                 if (pointsToUseNum % 100 !== 0) {
                     return res.status(400).json({ error: "يجب أن تكون النقاط المستخدمة من مضاعفات 100." });
                 }
                 const discountPercentage = (pointsToUseNum / 100) * 10;
                 const discountValue = parseFloat(adInfo.price) * (discountPercentage / 100);
                 finalAmount = Math.max(0, parseFloat(adInfo.price) - discountValue);

                 // Check for price mismatch just in case
                 if (Math.abs(finalAmount - parseFloat(amount)) > 0.01) {
                     return res.status(400).json({ error: "Price mismatch after discount calculation." });
                 }
            }

            const existingTransaction = await buyerProjectPool.query(
                'SELECT id FROM transactions WHERE ad_id = $1 AND buyer_id = $2 AND status IN ($3, $4)',
                [adId, buyerId, 'pending', 'completed']
            );
            if (existingTransaction.rows.length > 0) {
                return res.status(409).json({ error: "لقد قمت بشراء هذا المنتج بالفعل." });
            }
    
            // --- MODIFIED: Add points_used and shipping_address to insert ---
            await buyerProjectPool.query(
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, created_at, updated_at, points_used, shipping_address)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11, $12)`,
                [transactionId, adId, buyerId, sellerId, finalAmount, commission, isDigital ? 'completed' : 'pending', paymentMethod, now, now, pointsToUseNum, shippingAddress]
            );
            
            // --- NEW: Deduct used points ---
            if (pointsToUseNum > 0) {
                await buyerProjectPool.query(
                    'UPDATE user_points SET points = points - $1 WHERE user_id = $2',
                    [pointsToUseNum, buyerId]
                );
            }
    
            const { pool: sellerWalletPool } = await getUserProjectContext(sellerId);
            if (isDigital) {
                const netAmount = finalAmount - commission;
                await sellerWalletPool.query(
                    `UPDATE wallets SET available_balance = wallets.available_balance + $1 WHERE user_id = $2`,
                    [netAmount, sellerId]
                );
            } else {
                await sellerWalletPool.query(
                    `UPDATE wallets SET pending_balance = wallets.pending_balance + $1 WHERE user_id = $2`,
                    [finalAmount, sellerId]
                );
            }
            
            const buyerDetails = await getUserDetailsFromDefaultProject(buyerId);
            // --- MODIFIED: Pass shipping address to notification helper ---
            await sendOrderNotificationToSeller(sellerId, buyerDetails.username, adInfo.title, shippingAddress);
            
            res.status(201).json({ 
                message: isDigital ? "تم الشراء بنجاح! يمكنك الآن تحميل المنتج." : "تم الدفع بنجاح! المبلغ محجوز لدى المنصة حتى تأكيد الاستلام.",
                transactionId: transactionId 
            });
    
        } catch (error) {
            console.error("Error during purchase:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });
    
    // GET /seller/orders/:userId - (Added points_used and shipping_address)
    router.get('/seller/orders/:userId', async (req, res) => {
        const { userId } = req.params;
        let allOrders = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query(
                    `SELECT t.id, t.ad_id, t.buyer_id, t.seller_id, t.amount, t.status, t.created_at, t.points_used, t.shipping_address, a.title as ad_title 
                     FROM transactions t 
                     JOIN marketing_ads a ON t.ad_id = a.id 
                     WHERE t.seller_id = $1 ORDER BY t.created_at DESC`, [userId]
                );
                
                const enrichedOrders = await Promise.all(result.rows.map(async (order) => {
                    const buyerDetails = await getUserDetailsFromDefaultProject(order.buyer_id);
                    return { ...order, buyer_username: buyerDetails ? buyerDetails.username : 'N/A' };
                }));
                allOrders = allOrders.concat(enrichedOrders);
            }
            allOrders.sort((a,b) => b.created_at - a.created_at);
            res.status(200).json(allOrders);
        } catch (error) {
            console.error("Error fetching seller orders:", error);
            res.status(500).json({ error: "Failed to fetch seller orders." });
        }
    });

    // GET /buyer/orders/:userId - (No major changes, but it will return new fields if they exist)
    router.get('/buyer/orders/:userId', async (req, res) => {
        // ... (no changes in this block, but the query will now return new columns from transactions table)
    });
    
    // GET /seller/notifications/count/:userId - (No changes here)
    router.get('/seller/notifications/count/:userId', async (req, res) => {
        // ... (no changes in this block)
    });

    // POST /order/:transactionId/confirm - (No changes here)
    router.post('/order/:transactionId/confirm', async (req, res) => {
        // ... (no changes in this block)
    });

    // GET /download/:transactionId - (No changes here)
    router.get('/download/:transactionId', async (req, res) => {
        // ... (no changes in this block)
    });

    // --- Points & Games Endpoints --- (No changes here)
    router.get('/points/:userId', async (req, res) => {
        // ...
    });

    router.post('/points', async (req, res) => {
        // ...
    });

    return router;
};
