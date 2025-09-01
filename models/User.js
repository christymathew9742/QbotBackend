const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema, Types } = mongoose;

const userSchema = new Schema({
  source: { 
    type: String, 
    default: 'chatBot' 
  },
  username: { 
    type: String, 
    required: function () {
      return this.source !== "whatsapp";
    }
  },
  email: { 
    type: String, 
    unique: true, 
    sparse: true,  
    required: function () {
      return this.source !== "whatsapp";
    },
  },
  password: { 
    type: String, 
    required: function () {
      return this.source !== "whatsapp";
    }
  },
  generateToken: Boolean,
  verifytoken: String,
  phonenumberid:String,
  accesstoken:String,
  rescheduleCount: { 
    type: Number, 
    default: 0 
  },
  user: {
    type: Types.ObjectId,
    ref: 'User',
  },
  whatsAppNumber: {
      type: String,
  },
  flowId: {
      type: String,
  },
  status: {
      type: String,
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
  flowTitle: String,
  profileName: String,
  lastActiveAt: {
      type: Date, 
      default: Date.now,
  },
  userCreated: {
      type: Date, 
      default: Date.now,
  },
  lastUpdatedAt: {
      type: Date, 
      default: Date.now,
  },
  profilepick: {
    originalName: {
      type: String,
    },
    mimeType: {
      type: String,
    },
    size: {
      type: Number,
    },
    path: {
      type: String,
    },
    filename: {
      type: String,
    },
    fileUrl: {
      type: String,
    }
  },
  googleProfilePic: String,
  displayname: String,
  country:String,
  state:String,
  phone: String,
  postalcode:String,
  bio: String,
  facebook: String,
  twitter: String,
  linkedin: String,
  instagram: String,
  taxId:String,
  role: { 
    type: String, 
    enum: ['user', 'admin', 'superadmin'], 
    default: 'user', 
  },
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});


module.exports = mongoose.model('User', userSchema);

