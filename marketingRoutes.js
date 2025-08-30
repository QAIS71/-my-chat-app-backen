// marketingRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// تم تعديل السطر التالي ليقبل sendOneSignalNotification
module.exports = function(projectDbPools, projectSupabaseClients, upload, BACKEND_DEFAULT_PROJECT_ID, sendOneSignalNotification) {

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
            // جلب الحالة الجديدة للبائع المعتمد
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

    // Periodic cleanup job (No changes here)
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

    // GET /api/marketing - Fetch all ads (Enriched with seller approval status)
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
                        seller_user_role: sellerDetails ? sellerDetails.user_role : 'normal',
                        seller_is_approved: sellerDetails ? sellerDetails.is_approved_seller : false // إضافة حالة البائع
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

    // POST /api/marketing - Create new ad - *** UPDATED TO CHECK FOR SELLER APPROVAL ***
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
            // *** NEW: Check if the seller is approved ***
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
            
            // تحويل دول الشحن من نص إلى مصفوفة
            const countries = (shipping_countries && shipping_countries.trim() !== '') ? shipping_countries.split(',').map(c => c.trim()) : null;

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

    // POST /purchase - *** UPDATED FOR SHIPPING & DUPLICATE PREVENTION & COMMISSION DISCOUNT ***
    router.post('/purchase', async (req, res) => {
        // إضافة shipping_address و quantity
        const { adId, buyerId, amount, paymentMethod, shipping_address, quantity } = req.body;
        
        if (!adId || !buyerId || !amount || !paymentMethod || !quantity) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        try {
            let adInfo = null; let adPool = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM marketing_ads WHERE id = $1', [adId]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; adPool = pool; break; }
            }
            if (!adInfo) return res.status(404).json({ error: "Ad not found." });

            // *** NEW: Shipping Country Check for physical products ***
            if (adInfo.ad_type === 'product' && adInfo.shipping_countries && adInfo.shipping_countries.length > 0) {
                if (!shipping_address || !shipping_address.country) {
                    return res.status(400).json({ error: "عنوان الشحن والدولة مطلوبان لهذا المنتج." });
                }
                if (!adInfo.shipping_countries.includes(shipping_address.country)) {
                    return res.status(403).json({ error: "عذراً، البائع لا يقوم بالشحن إلى دولتك المحددة." });
                }
            }

            // *** NEW: Prevent duplicate transactions for the same purchase intent ***
            // We check for a recent pending transaction. Let's say, within the last 5 minutes.
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            const { pool: buyerProjectPool } = await getUserProjectContext(buyerId);
            const existingTransaction = await buyerProjectPool.query(
                'SELECT id FROM transactions WHERE ad_id = $1 AND buyer_id = $2 AND status = $3 AND created_at > $4',
                [adId, buyerId, 'pending', fiveMinutesAgo]
            );
            if (existingTransaction.rows.length > 0) {
                return res.status(409).json({ error: "لديك طلب معلق بالفعل لهذا المنتج. يرجى الانتظار قليلاً قبل المحاولة مرة أخرى." });
            }

            const sellerId = adInfo.seller_id;
            const isDigital = adInfo.ad_type === 'digital_product';
            let commissionRate = 0.02; // 2%
            
            // *** NEW: Check for seller's commission discount ***
            const { pool: sellerWalletPool } = await getUserProjectContext(sellerId);
            const walletResult = await sellerWalletPool.query('SELECT has_active_discount FROM wallets WHERE user_id = $1', [sellerId]);
            if (walletResult.rows.length > 0 && walletResult.rows[0].has_active_discount) {
                commissionRate *= 0.90; // Apply 10% discount on the commission
            }

            const totalAmount = parseFloat(amount) * parseInt(quantity);
            const commission = totalAmount * commissionRate;
            const transactionId = uuidv4();
            const now = Date.now();
    
            await buyerProjectPool.query(
                // إضافة shipping_address
                `INSERT INTO transactions (id, ad_id, buyer_id, seller_id, amount, currency, commission, status, payment_method, created_at, updated_at, shipping_address)
                 VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10, $11)`,
                [transactionId, adId, buyerId, sellerId, totalAmount, commission, isDigital ? 'completed' : 'pending', paymentMethod, now, now, JSON.stringify(shipping_address)]
            );
    
            if (isDigital) {
                const netAmount = totalAmount - commission;
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, available_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET available_balance = wallets.available_balance + $2`,
                    [sellerId, netAmount]
                );
            } else {
                await sellerWalletPool.query(
                    `INSERT INTO wallets (user_id, pending_balance) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET pending_balance = wallets.pending_balance + $2`,
                    [sellerId, totalAmount]
                );
            }
            
            res.status(201).json({ 
                message: isDigital ? "تم الشراء بنجاح! يمكنك الآن تحميل المنتج." : "تم الدفع بنجاح! المبلغ محجوز لدى المنصة حتى تأكيد الاستلام.",
                transactionId: transactionId 
            });
    
        } catch (error) {
            console.error("Error during purchase:", error);
            res.status(500).json({ error: "Failed to process purchase." });
        }
    });

    // ==========================================================
    // ===== NEW: Seller Application & Approval Endpoints =====
    // ==========================================================
    
    // GET /seller-status/:userId - Check if a user is an approved seller
    router.get('/seller-status/:userId', async (req, res) => {
        const { userId } = req.params;
        try {
            const sellerDetails = await getUserDetailsFromDefaultProject(userId);
            if (sellerDetails) {
                res.status(200).json({ is_approved_seller: sellerDetails.is_approved_seller });
            } else {
                res.status(404).json({ error: "User not found." });
            }
        } catch (error) {
            console.error("Error fetching seller status:", error);
            res.status(500).json({ error: "Failed to fetch seller status." });
        }
    });
    
    // POST /seller-application - Submit an application to become a seller
    router.post('/seller-application', upload.single('documentFile'), async (req, res) => {
        const { userId, details } = req.body;
        const documentFile = req.file;

        if (!userId || !details || !documentFile) {
            return res.status(400).json({ error: "User ID, details, and a document file are required." });
        }

        try {
            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const { supabase } = await getUserProjectContext(userId); // Use user's project for storage

            // Upload the document to a private bucket
            const bucketName = 'seller-applications'; // Ensure this bucket exists and is PRIVATE
            const fileName = `${userId}/${uuidv4()}-${documentFile.originalname}`;
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(fileName, documentFile.buffer, { contentType: documentFile.mimetype });
            
            if (uploadError) throw uploadError;

            const submissionId = uuidv4();
            const submissionData = {
                details: details,
                documentFilePath: fileName // Store the path, not a public URL
            };

            await defaultPool.query(
                'INSERT INTO product_submissions (id, user_id, submission_data, status, created_at) VALUES ($1, $2, $3, $4, $5)',
                [submissionId, userId, JSON.stringify(submissionData), 'pending', Date.now()]
            );

            // Notify the admin/founder
            const applicantDetails = await getUserDetailsFromDefaultProject(userId);
            const adminDetails = await defaultPool.query("SELECT uid FROM users WHERE user_role = 'admin' LIMIT 1");
            
            if (adminDetails.rows.length > 0) {
                const adminId = adminDetails.rows[0].uid;
                const title = "🔔 طلب بائع جديد";
                const body = `قدم المستخدم ${applicantDetails.username} (ID: ${applicantDetails.custom_id}) طلبًا ليصبح بائعًا. يرجى مراجعة الطلب.`;
                // This will send a push notification. You can also create a chat message.
                await sendOneSignalNotification([adminId], title, body, '/', null);
            }

            res.status(201).json({ message: "تم تقديم طلبك بنجاح. ستتم مراجعته قريبًا." });

        } catch (error) {
            console.error("Error submitting seller application:", error);
            res.status(500).json({ error: "Failed to submit application." });
        }
    });
    
    // POST /handle-application/:submissionId - Admin action to approve/reject
    router.post('/handle-application/:submissionId', async (req, res) => {
        const { submissionId } = req.params;
        const { action, callerUid } = req.body; // action can be 'approve' or 'reject'

        if (!['approve', 'reject'].includes(action) || !callerUid) {
            return res.status(400).json({ error: "Invalid action or missing caller ID." });
        }

        try {
            const adminDetails = await getUserDetailsFromDefaultProject(callerUid);
            if (!adminDetails || adminDetails.user_role !== 'admin') {
                return res.status(403).json({ error: "Unauthorized." });
            }

            const defaultPool = projectDbPools[BACKEND_DEFAULT_PROJECT_ID];
            const submissionResult = await defaultPool.query('SELECT * FROM product_submissions WHERE id = $1', [submissionId]);
            if (submissionResult.rows.length === 0) {
                return res.status(404).json({ error: "Submission not found." });
            }
            const submission = submissionResult.rows[0];
            const sellerUserId = submission.user_id;

            if (action === 'approve') {
                await defaultPool.query("UPDATE users SET is_approved_seller = TRUE WHERE uid = $1", [sellerUserId]);
                await defaultPool.query("UPDATE product_submissions SET status = 'approved' WHERE id = $1", [submissionId]);
                await sendOneSignalNotification([sellerUserId], "🎉 طلبك قُبل!", "تهانينا! تم قبول طلبك لتصبح بائعًا. يمكنك الآن نشر المنتجات.", '/', null);
                res.status(200).json({ message: "Seller approved successfully." });
            } else { // reject
                await defaultPool.query("UPDATE product_submissions SET status = 'rejected' WHERE id = $1", [submissionId]);
                await sendOneSignalNotification([sellerUserId], " طلبك رُفض", "نأسف، تم رفض طلبك لتصبح بائعًا في الوقت الحالي.", '/', null);
                res.status(200).json({ message: "Seller rejected." });
            }
        } catch (error) {
            console.error("Error handling application:", error);
            res.status(500).json({ error: "Failed to handle application." });
        }
    });

    // POST /activate-commission-discount - Spend points for discount
    router.post('/activate-commission-discount', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required." });

        try {
            const { pool } = await getUserProjectContext(userId);
            
            // Use transaction to ensure atomicity
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const pointsResult = await client.query('SELECT points FROM user_points WHERE user_id = $1 FOR UPDATE', [userId]);
                const currentPoints = (pointsResult.rows[0]?.points) || 0;

                if (currentPoints < 100) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: "ليس لديك نقاط كافية (المطلوب 100 نقطة)." });
                }

                await client.query('UPDATE user_points SET points = points - 100 WHERE user_id = $1', [userId]);
                await client.query('UPDATE wallets SET has_active_discount = TRUE WHERE user_id = $1', [userId]);

                await client.query('COMMIT');
                res.status(200).json({ message: "تم تفعيل خصم 10% على العمولة بنجاح!" });
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error("Error activating discount:", error);
            res.status(500).json({ error: "Failed to activate discount." });
        }
    });


    // Keep other routes like delete, pin, wallet, orders, etc., but they might need minor adjustments
    // The provided original routes for delete, pin, wallet, and orders seem okay and are kept below.
    
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
    
    // GET /seller/orders/:userId 
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

    // GET /buyer/orders/:userId
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
    
    // GET /seller/notifications/count/:userId
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
            let transaction = null; let transactionPool = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; transactionPool = pool; break; }
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
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
                if (result.rows.length > 0) { transaction = result.rows[0]; break; }
            }

            if (!transaction) return res.status(404).json({ error: "Transaction not found." });
            if (transaction.buyer_id !== callerUid) return res.status(403).json({ error: "Unauthorized: You are not the buyer." });
            if (transaction.status !== 'completed') return res.status(400).json({ error: "Purchase not completed." });

            let adInfo = null; let adProjectId = null;
            for (const projectId in projectDbPools) {
                const pool = projectDbPools[projectId];
                const result = await pool.query('SELECT digital_product_url FROM marketing_ads WHERE id = $1', [transaction.ad_id]);
                if (result.rows.length > 0) { adInfo = result.rows[0]; adProjectId = projectId; break; }
            }
            
            if (!adInfo || !adInfo.digital_product_url) {
                return res.status(404).json({ error: "Digital product file not found for this ad." });
            }

            const supabase = projectSupabaseClients[adProjectId];
            const bucketName = 'digital-products';
            const filePath = adInfo.digital_product_url;
            const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(filePath, 60 * 5); // 5 minutes validity

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
