const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema (
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ["booked", "rescheduled", "cancelled"],
            required: true,
            index: true, 
        },
        whatsAppNumber: {
            type: String,
            required: true,
        },
        chatBotTitle: {
            type: String,
            required: true,
            trim: true,
        },
        profileName: {
            type: String,
            required: true,
            trim: true,
        },
        appointmentId: {
            type: Schema.Types.ObjectId,
            ref: "AppointmentModal",
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true, 
    }
);

notificationSchema.statics.getUnreadCount = async function (userId) {
    return this.countDocuments({ userId, isRead: false });
};

notificationSchema.index (
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
