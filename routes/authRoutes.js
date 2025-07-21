const express = require('express');
const router = express.Router();
const { signUp, login,getCurrentUser, testWhatsapConfig, updateUser} = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const userMiddleware = require('../middlewares/userMiddleware');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const subfolder = `image/IMG-${month}`;
        const uploadPath = path.join(process.cwd(), 'uploads', subfolder);
        fs.mkdirSync(uploadPath, { recursive: true });
        req.uploadFolderPath = subfolder;
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        const cleanName = file.originalname.replace(/\s+/g, '-');
        const fileName = `${uniqueId}-${cleanName}`;
        req.uploadedFileId = uniqueId;
        req.fileName = fileName;
        cb(null, fileName);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true); 
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const upload = multer({ storage, fileFilter });

router.post('/signup', signUp);
router.post('/login', login);
router.put('/profile/:userId', authMiddleware, userMiddleware, (req, res, next) => {
    const { updateUserProfile } = require('../controllers/userController');
    updateUserProfile(req, res, next);
});
router.get('/user', authMiddleware, getCurrentUser);
router.post('/sendmessage', authMiddleware, testWhatsapConfig);
router.put('/update', upload.single('file'), authMiddleware, updateUser);

module.exports = router;

