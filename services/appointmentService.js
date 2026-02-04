const  AppointmentModal = require('../models/AppointmentModal');
const { errorResponse } = require('../utils/errorResponse');

// get all appointment
const getDayRangeInUTC = (dateStr, timeZone) => {
    const startOfDay = new Date(dateStr);
    startOfDay.setUTCHours(0,0,0,0);
    
    const getOffsetMinutes = (d, tz) => {
        const utcDate = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(d.toLocaleString('en-US', { timeZone: tz }));
        return (tzDate.getTime() - utcDate.getTime()) / 60000;
    };

    const offsetMinutes = getOffsetMinutes(startOfDay, timeZone);
    startOfDay.setMinutes(startOfDay.getMinutes() - offsetMinutes);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    return { start: startOfDay, end: endOfDay };
};

const getAllAppointments = async (
    userId,
    page = 1,
    limit = 6,
    search = '',
    status = null,
    date = null,
    userTimeZone = 'Asia/Kolkata'
) => {
    try {
        const filter = { user: userId };
        const andConditions = [];

        if (search?.trim()) {
            andConditions.push({
                $or: [
                    { flowTitle: { $regex: search, $options: 'i' } },
                    { whatsAppNumber: { $regex: search, $options: 'i' } },
                    { profileName: { $regex: search, $options: 'i' } }
                ]
            });
        }

        if (status && status !== 'null') {
            filter.status = status;
        }

        if (date && date !== 'null') {
            const selectedDate = new Date(date);

            if (!isNaN(selectedDate.getTime())) {
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const month = monthNames[selectedDate.getUTCMonth()];
                const day = selectedDate.getUTCDate();
                const dayPart = day < 10 ? `0?${day}` : day;
                const datePattern = `^${month}\\s*${dayPart}(?!\\d)`; 
                const { start: startUTC, end: endUTC } = getDayRangeInUTC(date, userTimeZone);
                andConditions.push({
                    $or: [
                        { 'data.Select Specific Time': { $regex: datePattern, $options: 'i' } },
                        {
                            $and: [
                                {
                                    $or: [
                                        { 'data.Select Specific Time': { $exists: false } },
                                        { 'data.Select Specific Time': null },
                                        { 'data.Select Specific Time': "" }
                                    ]
                                },
                                { createdAt: { $gte: startUTC, $lt: endUTC } }
                            ]
                        }
                    ]
                });
            }
        }

        if (andConditions.length > 0) {
            filter.$and = andConditions;
        }

        const skip = (page - 1) * limit;

        const [appointments, total] = await Promise.all([
            AppointmentModal.find(filter)
                .sort({ lastUpdatedAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),

            AppointmentModal.countDocuments(filter)
        ]);

        return {
            data: appointments,
            totalBookings: total,
            page: Number(page),
            pages: Math.ceil(total / limit)
        };

    } catch (error) {
        throw new Error(`Error fetching appointments: ${error.message}`);
    }
};
  
// Getting a single Appointments by ID for a specific user
const getAppointmentsById = async (id, userId) => {
    try {
        if (!id || !userId) {
            throw errorResponse('Invalid request. Appointment ID and User ID are required.', 400);
        }

        const appointment = await AppointmentModal.findOne({ _id: id, user: userId }).lean();

        if (!appointment) {
            throw errorResponse('Appointment not found', 404);
        }

        return {
            success: true,
            appointment,
        };
    } catch (error) {
        throw errorResponse(`Error fetching appointment: ${error.message}`, 500);
    }
};

// Updating a Appointments with unique title validation
const updateAppointments = async (id, appointmentData, userId) => {
    try {
        if(appointmentData?.status) {
            const updateAppointments = await AppointmentModal.findOneAndUpdate(
                { _id: id, user: userId },
                { 
                    ...appointmentData,
                    lastUpdatedAt: new Date() 
                },
                {
                    new: true,
                    runValidators: true,
                },
            );
            if (!updateAppointments) {
                throw errorResponse('ChatBot not found', 404);
            }
            return updateAppointments;
        }
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

