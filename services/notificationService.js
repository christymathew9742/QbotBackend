const Notification = require('../models/Notification');

const createNotifications = async (notificationData) => {
    try {
        const notification = new Notification(notificationData);
        if (!notification) {
            throw errorResponse('notification not found', 404);
        }
        return await notification.save();
    } catch (error) {
        throw new Error(`Error creating notification: ${error.message}`);
    }
};

const getAllNotifications = async (userId, showAll) => {
    try {
        const filter = { userId };
        let query = Notification.find(filter).sort({ createdAt: -1 });
        if (showAll == 'false') {
            query = query.limit(5);
        }
        const notifications = await query;
        const unreadCount = await Notification.countDocuments({ userId, isRead: false });

        return { notifications, unreadCount };
    } catch (error) {
        throw new Error(`Error fetching notifications: ${error.message}`);
    }
};

const updateNotifications = async (id, data, userId) => {

    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: id, userId, isRead: false },
            { $set: data }, 
            {
                new: true,
                runValidators: true,
            }
        );

        if (!notification) {
            throw errorResponse('Notification not found or already read', 404);
        }

        return notification;
    } catch (error) {
        throw new Error(`Error updating notification: ${error.message}`);
    }
};

module.exports = {
    createNotifications,
    getAllNotifications,
    updateNotifications,
};