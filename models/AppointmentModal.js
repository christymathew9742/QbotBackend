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
        sentimentScores: {
            sentimentScore: { type: Number },
            behaviourScore: { type: Number },
            speedScore: { type: Number },
            finalScore: { type: Number },
        },
        sentimentScoresHistory: [{
            sentimentScore: { type: Number, default: 0 },
            behaviourScore: { type: Number, default: 0 },
            speedScore: { type: Number, default: 0 },
            finalScore: { type: Number, default: 0 },
        }],
        rescheduleCount: { type: Number, required: true },
        flowTitle: String,
        profileName: String,
        lastActiveAt: String,
        userCreated:String,
    },
    { timestamps: true }
);

module.exports = model('AppointmentModal', AppointmentSchema);
