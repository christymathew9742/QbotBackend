const mongoose = require('mongoose');
const { Schema, Types, model } = mongoose;

const AppointmentSchema = new Schema({
    user: { 
        type: Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    whatsAppNumber: {
        type: String,
        required: true  
    },
    flowId: {
        type: String,
        required: true  
    },
    status: {
        type: String,
        required: true  
    },
    data: {
        type: Map,
        of: Schema.Types.Mixed,
        required: true
    }

}, { timestamps: true });

module.exports = model('AppointmentModal', AppointmentSchema);
