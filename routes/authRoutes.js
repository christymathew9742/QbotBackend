// const express = require('express');
// const router = express.Router();
// const {
//   signUp,
//   login,
//   getCurrentUser,
//   testWhatsapConfig,
//   updateUser,
//   googleLogin,
//   sendOTP,
//   verifyOTP,
//   resetPassword,
//   getWhatsAppUser,
//   getWhatsAppUserById,
//   getGlobalUserData,
// } = require('../controllers/authController');

// const authMiddleware = require('../middlewares/authMiddleware');
// const userMiddleware = require('../middlewares/userMiddleware');

// const multer = require('multer');
// const path = require('path');
// const { Storage } = require('@google-cloud/storage');

// let storage;
// if (process.env.GCS_CREDENTIALS) {
//   storage = new Storage({
//     credentials: JSON.parse(process.env.GCS_CREDENTIALS),
//   });
// } else {
//   const path = require('path');
//   storage = new Storage({
//     keyFilename: path.join(process.cwd(), 'gcs-key.json'),
//   });
// }

// const bucketName = process.env.GCS_BUCKET_NAME;
// const bucket = storage.bucket(bucketName);

// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 50 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith('image/')) cb(null, true);
//     else cb(new Error('Only image files are allowed!'), false);
//   },
// });

// async function uploadToGCS(req, res, next) {
//   if (!req.file) return next();

//   try {
//     const now = new Date();
//     const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
//     const userId = req.user.userId;
//     const cleanName = req.file.originalname.replace(/\s+/g, '-');
//     const fileName = `profilePic/${monthFolder}/${userId}/${userId}-${cleanName}`;

//     const [files] = await bucket.getFiles({ prefix: `profilePic/${monthFolder}/${userId}/` });
//     for (const file of files) {
//       await file.delete().catch((err) => console.error('Error deleting old file:', err));
//     }

//     const blob = bucket.file(fileName);
//     const blobStream = blob.createWriteStream({
//       resumable: false,
//       contentType: req.file.mimetype,
//       metadata: { contentType: req.file.mimetype },
//     });

//     blobStream.on('error', (err) => {
//       console.error('❌ GCS Upload Error:', err);
//       return res.status(500).json({ error: 'GCS upload failed', details: err.message });
//     });

//     blobStream.on('finish', () => {
//       req.file.gcsUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
//       req.fileName = fileName;
//       next();
//     });

//     blobStream.end(req.file.buffer);
//   } catch (error) {
//     console.error('❌ Upload Middleware Error:', error);
//     return res.status(500).json({ error: 'Upload failed', details: error.message });
//   }
// }

// router.get('/profile-image/:userId/:fileName', authMiddleware, async (req, res) => {
//   const { userId, fileName } = req.params;

//   if (req.user.userId !== userId) {
//     return res.status(403).json({ success: false, message: 'Access denied' });
//   }

//   const file = bucket.file(`profilePic/${userId}/${fileName}`);
//   const [exists] = await file.exists();

//   if (!exists) {
//     return res.status(404).json({ success: false, message: 'File not found' });
//   }

//   const stream = file.createReadStream();
//   stream.on('error', (err) => res.status(500).json({ success: false, message: err.message }));
//   stream.pipe(res);
// });

// // ---------------- Routes ---------------- //
// router.post('/signup', signUp);
// router.post('/google-login', googleLogin);
// router.post('/login', login);
// router.post('/forgot-password', sendOTP);
// router.post('/verify-otp', verifyOTP);
// router.post('/reset-password', resetPassword);

// router.put(
//   '/profile/:userId',
//   authMiddleware,
//   userMiddleware,
//   (req, res, next) => {
//     const { updateUserProfile } = require('../controllers/userController');
//     updateUserProfile(req, res, next);
//   }
// );

// router.get('/user', authMiddleware, getCurrentUser);
// router.get('/whatsapp', authMiddleware, getWhatsAppUser);
// router.get('/whatsapp/:id', authMiddleware, getWhatsAppUserById);
// router.get('/globaldata', authMiddleware, getGlobalUserData);
// router.post('/sendmessage', authMiddleware, testWhatsapConfig);
// router.put('/update', authMiddleware, upload.single('file'), uploadToGCS, updateUser);

// module.exports = router;


const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const {
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
} = require('../controllers/authController');

const authMiddleware = require('../middlewares/authMiddleware');
const userMiddleware = require('../middlewares/userMiddleware');

let storage;

if (process.env.NODE_ENV === 'production') {
  storage = new Storage({
    keyFilename: '/secrets/key.json', 
    projectId: process.env.GCS_PROJECT_ID,
  });
} else if (process.env.GCS_CREDENTIALS) {
  storage = new Storage({
    credentials: JSON.parse(process.env.GCS_CREDENTIALS),
    projectId: process.env.GCS_PROJECT_ID,
  });
} else {
  storage = new Storage({
    keyFilename: path.join(process.cwd(), 'gcs-key.json'),
  });
}

const bucketName = process.env.GCS_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

async function uploadToGCS(req, res, next) {
  if (!req.file) return next();

  try {
    const now = new Date();
    const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const userId = req.user.userId;
    const cleanName = req.file.originalname.replace(/\s+/g, '-');
    const fileName = `profilePic/${monthFolder}/${userId}/${userId}-${cleanName}`;

    const [files] = await bucket.getFiles({ prefix: `profilePic/${monthFolder}/${userId}/` });
    for (const file of files) {
      await file.delete().catch((err) => console.error('Error deleting old file:', err));
    }

    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: req.file.mimetype,
      metadata: { contentType: req.file.mimetype },
    });

    blobStream.on('error', (err) => {
      console.error('❌ GCS Upload Error:', err);
      return res.status(500).json({ error: 'GCS upload failed', details: err.message });
    });

    blobStream.on('finish', () => {
      req.file.gcsUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      req.fileName = fileName;
      next();
    });

    blobStream.end(req.file.buffer);
  } catch (error) {
    console.error('❌ Upload Middleware Error:', error);
    return res.status(500).json({ error: 'Upload failed', details: error.message });
  }
}

router.post('/signup', signUp);
router.post('/google-login', googleLogin);
router.post('/login', login);
router.post('/forgot-password', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

router.put(
  '/profile/:userId',
  authMiddleware,
  userMiddleware,
  (req, res, next) => {
    const { updateUserProfile } = require('../controllers/userController');
    updateUserProfile(req, res, next);
  }
);

router.get('/user', authMiddleware, getCurrentUser);
router.get('/whatsapp', authMiddleware, getWhatsAppUser);
router.get('/whatsapp/:id', authMiddleware, getWhatsAppUserById);
router.get('/globaldata', authMiddleware, getGlobalUserData);
router.post('/sendmessage', authMiddleware, testWhatsapConfig);

router.put(
  '/update',
  authMiddleware,
  upload.single('file'),
  uploadToGCS,
  updateUser
);

router.get('/profile-image/:userId/:fileName', authMiddleware, async (req, res) => {
  const { userId, fileName } = req.params;

  if (req.user.userId !== userId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  try {
    const file = bucket.file(`profilePic/${fileName}`);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ success: false, message: 'File not found' });

    const stream = file.createReadStream();
    stream.on('error', (err) => res.status(500).json({ success: false, message: err.message }));
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;






