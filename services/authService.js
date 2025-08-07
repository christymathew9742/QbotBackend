const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const registerUserService = async ({ username, email, password, role}, creatorRole) => {
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            throw new Error('Email already in use.');
        }
        const userRole = (creatorRole === 'superadmin' && role) ? role : 'user';
        const user = new User({ username, email, password, role: userRole});
        await user.save();

        // Create JWT token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        return { user, token };
    } catch (error) {
        throw error;
    }
};

const loginUserService = async ({ email, password }) => {
    try {
        const user = await User.findOne({ email });
        if (!user) {
            const error = new Error('Invalid email.');
            error.statusCode = 401;
            throw error;
        }

        const passwordMatch = bcrypt.compareSync(password, user.password);
        
        if (!passwordMatch) {
            const error = new Error('Invalid  password');
            error.statusCode = 401;
            throw error;
        }

        // Create JWT token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        return { user, token };
    } catch (error) {
        throw error;
    }
};

//update user details
const updateUserService = async (userId, updateFields) => {
   
    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-password');
  
        if (!updatedUser) {
            throw new Error('User not found');
        }
        return updatedUser;

    } catch (error) {
        console.error(error); 
        throw error;
    }
};

module.exports = {
    registerUserService,
    loginUserService,
    updateUserService,
};

