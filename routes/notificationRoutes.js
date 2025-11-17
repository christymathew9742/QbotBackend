const express = require('express');
const {getAllNotifications, updateNotifications} = require('../controllers/notificationController');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

router.get('/', authMiddleware, getAllNotifications);
router.put('/:id', authMiddleware, updateNotifications);

module.exports = router;