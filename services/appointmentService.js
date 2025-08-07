const  AppointmentModal = require('../models/AppointmentModal');
const { errorResponse } = require('../utils/errorResponse');


// Getting all Appointments with pagination, search, status, date
const getAllAppointments = async (
    userId,
    page = 1,
    limit = 9,
    search = '',
    status = null,
    date = null,
) => {
    try {
        const filter = { user: userId };
        search = search.trim();
    
        if (search) {
            filter.$or = [
                { flowTitle: { $regex: search, $options: 'i' } },
                { whatsAppNumber: { $regex: search, $options: 'i' } }
            ];
        }
    
        if (status && status !== 'null') {
            filter.status = status; 
        }
    
        if (date && date !== 'null') {
            const selectedDate = new Date(date);
            const nextDate = new Date(selectedDate);
            nextDate.setDate(selectedDate.getDate() + 1);
    
            filter.createdAt = {
                $gte: selectedDate,
                $lt: nextDate
            };
        }
    
        const skip = (page - 1) * limit;
    
        const appointment = await AppointmentModal.find(filter)
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 });
    
        const total = await AppointmentModal.countDocuments(filter);
    
        return {
            data: appointment,
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
        };
    } catch (error) {
        throw new Error(`Error fetching appointment: ${error.message}`);
    }
};

// Getting a single Appointments by ID for a specific user
const getAppointmentsById = async (id, userId) => {
    try {
        const appointment = await AppointmentModal.findOne({ _id: id, user: userId });
        if (!appointment) {
            throw errorResponse('Appointment not found', 404);
        }
        return appointment;
    } catch (error) {
        throw new Error(`Error fetching appointment: ${error.message}`);
    }
};

// Updating a Appointments with unique title validation
const updateAppointments = async (id, appointmentData, userId) => {
    try {

        const updateAppointments = await AppointmentModal.findOneAndUpdate(
            { _id: id, user: userId },
            appointmentData,
            {
                new: true,
                runValidators: true,
            }
        );
        if (!updateAppointments) {
            throw errorResponse('ChatBot not found', 404);
        }
        return updateAppointments;
    } catch (error) {
        throw new Error(`Error updating ChatBot: ${error.message}`);
    }
};

// Deleting a Appointments for a specific user
const deleteAppointments = async (id, userId) => {
    try {
        const appointment = await AppointmentModal.findOneAndDelete({ _id: id, user: userId });
        if (!appointment) {
            throw errorResponse('appointment not found', 404);
        }
        return 'appointment deleted successfully';
    } catch (error) {
        throw errorResponse(error.message || 'Error deleting appointment', error.status || 500);
    }
};

module.exports = {
    getAllAppointments,
    getAppointmentsById,
    updateAppointments,
    deleteAppointments,
};
