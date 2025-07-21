const User = require('../models/User');
const { errorResponse } = require('../utils/errorResponse');

//update authenticated
const updateUserProfileService = async (userId, updates, file) => {
    const user = await User.findById(userId);
    if (!user) {
        throw errorResponse('User not found', 404);
    }

    if (file) {
        updates.profileImage = file.path;
    }
    const updatedUser = await User.findByIdAndUpdate(userId, updates, { new: true });
    return updatedUser;
};

module.exports = { 
    updateUserProfileService,
};


