const { updateUserProfileService} = require('../services/userService');

// update user details
const updateUserProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const updates = req.body;
        const updatedUser = await updateUserProfileService(userId, updates, req.file);

        res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
        next(error);
    }
};

module.exports = { 
    updateUserProfile,
};
