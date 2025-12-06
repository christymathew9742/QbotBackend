// const mongoose = require('mongoose');
// const { Schema, Types } = mongoose;

// const SlotsSchema = new Schema(
//     {
//         user: {
//             type: Types.ObjectId,
//             ref: 'User',
//             required: true,
//         },
//         slot: {
//             type: String,
//             required: true,
//         },
//         whatsappNumber: {
//             type: String,
//             required: true,
//         },
//         flowId: {
//             type: String,
//             required: true,
//         },
//         status: {
//             type: String,
//             enum: ['booked', 'available', 'cancelled', 'underProcess'], 
//             default: 'available',
//         },
//     },
//     { timestamps: true }
// );

// module.exports = mongoose.model('Slots', SlotsSchema);


const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const SlotsSchema = new Schema (
    {
        user: {
            type: Types.ObjectId,
            ref: 'User',
            required: true,
        },
        slot: {
            type: String,
            required: true,
        },
        whatsappNumber: {
            type: String,
            required: true,
        },
        flowId: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ['booked', 'available', 'underProcess'], 
            default: 'underProcess', 
        },
    },
    { timestamps: true } 
);

SlotsSchema.index(
    { user: 1, flowId: 1, slot: 1 }, 
    { 
        unique: true, 
        partialFilterExpression: { status: { $ne: 'available' } } 
    }
);

const retentionDays = parseInt(process.env.SLOT_RETENTION_DAYS) || 60;
const expireSeconds = retentionDays * 24 * 60 * 60;
SlotsSchema.index({ createdAt: 1 }, { expireAfterSeconds: expireSeconds });

module.exports = mongoose.model('Slots', SlotsSchema);