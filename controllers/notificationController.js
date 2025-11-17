
const notificationService = require('../services/notificationService') 

// auto creation of notification based on the user intractions
async function createNotification (notificationData) {
    if(!notificationData?.userId || !notificationData?.type) return;

    try {
        const notification = await notificationService.createNotifications(notificationData);
        return notification;
    } catch (err) {
        console.error("Notification Error:", err);
    }
}

// get all notifications
const getAllNotifications = async (req, res, next) => {
    const {
        showAll = false,
    } = req.query;
    try {
        const notification = await notificationService.getAllNotifications(req.user.userId, showAll)
        res.status(200).json({ success: true,  ...notification});
    } catch (error) {
        next(error);
    }
};

const updateNotifications = async (req, res, next) => {
    try {
        const notification = await notificationService.updateNotifications(req.params.id, req.body, req.user.userId);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'notification not found or unauthorized' });
        }
        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        next(error);
    }
};
  
module.exports = {
    createNotification, 
    getAllNotifications,
    updateNotifications,
};