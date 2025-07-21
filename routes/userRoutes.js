const express = require('express');
const { updateUserProfile,getAuthenticated } = require('../controllers/userController');
const userMiddleware = require('../middlewares/authMiddleware');
const upload = require('../utils/fileUpload');
const router = express.Router();

router.put('/user', userMiddleware, upload.single('profileImage'), updateUserProfile);

module.exports = router;
