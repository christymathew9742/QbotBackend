const twilio = require('twilio');

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSmsOtp(phone, otp) {
  try {
    await client.messages.create({
        body: `Qbot Verification Code: ${otp}. This OTP is valid for 10 minutes. Do not share it with anyone.`,
        from: process.env.TWILIO_PHONE,
        to: phone,
    });
    return { success: true };
  } catch (error) {
    console.error('SMS Error:', error);
    return { success: false, error };
  }
}

module.exports = sendSmsOtp;
