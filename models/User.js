const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true},
  generateToken: { type: Boolean, default: false },
  verifytoken: String,
  phonenumberid:String,
  accesstoken:String,
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

userSchema.pre('save', function(next) {
  this.password = bcrypt.hashSync(this.password, 10);
  this.confirmPassword = undefined;
  next();
});

module.exports = mongoose.model('User', userSchema);

