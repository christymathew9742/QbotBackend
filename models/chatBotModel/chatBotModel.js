const mongoose = require('mongoose');

const ChatBotSchema = new mongoose.Schema({
  title: {
    type: String, 
    default: '',
    required: true,
  },
  edges: {
    type: [Object], 
    default: [],
    required: true,
  },
  nodes: {
    type: [Object],
    default: [], 
    required: true,
  },
  viewport: {
    type: {
      x: { type: Number}, 
      y: { type: Number},
      zoom: { type: Number}, 
    },
    required: true ,
  },
  status: {
    type: Boolean, 
    default: false,
    required: true,
  },
  update: {
    type: Boolean, 
    default: false,
    required: true,
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  }
}, { timestamps: true } );

module.exports = {
  ChatBotModel: mongoose.model('ChatBotModel', ChatBotSchema),
};
