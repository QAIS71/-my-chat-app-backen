// pushNotifications.js
const webPush = require('web-push');

// مفاتيح الأمان الخاصة بك التي أعطيتني إياها
const publicVapidKey = 'BBlbt3D5lIiDN7xEbe4FfEA7ipXGsv0_fbP5xawOR3-5R7FxT9KNh_tUXklvENkADLYiv_2V8xPmncl8IcaaTIM';
const privateVapidKey = '03sShkGPnA_dYhcGL45wXj0YJWBLweuMyMfhOWLoWOw';

/**
 * هذه الدالة تقوم بإعداد تفاصيل الإشعارات وإنشاء نقطة النهاية (endpoint)
 * لحفظ اشتراكات المستخدمين.
 * @param {object} app - The Express app instance.
 * @param {object} defaultPool - The database pool for the default project.
 */
function setup(app, defaultPool) {
    webPush.setVapidDetails(
      'mailto:your-email@example.com', // يمكنك وضع بريدك الإلكتروني هنا
      publicVapidKey,
      privateVapidKey
    );

    // نقطة النهاية لحفظ اشتراكات الإشعارات
    app.post('/api/subscribe', async (req, res) => {
        const { subscription, userId } = req.body;
        if (!subscription || !userId) {
            return res.status(400).json({ error: 'Subscription and userId are required.' });
        }
        try {
            // استخدام ON CONFLICT لتحديث الاشتراك إذا كان موجوداً بالفعل بدلاً من إضافة صف جديد
            await defaultPool.query(
                `INSERT INTO push_subscriptions (user_id, subscription_info) VALUES ($1, $2)
                 ON CONFLICT (user_id) DO UPDATE SET subscription_info = EXCLUDED.subscription_info`,
                [userId, JSON.stringify(subscription)]
            );
            console.log(`تم حفظ/تحديث اشتراك الإشعارات للمستخدم: ${userId}`);
            res.status(201).json({ message: 'Subscription saved.' });
        } catch (error) {
            console.error('Error saving subscription:', error);
            res.status(500).json({ error: 'Failed to save subscription.' });
        }
    });
    console.log('تم تجهيز نقطة النهاية /api/subscribe للإشعارات.');
}

/**
 * هذه الدالة تقوم بإرسال إشعار لمستخدم معين.
 * @param {object} defaultPool - The database pool for the default project.
 * @param {string} recipientId - The UID of the user to send the notification to.
 * @param {object} payload - The notification content { title, body, url }.
 */
async function sendNotificationToUser(defaultPool, recipientId, payload) {
    try {
        const subResult = await defaultPool.query('SELECT subscription_info FROM push_subscriptions WHERE user_id = $1', [recipientId]);
        if (subResult.rows.length > 0) {
            const subscription = subResult.rows[0].subscription_info;
            await webPush.sendNotification(subscription, JSON.stringify(payload));
            console.log(`تم إرسال إشعار فوري إلى المستخدم: ${recipientId}`);
        }
    } catch (error) {
        console.error(`فشل إرسال إشعار إلى ${recipientId}:`, error.body || error.message);
        // إذا كان الاشتراك منتهي الصلاحية أو غير صالح، قم بحذفه من قاعدة البيانات
        if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`اشتراك المستخدم ${recipientId} غير صالح. سيتم حذفه.`);
            await defaultPool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [recipientId]);
        }
    }
}

module.exports = { setup, sendNotificationToUser };
