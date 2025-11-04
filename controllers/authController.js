const { 
    registerUserService,
    loginUserService, 
    updateUserService, 
    whtatsAppUserService,
    getWhatsAppUserDetails,
    whtatsAppGlobalUserService,
} = require('../services/authService');

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { baseUrl } = require('../config/whatsappConfig');
const { default: axios } = require('axios');
const {validateToken, generateOtpEmailTemplate} = require('../utils/common');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { generateOTP } = require('../utils/otp');
const nodemailer = require('nodemailer'); 
const sendSmsOtp =require('../utils/sendSms')

// Sign up a new user
const signUp = async (req, res, next) => {
    const { username, email, password, role } = req.body;

    try {
        const { user, token } = await registerUserService({ username, email, password, role }, req.user?.role || 'user');

        res.status(201).json({
            success: true,
            message: 'Registration completed successfully',
            data: {
                user: {
                    userId: user._id,
                    username: user.username,
                    email: user.email,
                },
                token,
            },
        });
    } catch (error) {
        next(error);
    }
};

//Login user 
const login = async (req, res, next) => {
    const { email, password } = req.body;

    try {
        const { user, token } = await loginUserService({ email, password });
        res.status(200).json({
            success: true,
            message: 'Logged in successfully',
            data: {
                user: {
                    userId: user._id,
                    username: user.username,
                    email: user.email,
                },
                token,
            },
        });
    } catch (error) {
        res.status(error.statusCode || 401).json({
            success: false,
            message: error.message || 'Login failed. Please try again.',
        });
    }
};

// Get current user
const getCurrentUser = async (req, res, next) => {

    try {
        const userData = await User.findById(req.user.userId).select('-password');
        const tocken  = userData?.verifytoken || '';
        const tokenDetails = validateToken(tocken);
      
        res.status(200).json({
          success: true,
          data: {
            ...userData.toObject(),
            tokenDetails,
          },
        });
    } catch (error) {
        next(error);
    }  
};

const testWhatsapConfig = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const messageText = req.body?.sendmessage;
        const phoneNumber = req.body?.sendnumber;
        const userData = await User.findById(userId);
        const plainUser = userData?.toObject() || {};
        const token =  userData.accesstoken;

        if (!userId || !messageText || !phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, send message (messageText), or sendnumber (phoneNumber)'
            });
        }

        if (!userData?.accesstoken || !userData?.phonenumberid) {
            return res.status(400).json({
                success: false,
                error: 'Missing WhatsApp credentials: accessToken or phoneNumberId not found for user'
            });
        }

        const payload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: { body: messageText }
        };

        const config = {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        // Send message
        const response = await axios.post(`${baseUrl}/${userData.phonenumberid}/messages`, payload, config);

        return res.status(200).json({
            success: true,
            message: 'Message sent successfully via WhatsApp API',
            data: {
                contacts: response.data.contacts || null,
                messages: response.data.messages || null,
                messaging_product: response.data.messaging_product || 'whatsapp',
                ...plainUser,
            },
        });

    } catch (error) {
        // Capture and send actual API error
        const apiError = error.response?.data || error.message;

        return res.status(500).json({
            success: false,
            error: 'Failed to send message via WhatsApp API',
            log: apiError
        });
    }
};

//update user data
// const updateUser = async (req, res, next) => {
//     try {
//         const userId = req.user?.userId;
//         if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

//         const existingUser = await User.findById(userId);
//         if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });

//         const updateFields = {};

//         if(req.file){
//             updateFields.profilepic = {
//                 originalName: req.file.originalname,
//                 mimeType: req.file.mimetype,
//                 size: req.file.size,
//                 fileName: req.fileName,
//                 fileUrl: req.file.gcsUrl,
//             };
//         }

//         ['displayname', 'username', 'email', 'phone', 'bio', 'profilepic','country', 'state', 'postalcode', 'taxId', 'accesstoken','facebook', 'twitter', 'linkedin', 'instagram', 'phonenumberid'].forEach(field => {
//             if (req.body[field] !== undefined) updateFields[field] = req.body[field];
//         });

//         if (req.body.generateToken === true && existingUser.generateToken !== true) {
//             const token = jwt.sign(
//                 { userId: existingUser._id.toString(), issuedAt: new Date().toISOString() },
//                 process.env.JWT_SECRET,
//                 { expiresIn: '7d' }
//             );
//             updateFields.verifytoken = token;
//             updateFields.generateToken = true;
//         }

//         const updatedUser = await updateUserService(userId, updateFields);

//         res.status(200).json({
//             success: true,
//             message: 'Profile updated successfully',
//             data: updatedUser
//         });
//     } catch (error) {
//         console.error('Update user error:', error);
//         next(new Error(`User update failed: ${error.message}`));
//     }
// };

