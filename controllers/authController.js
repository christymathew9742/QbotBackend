const { registerUserService, loginUserService, updateUserService } = require('../services/authService');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { baseUrl } = require('../config/whatsappConfig');
const { default: axios } = require('axios');

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
      res.status(200).json({
        success: true,
        data: userData,
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
                error: 'Missing required fields: userId, sendmessage (messageText), or sendnumber (phoneNumber)'
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

        console.log('WhatsApp API Response:', response.data);

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

const updateUser = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    
        const existingUser = await User.findById(userId);
        if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });
    
        const updateFields = {};
    
        if (req.file) {
            const { path: filePath, filename, originalname, mimetype, size } = req.file;
            const newFilePath = path.join(path.dirname(filePath), req.fileName);
            await fs.promises.rename(filePath, newFilePath);
    
            updateFields.profilepick = {
                originalName: originalname,
                mimeType: mimetype,
                size,
                path: newFilePath,
                filename: req.fileName,
                fileUrl: `${req.protocol}://${req.get('host')}/uploads/${req.uploadFolderPath}/${req.fileName}`,
            };
        }
  
        ['displayname', 'username', 'email', 'phone', 'bio', 'profilepick','country', 'state', 'postalcode', 'taxId', 'accesstoken','facebook', 'twitter', 'linkedin', 'instagram', 'phonenumberid']
        .forEach(field => {
            if (req.body[field] !== undefined) updateFields[field] = req.body[field];
        });
    
        // Token generation
        if (req.body.generateToken === true && existingUser.generateToken !== true) {
            const token = jwt.sign({
            userId: existingUser._id.toString(),
            issuedAt: new Date().toISOString(),
        }, process.env.JWT_SECRET, { expiresIn: '1d' });
            updateFields.verifytoken = token;
            updateFields.generateToken = true;
        }

        const updatedUser = await updateUserService(userId, updateFields);
        res.status(200).json({ success: true, message: 'Profile updated successfully', data: updatedUser });
    } catch (error) {
        console.error('Update user error:', error);
        next(new Error(`User update failed: ${error.message}`));
    }
};
  
module.exports = {
    signUp,
    login,
    getCurrentUser,
    testWhatsapConfig,
    updateUser,
};



