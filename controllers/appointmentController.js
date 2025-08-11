const { errorResponse } = require('../utils/errorResponse');
const appointmentService = require('../services/appointmentService')


// Get all Appointments for the authenticated user
const getAllAppointments = async (req, res, next) => {
    try {
        const { page, limit, search, status, date, user } = req.query;
        const appointments = await appointmentService.getAllAppointments(req.user.userId, page, limit, search, status, date, user);
        res.status(200).json({ success: true, ...appointments });
    } catch (error) {
        next(error);
    }
};

// Get a specific Appointments by ID for the authenticated user
const getAppointmentsById = async (req, res, next) => {
    try {
            const appointments = await appointmentService.getAppointmentsById(req.params.id, req.user.userId);
            if (!appointments) {
                return res.status(404).json({ success: false, message: 'appointments not found' });
            }
        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        next(error);
    }
};

// Update a Appointments if it belongs to the authenticated user
const updateAppointments = async (req, res, next) => {
    try {
        const updatedAppointments = await appointmentService.updateAppointments(req.params.id, req.body, req.user.userId);
        if (!updatedAppointments) {
            return res.status(404).json({ success: false, message: 'Appointments not found or unauthorized' });
        }
        res.status(200).json({ success: true, data: updatedAppointments });
    } catch (error) {
        next(error);
    }
};

// Delete a Appointments if it belongs to the authenticated user
const deleteAppointments = async (req, res, next) => {
    try {
        const message = await appointmentService.deleteAppointments(req.params.id, req.user.userId);
        if (!message) {
            return res.status(404).json({ success: false, message: 'Appointment not found or unauthorized' });
        }
        res.status(200).json({ success: true, message });
    } catch (error) {
        next(error);
    }
};

module.exports = {
  getAllAppointments,
  getAppointmentsById,
  updateAppointments,
  deleteAppointments,
};