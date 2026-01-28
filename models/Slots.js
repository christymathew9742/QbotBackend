const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const SlotsSchema = new Schema(
    {
        user: {
            type: Types.ObjectId,
            ref: 'User',
            required: false, 
        },
        slot: {
            type: String,
            required: true,
        },
        currentNode: Number,
        SlotId: Number,
        googleEventId: String,
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
    { flowId: 1, slot: 1 }, 
    { 
        unique: true, 
        partialFilterExpression: { status: { $gt: 'available' } } 
    }
);

const retentionDays = parseInt(process.env.SLOT_RETENTION_DAYS) || 90;
const expireSeconds = retentionDays * 24 * 60 * 60;
SlotsSchema.index({ createdAt: 1 }, { expireAfterSeconds: expireSeconds });
const Slots = mongoose.model('Slots', SlotsSchema);

Slots.syncIndexes()
    .then(() => {
        console.log("✅ [Slots Model] Protection Active: Double-booking is now IMPOSSIBLE.");
    })
    .catch((err) => {
        console.error("❌ [Slots Model] Index Error:", err.message);
        console.log("👉 ACTION: You likely have duplicate 'underProcess' slots in DB. Delete them and restart.");
    });

module.exports = Slots;


// // models/Slots.js (Update this file)
// const mongoose = require('mongoose');
// const { Schema, Types } = mongoose;

// const SlotsSchema = new Schema(
//     {
//         user: {
//             type: Types.ObjectId,
//             ref: 'User',
//             required: false, 
//         },
//         slot: {
//             type: String,
//             required: true,
//         },
//         // ... (keep existing fields like currentNode, SlotId, etc.)
//         currentNode: Number,
//         SlotId: Number,
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
//             enum: ['booked', 'available', 'underProcess'],
//             default: 'underProcess',
//         },
//         // 👇 ADD THIS NEW FIELD
//         googleEventId: {
//             type: String,
//             default: null
//         }
//     },
//     { timestamps: true }
// );

// // ... (keep your existing indexes and protection logic) ...
// // SlotsSchema.index(...) 

// const Slots = mongoose.model('Slots', SlotsSchema);
// module.exports = Slots;