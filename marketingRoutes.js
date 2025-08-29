// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID) {

    // Helper to get user context
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

    // Helper to get user details
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

    // Helper function to send a system message to a seller's chat
    async function sendOrderNotificationToSeller(sellerId, buyerUsername, adTitle) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot'; // A unique ID for our bot
        const BOT_USERNAME = '🔔 إشعارات النظام';

        try {
            // Find or create a chat between the bot and the seller
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

            // Send the message to the user's project database
            const messageText = `🎉 طلب بيع جديد!\nالمنتج: ${adTitle}\nالمشتري: ${buyerUsername}\n\nيرجى مراجعة "طلبات البيع" في لوحة التحكم المالية الخاصة بك.`;
            const messageId = uuidv4();
            const timestamp = Date.now();
            
            const { pool: sellerProjectPool } = await getUserProjectContext(sellerId);
            await sellerProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) 
                 VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            // Update the last message in the main chat table
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, timestamp, chatId]);

            console.log(`Sent order notification to seller ${sellerId} for ad "${adTitle}"`);

        } catch (error) {
            console.error("Error sending system notification to seller:", error);
        }
    }

    // --- NEW: Helper function to notify admin about new seller submission ---
    async function sendSubmissionNotificationToAdmin(applicantUsername, submissionId) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const adminResult = await pool.query("SELECT uid FROM users WHERE user_role = 'admin' LIMIT 1");
        if (adminResult.rows.length === 0) {
            console.error("ADMIN NOTIFICATION FAILED: Admin user not found.");
            return;
        }
        const adminId = adminResult.rows[0].uid;
        const BOT_UID = 'system-notifications-bot';
        const BOT_USERNAME = '🔔 إشعارات النظام';
        
        try {
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

            const messageText = `📥 طلب بائع جديد!\n\nتقدم المستخدم "${applicantUsername}" بطلب ليصبح بائعًا.\n\nالرجاء مراجعة "طلبات البائعين" في لوحة التحكم الخاصة بك للموافقة أو الرفض.`;
            const messageId = uuidv4();
            const timestamp = Date.now();
            
            const { pool: adminProjectPool } = await getUserProjectContext(adminId);
            await adminProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, timestamp, chatId]);
            console.log(`Sent seller submission notification to admin for applicant "${applicantUsername}"`);

        } catch (error) {
            console.error("Error sending system notification to admin:", error);
        }
    }


    // Periodic cleanup job
    setInterval(async () => {
        console.log("Running cleanup job for expired deals and pins...");
        const now = Date.now();
        for (const projectId in projectDbPools) {
            const pool = projectDbPools[projectId];
            try {
                const deletedDeals = await pool.query('DELETE FROM marketing_ads WHERE ad_type = $1 AND deal_expiry < $2 RETURNING id', ['deal', now]);
                if (deletedDeals.rows.length > 0) {
                    console.log(`[Project ${projectId}] Deleted ${deletedDeals.rows.length} expired deals.`);
                }
                const unpinnedAds = await pool.query('UPDATE marketing_ads SET is_pinned = FALSE, pin_expiry = NULL WHERE is_pinned = TRUE AND pin_expiry < $1 RETURNING id', [now]);
                if (unpinnedAds.rows.length > 0) {
                    console.log(`[Project ${projectId}] Unpinned ${unpinnedAds.rows.length} expired ads.`);
                }
            } catch (error) {
                console.error(`[Project ${projectId}] Error during cleanup job:`, error);
            }
        }
    }, 5 * 60 * 1000);

    // GET /api/marketing - Fetch all ads
    router.get('/', async (req, res) => {
        let allAds = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads');
                
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
            // Sorting is now handled on the client-side for shuffling
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // POST /api/marketing - Create new ad - *** UPDATED FOR SELLER APPROVAL & NEW FIELDS ***
    const adUploads = upload.fields([
        { name: 'images', maxCount: 3 },
        { name: 'digital_product_file', maxCount: 1 }
    ]);
    router.post('/', adUploads, async (req, res) => {
        const { title, description, price, ad_type, seller_id, deal_duration_hours, original_price, digital_product_type, shipping_countries, shipping_cost } = req.body;
        const imageFiles = req.files.images;
        const digitalFile = req.files.digital_product_file ? req.files.digital_product_file[0] : null;

        if (!title || !description || !ad_type || !seller_id || !price) {
            return res.status(400).json({ error: "All fields are required." });
        }
        try {
            // --- NEW: Seller Approval Check ---
            const sellerDetails = await getUserDetailsFromDefaultProject(seller_id);
            if (!sellerDetails || !sellerDetails.is_approved_seller) {
                return res.status(403).json({ error: "ليس لديك صلاحية لنشر المنتجات. يرجى تقديم طلب لتصبح بائعًا أولاً." });
            }

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

            const countries = shipping_countries ? shipping_countries.split(',').map(c => c.trim()).filter(c => c) : null;

            await pool.query(
                `INSERT INTO marketing_ads (id, title, description, price, original_price, image_urls, ad_type, digital_product_type, digital_product_url, shipping_countries, shipping_cost, timestamp, is_deal, deal_expiry, seller_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                [adId, title, description, price, original_price || null, JSON.stringify(imageUrls), ad_type, digital_product_type || null, digitalFileUrl, countries, shipping_cost || 0, timestamp, is_deal, deal_expiry, seller_id]
            );
            res.status(201).json({ message: "Ad published successfully." });
        } catch (error) {
            console.error("Error publishing ad:", error);
            res.status(500).json({ error: "Failed to publish ad." });
        }
    });

    // DELETE /api/marketing/:adId - Delete an ad
    router.delete('/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid } = req.body;
        if (!callerUid) { return res.status(401).json({ error: "Unauthorized" }); }
        try {
            const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
            const isAdmin = callerDetails && callerDetails.user_role === 'admin';
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    const ad = adResult.rows[0];
                    if (ad.seller_id !== callerUid && !isAdmin) {
                        return res.status(403).json({ error: "Unauthorized to delete." });
                    }
                    if (ad.image_urls && ad.image_urls.length > 0) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'marketing-images';
                        const filePathsInBucket = ad.image_urls.map(url => {
                             const urlObj = new URL(url);
                             return urlObj.pathname.split(`/${bucketName}/`)[1];
                        });
                        await supabase.storage.from(bucketName).remove(filePathsInBucket);
                    }
                    if (ad.digital_product_url) {
                        const supabase = projectSupabaseClients[projectId];
                        const bucketName = 'digital-products';
                        await supabase.storage.from(bucketName).remove([ad.digital_product_url]);
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

    // POST /api/marketing/pin/:adId - Pin an ad
    router.post('/pin/:adId', async (req, res) => {
        const { adId } = req.params;
        const { callerUid, pin_duration_hours } = req.body;
        const duration = parseInt(pin_duration_hours) || 1;
        const cost = duration * 10;
        console.log(`Pinning ad ${adId} for ${duration} hours at a cost of $${cost}. (Payment simulation)`);

        try {
             for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const adResult = await pool.query('SELECT seller_id FROM marketing_ads WHERE id = $1', [adId]);
                if (adResult.rows.length > 0) {
                    if (adResult.rows[0].seller_id !== callerUid) {
                        return res.status(403).json({ error: "Unauthorized." });
                    }
                    const expiry = Date.now() + (duration * 60 * 60 * 1000);
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

    // --- Financial & Orders Endpoints ---

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
        const { adId, buyerId, amount, paymentMethod, shipping_address, usePointsDiscount } = req.body; // --- NEW: Added shipping_address and usePointsDiscount
        if (!adId || !buyerId || !amount || !paymentMethod) {
            return res.status(400).json({ error: "Missing required fields." });
        }
    
        try {
            let adInfo = null;
            let adPool = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) {
                    adInfo = result.rows[0];
                    adPool = pool;
                    break;
                }
            }
    
            if (!adInfo) return res.status(404).json({ error: "Ad not found." });

            // --- NEW: Shipping Country Check ---
            const isPhysicalProduct = adInfo.ad_type === 'product' || adInfo.ad_type === 'deal';
            if (isPhysicalProduct) {
                if (!shipping_address || !shipping_address.country) {
                     return res.status(400).json({ error: "عنوان الشحن مطلوب للمنتجات المادية." });
                }
                if (adInfo.shipping_countries && adInfo.shipping_countries.length > 0) {
                    const sellerShipsToCountry = adInfo.shipping_countries.some(country => country.toLowerCase() === shipping_address.country.toLowerCase());
                    if (!sellerShipsToCountry) {
                        return res.status(400).json({ error: "عذراً، البائع لا يشحن إلى بلدك." });
                    }
                }
            }
            
            let finalAmount = parseFloat(amount);
            const { pool: buyerProjectPool } = await getUserProjectContext(buyerId);

            // --- NEW: Points Discount Logic ---
            if (usePointsDiscount) {
                const pointsResult = await buyerProjectPool.query('SELECT points FROM user_points WHERE user_id = $1', [buyerId]);
                const userPoints = pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0;
                if (userPoints >= 100) {
                    finalAmount = finalAmount * 0.90; // Apply 10% discount
                    // Deduct points
                    await buyerProjectPool.query('UPDATE user_points SET points = points - 100 WHERE user_id = $1', [buyerId]);
                } else {
                    return res.status(400).json({ error: "ليس لديك نقاط كافية لتطبيق الخصم." });
                }
            }

            const sellerId = adInfo.seller_id;
            const isDigital = adInfo.ad_type === 'digital_product';
            const commission = finalAmount * 0.02;
            const transactionId = uuidv4();
            const now = Date.now();
            
            // --- UPDATED: Prevent duplicate transactions ---
            const existingTransaction = await buyerProjectPool.query(
                'SELECT id FROM transactions WHERE ad_id = $1 AND buyer_id = $2 AND status != $3',
                [adId, buyerId, 'cancelled']
            );
            if (existingTransaction.rows.length > 0) {
                 return res.status(409).json({ error: "لقد قمت بشراء هذا المنتج بالفعل أو لديك طلب معلق له." });
            }
    
            await buyerProjectPool.query(
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, shipping_address, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11)`,
                [transactionId, adId, buyerId, sellerId, finalAmount, commission, isDigital ? 'completed' : 'pending', paymentMethod, JSON.stringify(shipping_address || {}), now, now]
            );
    
            const { pool: sellerWalletPool } = await getUserProjectContext(sellerId);
            if (isDigital) {
                const netAmount = finalAmount - commission;
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`,
                    [sellerId, netAmount]
                );
            } else {
                const sellerReceives = finalAmount; // Full amount including shipping is held
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, pending_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET pending_balance = wallets.pending_balance + $2`,
                    [sellerId, sellerReceives]
                );
            }
            
            const buyerDetails = await getUserDetailsFromDefaultProject(buyerId);
            await sendOrderNotificationToSeller(sellerId, buyerDetails.username, adInfo.title);
            
            res.status(201).json({ 
                message: isDigital ? "تم الشراء بنجاح! يمكنك الآن تحميل المنتج." : "تم الدفع بنجاح! المبلغ محجوز لدى المنصة حتى تأكيد الاستلام.",
                transactionId: transactionId 
            });
    
        } catch (error) {
            console.error("Error during purchase:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });
    
    // GET /seller/orders/:userId - New endpoint to get seller's orders
    router.get('/seller/orders/:userId', async (req, res) => {
        const { userId } = req.params;
        let allOrders = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                // --- NEW: Join to get shipping address ---
                const result = await pool.query(
                    `SELECT t.*, a.title as ad_title 
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

    // GET /buyer/orders/:userId - New endpoint to get buyer's orders
    router.get('/buyer/orders/:userId', async (req, res) => {
        const { userId } = req.params;
        let allOrders = [];
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query(
                    `SELECT t.*, a.title as ad_title, a.ad_type, a.digital_product_url
                     FROM transactions t 
                     JOIN marketing_ads a ON t.ad_id = a.id 
                     WHERE t.buyer_id = $1 ORDER BY t.created_at DESC`, [userId]
                );

                const enrichedOrders = await Promise.all(result.rows.map(async (order) => {
                    const sellerDetails = await getUserDetailsFromDefaultProject(order.seller_id);
                    return { ...order, seller_username: sellerDetails ? sellerDetails.username : 'N/A' };
                }));

                allOrders = allOrders.concat(enrichedOrders);
            }
            allOrders.sort((a,b) => b.created_at - a.created_at);
            res.status(200).json(allOrders);
        } catch (error) {
            console.error("Error fetching buyer orders:", error);
            res.status(500).json({ error: "Failed to fetch buyer orders." });
        }
    });
    
    // GET /seller/notifications/count/:userId - New endpoint for notification badge
    router.get('/seller/notifications/count/:userId', async (req, res) => {
        const { userId } = req.params;
        let totalCount = 0;
        try {
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query(
                    "SELECT COUNT(*) FROM transactions WHERE seller_id = $1 AND status = 'pending'", [userId]
                );
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
            let transaction = null;
            let transactionPool = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) {
                    transaction = result.rows[0];
                    transactionPool = pool;
                    break;
                }
            }

            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== buyerId) return res.status(403).json({ error: "Unauthorized." });
            if (transaction.status !== 'pending') return res.status(400).json({ error: "Order already confirmed or cancelled." });

            await transactionPool.query('UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3', ['completed', Date.now(), transactionId]);

            const sellerId = transaction.seller_id;
            const { pool: sellerWalletPool } = await getUserProjectContext(sellerId);
            const amount = parseFloat(transaction.amount);
            const commission = parseFloat(transaction.commission);
            const netAmount = amount - commission;

            await sellerWalletPool.query(
                `UPDATE wallets SET 
                 pending_balance = wallets.pending_balance - $1,
                 available_balance = wallets.available_balance + $2
                 WHERE user_id = $3`,
                [amount, netAmount, sellerId]
            );

            res.status(200).json({ message: "تم تأكيد الاستلام بنجاح! تم تحويل المبلغ للبائع." });

        } catch (error) {
            console.error("Error confirming order:", error);
            res.status(500).json({ error: "Failed to confirm order." });
        }
    });

    // --- NEW: Endpoint to get a download link for a digital product ---
    router.get('/download/:transactionId', async (req, res) => {
        const { transactionId } = req.params;
        const { callerUid } = req.query; 

        if (!callerUid) {
            return res.status(401).json({ error: "Unauthorized: Missing caller ID." });
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

            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== callerUid) return res.status(403).json({ error: "Unauthorized: You are not the buyer." });
            if (transaction.status !== 'completed') return res.status(400).json({ error: "Purchase not completed." });

            let adInfo = null;
            let adProjectId = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT digital_product_url FROM marketing_ads WHERE id = $1', [transaction.ad_id]);
                if (result.rows.length > 0) {
                    adInfo = result.rows[0];
                    adProjectId = projectId;
                    break;
                }
            }
            
            if (!adInfo || !adInfo.digital_product_url) {
                return res.status(404).json({ error: "Digital product file not found for this ad." });
            }

            const supabase = projectSupabaseClients[adProjectId];
            const bucketName = 'digital-products';
            const filePath = adInfo.digital_product_url;
            const { data, error } = await supabase.storage
                .from(bucketName)
                .createSignedUrl(filePath, 60 * 5); 

            if (error) throw error;

            res.status(200).json({ downloadUrl: data.signedUrl });

        } catch (error) {
            console.error("Error generating download link:", error);
            res.status(500).json({ error: "Failed to generate download link." });
        }
    });

    // --- NEW: Seller Submission & Approval Endpoints ---
    const submissionUploads = upload.fields([{ name: 'submission_files', maxCount: 5 }]);
    router.post('/seller-submission', submissionUploads, async (req, res) => {
        const { userId, details } = req.body;
        const files = req.files.submission_files;

        if (!userId || !details) {
            return res.status(400).json({ error: "User ID and details are required." });
        }
        try {
            const { supabase, projectId } = await getUserProjectContext(userId);
            let fileUrls = [];

            if (files && files.length > 0) {
                const bucket = 'seller-submissions';
                for (const file of files) {
                    const fileName = `${uuidv4()}-${file.originalname}`;
                    const filePath = `${userId}/${fileName}`;
                    const { error } = await supabase.storage.from(bucket).upload(filePath, file.buffer, { contentType: file.mimetype });
                    if (error) throw error;
                    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
                    fileUrls.push(data.publicUrl);
                }
            }
            
            const submissionData = { details, files: fileUrls };
            const submissionId = uuidv4();
            const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            
            await pool.query(
                `INSERT INTO product_submissions (id, user_id, submission_data, status, created_at) VALUES ($1, $2, $3, 'pending', $4)`,
                [submissionId, userId, JSON.stringify(submissionData), Date.now()]
            );

            const userDetails = await getUserDetailsFromDefaultProject(userId);
            await sendSubmissionNotificationToAdmin(userDetails.username, submissionId);

            res.status(201).json({ message: "تم إرسال طلبك بنجاح. ستتم مراجعته من قبل الإدارة." });
        } catch (error) {
            console.error("Error creating seller submission:", error);
            res.status(500).json({ error: "Failed to create seller submission." });
        }
    });

    router.get('/admin/submissions', async (req, res) => {
        const { callerUid } = req.query;
        if (!callerUid) return res.status(401).json({ error: "Unauthorized" });

        const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
        if (!callerDetails || callerDetails.user_role !== 'admin') {
            return res.status(403).json({ error: "Forbidden" });
        }
        try {
            const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const result = await pool.query(
                `SELECT s.*, u.username FROM product_submissions s JOIN users u ON s.user_id = u.uid ORDER BY s.created_at DESC`
            );
            res.status(200).json(result.rows);
        } catch (error) {
             console.error("Error fetching submissions:", error);
             res.status(500).json({ error: "Failed to fetch submissions." });
        }
    });

    router.post('/admin/submissions/:submissionId/review', async (req, res) => {
        const { submissionId } = req.params;
        const { callerUid, status } = req.body; // status should be 'approved' or 'rejected'

        if (!callerUid || !status) return res.status(400).json({ error: "Missing required fields" });
        if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: "Invalid status" });

        const callerDetails = await getUserDetailsFromDefaultProject(callerUid);
        if (!callerDetails || callerDetails.user_role !== 'admin') {
            return res.status(403).json({ error: "Forbidden" });
        }

        try {
            const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const submissionResult = await pool.query('SELECT user_id FROM product_submissions WHERE id = $1', [submissionId]);
            if (submissionResult.rows.length === 0) {
                return res.status(404).json({ error: "Submission not found" });
            }
            const { user_id } = submissionResult.rows[0];

            await pool.query('UPDATE product_submissions SET status = $1 WHERE id = $2', [status, submissionId]);

            if (status === 'approved') {
                await pool.query('UPDATE users SET is_approved_seller = TRUE WHERE uid = $1', [user_id]);
            }
            // You can add a notification back to the user here
            res.status(200).json({ message: `Submission has been ${status}.` });

        } catch (error) {
            console.error("Error reviewing submission:", error);
            res.status(500).json({ error: "Failed to review submission." });
        }
    });


    // --- Points & Games Endpoints ---
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
