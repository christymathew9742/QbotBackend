const express = require('express');
const {getAllAppointments, getAppointmentsById, updateAppointments, deleteAppointments} = require('../controllers/appointmentController');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

router.get('/',authMiddleware, getAllAppointments);
router.get('/:id', authMiddleware, getAppointmentsById);
router.put('/:id', authMiddleware, updateAppointments);
router.delete('/:id', authMiddleware, deleteAppointments);

module.exports = router;