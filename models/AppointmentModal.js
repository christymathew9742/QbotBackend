const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const MessageSchema = new Schema({
    sender: {
        type: String,
        required: true,
    },
    message: {
        type: Schema.Types.Mixed,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

const AppointmentSchema = new Schema(
    {
        user: {
            type: Types.ObjectId,
            ref: 'User',
            required: true,
        },
        whatsAppNumber: {
            type: String,
            required: true,
        },
        flowId: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            required: true,
        },
        data: {
            type: Map,
            of: Schema.Types.Mixed,
            required: true,
        },
        history: {
            type: [MessageSchema],
            required: true,
        },
        flowTitle: String,
        profileName: String,
    },
    { timestamps: true }
);

module.exports = model('AppointmentModal', AppointmentSchema);