const updateUser = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const existingUser = await User.findById(userId);
        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updateFields = {};

        if (req.file) {
            updateFields.profilepic = {
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
                fileName: req.fileName,
                fileUrl: req.file.gcsUrl,
            };
        }

        [
            'displayname', 'username', 'email', 'phone', 'bio', 'profilepic', 'country', 'state',
            'postalcode', 'taxId', 'accesstoken', 'facebook', 'twitter', 'linkedin',
            'instagram', 'phonenumberid'
        ].forEach(field => {
            if (req.body[field] !== undefined) updateFields[field] = req.body[field];
        });

        if (updateFields.phonenumberid && updateFields.phonenumberid !== existingUser.phonenumberid) {
            const existingPhoneOwner = await User.findOne({ phonenumberid: updateFields.phonenumberid });

            if (existingPhoneOwner && existingPhoneOwner._id.toString() !== userId) {
                return res.status(400).json({
                    message: 'This phone number ID is already associated with another account.',
                    success:false,
                });
            }
        }

        if (req.body.generateToken === true && existingUser.generateToken !== true) {
            const token = jwt.sign(
                { userId: existingUser._id.toString(), issuedAt: new Date().toISOString() },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            updateFields.verifytoken = token;
            updateFields.generateToken = true;
        }

        const updatedUser = await updateUserService(userId, updateFields);

        return res.status(200).json({
            success: true,
            message: 'API configuration updated successfully.',
            data: updatedUser
        });

    } catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({
            success: false,
            message: `User update failed: ${error.message}`
        });
    }
};

const googleLogin = async (req, res) => {
    const { token } = req.body;

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, sub, picture } = payload;

        let user = await User.findOne({ email });

        if (!user) {
            user = new User({
                username: name,
                email,
                password: sub,
                role: 'user',
                googleProfilePic: picture,
            });
            await user.save();
        } else {

            if (user.googleProfilePic !== picture) {
                user.googleProfilePic = picture;
                await user.save();
            }
        }

        const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        res.status(200).json({
            success: true,
            message: 'Google login successful',
            data: {
                user: {
                    userId: user._id,
                    username: user.username,
                    email: user.email,
                    googleProfilePic: user.googleProfilePic,
                },
                token: jwtToken,
            },
        });
    } catch (error) {
        console.error('Google Login Error:', error);
        res.status(401).json({ success: false, message: 'Invalid Google token' });
    }
};

const sendOTP = async (req, res) => {
    const { emailOrPhone } = req.body;

    try {
        const user = await User.findOne({
            $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
        });
  
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const otp = generateOTP();
        const expiry = Date.now() + 10 * 60 * 1000; 

        user.otpCode = otp;
        user.otpExpiresAt = new Date(expiry);
        await user.save();
  
        // send mail
        if (user.email && user.email.trim() === emailOrPhone.trim()) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.MAIL_FROM,
                    pass: process.env.MAIL_PASS,
                },
            });

            await transporter.sendMail({
                from: process.env.MAIL_FROM,
                to: user.email,
                subject: 'Your Qbot OTP Code',
                html: generateOtpEmailTemplate(otp),
            });
        }

        // send sms
        if (user.phone && user.phone.trim() === emailOrPhone.trim()) {
            await sendSmsOtp(user.phone, otp);
        }

        res.status(200).json({ success: true, message: 'OTP sent successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
};

const verifyOTP = async (req, res) => {
    const { emailOrPhone, otp } = req.body;

    if (!emailOrPhone || !otp) return res.status(400).json({ success: false, message: 'OTP, email or phone number is required' });
  
    try {
        const user = await User.findOne({
            $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
            otpCode: otp,
            otpExpiresAt: { $gt: new Date() },
        });
  
        if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  
        res.status(200).json({ success: true, message: 'OTP verified', userId: user._id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'OTP verification failed' });
    }
};

const resetPassword = async (req, res) => {
    const { userId, password } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: 'User ID is required' });

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        user.password = password;
        user.otpCode = null;
        user.otpExpiresAt = null;
        await user.save();

        res.status(200).json({ success: true, message: 'Password reset successful' });
    } catch (err) {
        console.error('Save error:', err);
        res.status(500).json({ success: false, message: 'Reset password failed' });
    }
};

//get all whatsap user
const getWhatsAppUser = async (req, res, next) => {
    try {
        const { page, limit, search, status } = req.query;
        const whtsapUser = await whtatsAppUserService(req.user.userId, page, limit, search, status);
        res.status(200).json({ success: true, ...whtsapUser });
    } catch (error) {
        next(error);
    }
};

// get WhatsApp user by id
const getWhatsAppUserById = async (req, res, next) => {
    try {
            const whatsap = await getWhatsAppUserDetails(req.params.id, req.user.userId);
            if (!whatsap) {
                return res.status(404).json({ success: false, message: 'WhatsApp not found' });
            }
        res.status(200).json({ success: true, data: whatsap });
    } catch (error) {
        next(error);
    }
}; 

//get all global user data
const getGlobalUserData = async (req, res, next) => {
    try {
        const whtsapGlobalUser = await whtatsAppGlobalUserService(req.user.userId);
        res.status(200).json({ success: true, ...whtsapGlobalUser });
    } catch (error) {
        next(error);
    }
};
  
module.exports = {
    signUp,
    login,
    getCurrentUser,
    testWhatsapConfig,
    updateUser,
    googleLogin,
    sendOTP,
    verifyOTP,
    resetPassword,
    getWhatsAppUser,
    getWhatsAppUserById,
    getGlobalUserData,
};



