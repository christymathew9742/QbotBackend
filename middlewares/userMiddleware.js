const { errorResponse } = require('../utils/errorResponse');
const User = require('../models/User');

const userMiddleware = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return next(errorResponse('User not found', 404));
        }
        if (req.params.userId !== req.user.userId.toString()) {
            return next(errorResponse('You are not authorized to perform this action', 403));
        }
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = userMiddleware;
