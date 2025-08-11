const  AppointmentModal = require('../models/AppointmentModal');
const { errorResponse } = require('../utils/errorResponse');

const getAllAppointments = async (
    userId,
    page = 1,
    limit = 9,
    search = '',
    status = null,
    date = null,
    user = false,
) => {
    try {
        const filter = { user: userId };
        search = search.trim();

        if (search) {
            filter.$or = [
                { flowTitle: { $regex: search, $options: 'i' } },
                { whatsAppNumber: { $regex: search, $options: 'i' } },
                { profileName: { $regex: search, $options: 'i' } },
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
                $lt: nextDate,
            };
        }

        const skip = (page - 1) * limit;

        const statusSortStage = {
            $addFields: {
                sortStatus: {
                    $switch: {
                        branches: [
                            { case: { $eq: ["$status", "booked"] }, then: 1 },
                            { case: { $eq: ["$status", "rescheduled"] }, then: 2 },
                            { case: { $eq: ["$status", "completed"] }, then: 3 },
                            { case: { $eq: ["$status", "cancelled"] }, then: 4 }
                        ],
                        default: 5
                    }
                }
            }
        };

        let appointments, total;

        if (user === 'true' || user === true) {
            const pipeline = [
                { $match: filter },
                statusSortStage,
                { $sort: { sortStatus: 1, updatedAt: -1 } },
                {
                    $group: {
                        _id: "$whatsAppNumber",
                        doc: { $first: "$$ROOT" }
                    }
                },
                { $replaceRoot: { newRoot: "$doc" } },
                { $sort: { sortStatus: 1, updatedAt: -1 } },
                { $skip: skip },
                { $limit: Number(limit) }
            ];

            const [appointmentsRes, countRes] = await Promise.all([
                AppointmentModal.aggregate(pipeline),
                AppointmentModal.aggregate([
                    { $match: filter },
                    { $group: { _id: "$whatsAppNumber" } },
                    { $count: "total" }
                ])
            ]);

            appointments = appointmentsRes;
            total = countRes[0]?.total || 0;
        } else {
            const pipeline = [
                { $match: filter },
                statusSortStage,
                { $sort: { sortStatus: 1, updatedAt: -1 } },
                { $skip: skip },
                { $limit: Number(limit) }
            ];

            const [appointmentsRes, totalRes] = await Promise.all([
                AppointmentModal.aggregate(pipeline),
                AppointmentModal.countDocuments(filter)
            ]);

            appointments = appointmentsRes;
            total = totalRes;
        }

        // FIX: statusCounts to use same filter and always include 0 for missing statuses
        const statusCountsRaw = await AppointmentModal.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalStatusCounts = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
        statusCountsRaw.forEach(item => {
            if (totalStatusCounts.hasOwnProperty(item._id)) {
                totalStatusCounts[item._id] = item.count;
            }
        });

        // Per WhatsApp number history counts
        const numbers = appointments.map(a => a.whatsAppNumber);
        const historyCountsRaw = await AppointmentModal.aggregate([
            { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
            {
                $group: {
                    _id: { number: "$whatsAppNumber", status: "$status" },
                    count: { $sum: 1 }
                }
            }
        ]);

        const historyMap = {};
        historyCountsRaw.forEach(item => {
            const number = item._id.number;
            const status = item._id.status;
            if (!historyMap[number]) {
                historyMap[number] = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
            }
            historyMap[number][status] = item.count;
        });

        const dataWithHistory = appointments.map(app => {
            const status = historyMap[app.whatsAppNumber] || { booked: 0, completed: 0, rescheduled: 0, cancelled: 0 };
          
            const booked = status.booked ?? 0;
            const completed = status.completed ?? 0;
            const rescheduled = status.rescheduled ?? 0;
          
            const totalAppointments = booked + completed + rescheduled;
          
            let userType = 'Frequent';
          
            if (totalAppointments === 0) userType = 'Inactive';
            else if (totalAppointments < 3) userType = 'New';
            else if (totalAppointments < 10) userType = 'Engaged';
          
            return {
              ...app,
              statusCounts: status,
              userType,
              totalAppointments,
            };
        });
          
        const sentimentAppointments = await AppointmentModal.find(
            filter,
            {
                "sentimentScores.behaviourScore": 1,
                "sentimentScores.sentimentScore": 1,
                "sentimentScores.speedScore": 1
            }
        ).lean();

        const totalSentiments = sentimentAppointments.length || 1;

        const sumBehaviour = sentimentAppointments.reduce((sum, a) => sum + (a.sentimentScores?.behaviourScore ?? 0), 0);
        const sumSentiment = sentimentAppointments.reduce((sum, a) => sum + (a.sentimentScores?.sentimentScore ?? 0), 0);
        const sumSpeed = sentimentAppointments.reduce((sum, a) => sum + (a.sentimentScores?.speedScore ?? 0), 0);

        const averageSentimentScores = {
            sentimentScores: {
                behaviourScore: Math.round(sumBehaviour / totalSentiments),
                sentimentScore: Math.round(sumSentiment / totalSentiments),
                speedScore: Math.round(sumSpeed / totalSentiments),
            }
        };

        return {
            data: dataWithHistory,
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
            totalStatusCounts,
            averageSentimentScores,
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

        const whatsAppNumber = appointment.whatsAppNumber;

        const statusSummary = await AppointmentModal.aggregate([
            { $match: { whatsAppNumber, user: userId } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);
        const statusCounts = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
        statusSummary.forEach(item => {
            if (statusCounts.hasOwnProperty(item._id)) {
                statusCounts[item._id] = item.count;
            }
        });
          
        const booked = statusCounts.booked ?? 0;
        const completed = statusCounts.completed ?? 0;
        const rescheduled = statusCounts.rescheduled ?? 0;
        const totalAppointments = booked + completed + rescheduled;
        
        let userType = 'Frequent';
        
        if (totalAppointments === 0) userType = 'Inactive';
        else if (totalAppointments < 3) userType = 'New';
        else if (totalAppointments < 10) userType = 'Engaged';
        
        const allAppointments = await AppointmentModal.find(
            { whatsAppNumber, user: userId },
            {
                status: 1,
                "sentimentScores.behaviourScore": 1,
                "sentimentScores.sentimentScore": 1,
                "sentimentScores.speedScore": 1,
                updatedAt: 1,
                flowTitle: 1,

            }
        ).lean();

        const statusPriority = {
            booked: 1,
            rescheduled: 2,
            completed: 3,
            cancelled: 4,
        };
        
        allAppointments.sort((a, b) => {
            const statusDiff = statusPriority[a.status] - statusPriority[b.status];
            if (statusDiff !== 0) return statusDiff;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
        
        const sentimentData = [];
        const statusCounters = {};
        const rescheduleCount = '('+appointment?.rescheduleCount+')' || 0
        allAppointments.forEach(appt => {
            const status = appt.status;
            if(status == 'rescheduled')  sentimentData.rescheduleCount = rescheduleCount;
            
            const buildSentimentScores = (appt) => ({
                behaviourScore: appt.sentimentScores?.behaviourScore ?? 0,
                sentimentScore: appt.sentimentScores?.sentimentScore ?? 0,
                speedScore: appt.sentimentScores?.speedScore ?? 0,
            });
              
            switch (status) {
                case "rescheduled":
                    sentimentData.push({
                        status,
                        rescheduleCount,
                        sentimentScores: buildSentimentScores(appt),
                    });
                    break;
              
                case "booked":
                    sentimentData.push({
                        status,
                        sentimentScores: buildSentimentScores(appt),
                    });
                    break;
              
                default:
                    statusCounters[status] = (statusCounters[status] || 0) + 1;
                    sentimentData.push({
                        status: `${status}(${statusCounters[status]})`,
                        sentimentScores: buildSentimentScores(appt),
                    });
                    break;
            }
              
        });

        const total = allAppointments.length || 1;
        const sumBehaviour = allAppointments.reduce((sum, a) => sum + (a.sentimentScores?.behaviourScore ?? 0), 0);
        const sumSentiment = allAppointments.reduce((sum, a) => sum + (a.sentimentScores?.sentimentScore ?? 0), 0);
        const sumSpeed = allAppointments.reduce((sum, a) => sum + (a.sentimentScores?.speedScore ?? 0), 0);

        const averageSentimentScores = {
            sentimentScores: {
                behaviourScore: Math.round(sumBehaviour / total),
                sentimentScore: Math.round(sumSentiment / total),
                speedScore: Math.round(sumSpeed / total),
            }
        };

        const latestAppointment = allAppointments.reduce((latest, appt) => {
            if (!latest) return appt;
            return new Date(appt.updatedAt) > new Date(latest.updatedAt) ? appt : latest;
        }, null);
        
        const latestStatus = latestAppointment?.status || null;
        const latestFlowTitle = latestAppointment?.flowTitle || null;

        return {
            appointment,
            whatsAppNumber,
            statusCounts,
            userType,
            totalAppointments,
            sentimentData,
            averageSentimentScores,
            latestStatus,
            latestFlowTitle,
        };

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

