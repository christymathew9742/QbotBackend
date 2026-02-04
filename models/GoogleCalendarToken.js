const mongoose = require("mongoose");

const googleCalendarTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiryDate: { type: Number, required: true },
  email: { type: String },
});

module.exports = mongoose.model("GoogleCalendarToken", googleCalendarTokenSchema);

