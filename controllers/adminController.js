const User = require('../models/User');
const validator = require('validator');

// Create user — Superadmin or Admin
const getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        return res.status(200).json({ success: true, data: users });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Create user — Superadmin or Admin
const createUser = async (req, res) => {
    try {
        const { username, email, password, role } = req.body;

        if (!username || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (!validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }

        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.status(400).json({ success: false, message: 'Username already taken' });
        }

        const newUser = new User({ username: username.trim(), email: email.toLowerCase(), password, role });
        await newUser.save();

        return res.status(201).json({ success: true, message: 'User created', data: { id: newUser._id, username, email, role } });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Update user role — Only Superadmin
const updateUserRole = async (req, res) => {
    try {
        
        const { userId } = req.params;
        const { role } = req.body;

        if (!validator.isMongoId(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const user = await User.findByIdAndUpdate(userId, { role }, { new: true, runValidators: true }).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({ success: true, message: 'Role updated', data: user });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Delete user — Superadmin & Admin
const deleteUser = async (req, res) => {
    try {
        
        const { userId } = req.params;

        if (!validator.isMongoId(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        if (req.user._id.toString() === userId) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }

        const deletedUser = await User.findByIdAndDelete(userId);
        if (!deletedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({ success: true, message: 'User deleted' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

module.exports = {
    getAllUsers,
    createUser,
    updateUserRole,
    deleteUser,
};
