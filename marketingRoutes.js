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
                'SELECT uid, username, custom_id, profile_bg_url, is_verified, user_role FROM users WHERE uid = $1',
                [userId]
            );
            return userResult.rows[0] || null;
        } catch (error) {
            console.error(`Error fetching user details for ${userId}:`, error);
            return null;
        }
    }

    // Helper to find the admin user
    async function getAdminUser() {
        const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const result = await defaultPool.query("SELECT uid FROM users WHERE user_role = 'admin' LIMIT 1");
        return result.rows[0];
    }

    // Helper function to send a system message to a user's chat
    async function sendSystemMessageToUser(userId, messageText) {
        const pool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
        const BOT_UID = 'system-notifications-bot'; 
        const BOT_USERNAME = '🔔 إشعارات النظام';

        try {
            // Find or create a chat between the bot and the user
            let chatResult = await pool.query(
                `SELECT id FROM chats WHERE type = 'private' AND name = $1 AND participants @> $2::jsonb`,
                [BOT_USERNAME, JSON.stringify([userId])]
            );

            let chatId;
            if (chatResult.rows.length > 0) {
                chatId = chatResult.rows[0].id;
            } else {
                chatId = uuidv4();
                await pool.query(
                    `INSERT INTO chats (id, type, name, participants, last_message, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [chatId, 'private', BOT_USERNAME, JSON.stringify([userId, BOT_UID]), null, Date.now()]
                );
            }

            const messageId = uuidv4();
            const timestamp = Date.now();
            const { pool: userProjectPool } = await getUserProjectContext(userId);
            
            await userProjectPool.query(
                `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, media_type) VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
                [messageId, chatId, BOT_UID, BOT_USERNAME, messageText, timestamp]
            );
            
            await pool.query('UPDATE chats SET last_message = $1, timestamp = $2 WHERE id = $3', [messageText, timestamp, chatId]);
            console.log(`Sent system message to user ${userId}: "${messageText}"`);
        } catch (error) {
            console.error("Error sending system message:", error);
        }
    }

    // NEW: Helper function to notify admin about a new submission
    async function sendSubmissionNotificationToAdmin(submissionId, submitterDetails, productTitle, imageUrl) {
        const admin = await getAdminUser();
        if (!admin) {
            console.error("CRITICAL: No admin user found to send submission notification.");
            return;
        }
        
        const submissionData = {
            submissionId: submissionId,
            userId: submitterDetails.uid,
            username: submitterDetails.username,
            title: productTitle,
            imageUrl: imageUrl
        };
        
        // This special format will be parsed by the admin's frontend to show buttons
        const messageText = `[PRODUCT_SUBMISSION::${JSON.stringify(submissionData)}]`;
        await sendSystemMessageToUser(admin.uid, messageText);
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
            res.status(200).json(allAds);
        } catch (error) {
            console.error("Error fetching marketing ads:", error);
            res.status(500).json({ error: "Failed to fetch marketing ads." });
        }
    });

    // This old endpoint is no longer used for publishing. It is replaced by the /submission flow.
    router.post('/', (req, res) => {
        res.status(403).json({ error: "Direct ad publishing is disabled. Please use the submission form." });
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

    // --- NEW: Product Submission and Review Endpoints ---

    const submissionUpload = upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'digital_product_file', maxCount: 1 }
    ]);
    router.post('/submission', submissionUpload, async (req, res) => {
        const { submitter_id } = req.body;
        if (!submitter_id) return res.status(400).json({ error: "Submitter ID is required." });

        try {
            const { pool, supabase } = await getUserProjectContext(submitter_id);
            const imageFile = req.files.image ? req.files.image[0] : null;
            const digitalFile = req.files.digital_product_file ? req.files.digital_product_file[0] : null;

            if (!imageFile) return res.status(400).json({ error: "Product image is required for submission." });

            const imageBucket = 'marketing-images';
            const imgFileName = `${uuidv4()}.${imageFile.originalname.split('.').pop()}`;
            const imgFilePath = `${submitter_id}/${imgFileName}`;
            await supabase.storage.from(imageBucket).upload(imgFilePath, imageFile.buffer, { contentType: imageFile.mimetype });
            const { data: imgPublicUrlData } = supabase.storage.from(imageBucket).getPublicUrl(imgFilePath);

            let digitalFileUrl = null;
            if (req.body.ad_type === 'digital_product' && digitalFile) {
                const digitalBucket = 'digital-products';
                const digitalFileName = `${uuidv4()}-${digitalFile.originalname}`;
                const digitalFilePath = `${submitter_id}/${digitalFileName}`;
                await supabase.storage.from(digitalBucket).upload(digitalFilePath, digitalFile.buffer, { contentType: digitalFile.mimetype });
                digitalFileUrl = digitalFilePath;
            }

            const productData = {
                ...req.body,
                image_urls: [imgPublicUrlData.publicUrl],
                digital_product_url: digitalFileUrl
            };
            delete productData.submitter_id;

            const submissionId = uuidv4();
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            await defaultPool.query(
                'INSERT INTO product_submissions (id, user_id, product_data, status, created_at) VALUES ($1, $2, $3, $4, $5)',
                [submissionId, submitter_id, JSON.stringify(productData), 'pending', Date.now()]
            );

            const submitterDetails = await getUserDetailsFromDefaultProject(submitter_id);
            await sendSubmissionNotificationToAdmin(submissionId, submitterDetails, req.body.title, imgPublicUrlData.publicUrl);

            res.status(201).json({ message: "Submission received and is pending review." });

        } catch (error) {
            console.error("Error processing product submission:", error);
            res.status(500).json({ error: "Failed to process submission." });
        }
    });

    router.post('/submission/review', async (req, res) => {
        const { submissionId, action, adminId, forUserId } = req.body;
        if (!submissionId || !action || !adminId || !forUserId) {
            return res.status(400).json({ error: "Missing required fields for review." });
        }

        try {
            const adminDetails = await getUserDetailsFromDefaultProject(adminId);
            if (!adminDetails || adminDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized action." });
            }

            const { pool } = await getUserProjectContext(forUserId);
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            
            const subResult = await defaultPool.query('SELECT * FROM product_submissions WHERE id = $1', [submissionId]);
            if (subResult.rows.length === 0) return res.status(404).json({ error: "Submission not found." });
            
            const submission = subResult.rows[0];
            if (submission.status !== 'pending') return res.status(400).json({ error: "This submission has already been reviewed." });

            const productData = submission.product_data;
            const newStatus = action === 'approved' ? 'approved' : 'rejected';

            await defaultPool.query('UPDATE product_submissions SET status = $1 WHERE id = $2', [newStatus, submissionId]);
            
            let userMessage = '';

            if (newStatus === 'approved') {
                const adId = uuidv4();
                const timestamp = Date.now();
                let deal_expiry = null;
                if (productData.ad_type === 'deal') {
                    const duration = parseInt(productData.deal_duration_hours, 10) || 1;
                    deal_expiry = timestamp + (duration * 60 * 60 * 1000);
                }
                const countries = productData.shipping_countries ? productData.shipping_countries.split(',') : null;

                await pool.query(
                    `INSERT INTO marketing_ads (id, title, description, price, original_price, image_urls, ad_type, digital_product_type, digital_product_url, shipping_countries, shipping_cost, timestamp, is_deal, deal_expiry, seller_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                    [adId, productData.title, productData.description, productData.price, productData.original_price || null, JSON.stringify(productData.image_urls), productData.ad_type, productData.digital_product_type || null, productData.digital_product_url, countries, productData.shipping_cost || 0, timestamp, productData.ad_type === 'deal', deal_expiry, submission.user_id]
                );
                userMessage = `🎉 تمت الموافقة على منتجك "${productData.title}" وهو الآن معروض في قسم التسويق!`;
            } else {
                userMessage = `❌ تم رفض طلب نشر منتجك "${productData.title}". يمكنك المحاولة مرة أخرى ببيانات مختلفة.`;
            }

            await sendSystemMessageToUser(submission.user_id, userMessage);
            res.status(200).json({ message: `Review action '${newStatus}' completed.` });

        } catch (error) {
            console.error("Error reviewing submission:", error);
            res.status(500).json({ error: "Failed to review submission." });
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
        const { adId, buyerId, amount, paymentMethod, shippingAddress, discountApplied } = req.body;
        if (!adId || !buyerId || !amount || !paymentMethod) {
            return res.status(400).json({ error: "Missing required fields." });
        }
    
        try {
            let adInfo = null;
            let adPool = null;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; adPool = projectDbPools[projectId]; break; }
            }
    
            if (!adInfo) return res.status(404).json({ error: "Ad not found." });
            
            const { pool: buyerProjectPool } = await getUserProjectContext(buyerId);
            const sellerId = adInfo.seller_id;
            const isDigital = adInfo.ad_type === 'digital_product';

            // This logic prevents accidental rapid double-clicks but allows purchasing again later.
            const recentTx = await buyerProjectPool.query(
                'SELECT id FROM transactions WHERE ad_id = $1 AND buyer_id = $2 AND created_at > $3',
                [adId, buyerId, Date.now() - 60000] // Check for purchases in the last 60 seconds
            );
            if (recentTx.rows.length > 0) {
                return res.status(429).json({ error: "لقد قمت بشراء هذا المنتج للتو. يرجى الانتظار قليلاً." });
            }

            const commission = parseFloat(amount) * 0.02;
            const transactionId = uuidv4();
            const now = Date.now();
    
            await buyerProjectPool.query(
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, shipping_address, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11)`,
                [transactionId, adId, buyerId, sellerId, amount, commission, isDigital ? 'completed' : 'pending', paymentMethod, shippingAddress ? JSON.stringify(shippingAddress) : null, now, now]
            );
    
            const { pool: sellerWalletPool } = await getUserProjectContext(sellerId);
            if (isDigital) {
                const netAmount = parseFloat(amount) - commission;
                await sellerWalletPool.query(
                    `UPDATE wallets SET available_balance = wallets.available_balance + $1 WHERE user_id = $2`, [netAmount, sellerId]
                );
            } else {
                await sellerWalletPool.query(
                    `UPDATE wallets SET pending_balance = wallets.pending_balance + $1 WHERE user_id = $2`, [amount, sellerId]
                );
            }
            
            if (discountApplied) {
                await buyerProjectPool.query('UPDATE wallets SET has_active_discount = FALSE WHERE user_id = $1', [buyerId]);
            }
            
            const buyerDetails = await getUserDetailsFromDefaultProject(buyerId);
            const sellerNotification = `🎉 طلب بيع جديد!\nالمنتج: ${adInfo.title}\nالمشتري: ${buyerDetails.username}\n\nيرجى مراجعة "طلبات البيع" في لوحة التحكم المالية.`;
            await sendSystemMessageToUser(sellerId, sellerNotification);
            
            res.status(201).json({ 
                message: isDigital ? "تم الشراء بنجاح! يمكنك الآن تحميل المنتج." : "تم الدفع بنجاح! المبلغ محجوز.",
                transactionId: transactionId 
            });
    
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

    router.get('/download/:transactionId', async (req, res) => {
        const { transactionId } = req.params;
        const { callerUid } = req.query; 

        if (!callerUid) {
            return res.status(401).json({ error: "Unauthorized: Missing caller ID." });
        }

        try {
            let transaction = null;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; break; }
            }

            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== callerUid) return res.status(403).json({ error: "Unauthorized: You are not the buyer." });
            if (transaction.status !== 'completed') return res.status(400).json({ error: "Purchase not completed." });

            let adInfo = null;
            let adProjectId = null;
            for (const projectId in projectDbPools) {
                const result = await projectDbPools[projectId].query('SELECT digital_product_url FROM marketing_ads WHERE id = $1', [transaction.ad_id]);
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
                .createSignedUrl(filePath, 60 * 5); // URL is valid for 5 minutes

            if (error) throw error;

            res.status(200).json({ downloadUrl: data.signedUrl });

        } catch (error) {
            console.error("Error generating download link:", error);
            res.status(500).json({ error: "Failed to generate download link." });
        }
    });

    // --- Points & Games Endpoints ---
    
    router.get('/points/:userId', async (req, res) => {
        const { userId } = req.params;
        const { pool } = await getUserProjectContext(userId);
        try {
            const pointsResult = await pool.query('SELECT points FROM user_points WHERE user_id = $1', [userId]);
            const walletResult = await pool.query('SELECT has_active_discount FROM wallets WHERE user_id = $1', [userId]);
            
            res.status(200).json({ 
                points: pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0,
                has_active_discount: walletResult.rows.length > 0 ? walletResult.rows[0].has_active_discount : false
            });
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

    // NEW: Redeem discount endpoint
    router.post('/redeem-discount', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });

        const { pool } = await getUserProjectContext(userId);
        const transactionClient = await pool.connect();
        try {
            await transactionClient.query('BEGIN');

            const pointsResult = await transactionClient.query('SELECT points FROM user_points WHERE user_id = $1 FOR UPDATE', [userId]);
            const currentPoints = pointsResult.rows.length > 0 ? pointsResult.rows[0].points : 0;
            
            if (currentPoints < 100) {
                await transactionClient.query('ROLLBACK');
                return res.status(400).json({ error: "Not enough points." });
            }

            await transactionClient.query('UPDATE user_points SET points = points - 100 WHERE user_id = $1', [userId]);
            await transactionClient.query('UPDATE wallets SET has_active_discount = TRUE WHERE user_id = $1', [userId]);
            
            await transactionClient.query('COMMIT');
            res.status(200).json({ message: "تم استبدال النقاط بنجاح! لديك الآن خصم 10% فعال." });

        } catch (error) {
            await transactionClient.query('ROLLBACK');
            console.error("Error redeeming discount:", error);
            res.status(500).json({ error: "Failed to redeem discount." });
        } finally {
            transactionClient.release();
        }
    });

    return router;
};
