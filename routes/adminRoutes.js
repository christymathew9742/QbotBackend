const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Apply auth middleware globally
router.use(authMiddleware);

// Superadmin only: Get all users
router.get('/users', roleMiddleware(['superadmin', 'admin']), adminController.getAllUsers);

// Superadmin only: Update user role
router.put('/users/:userId/role', roleMiddleware(['superadmin']), adminController.updateUserRole);

// Superadmin & Admin: Delete user
router.delete('/users/:userId', roleMiddleware(['superadmin', 'admin']), adminController.deleteUser);

// Superadmin & Admin: Create user (assuming a route is added in controller)
router.post('/users', roleMiddleware(['superadmin', 'admin']), adminController.createUser);

module.exports = router;

