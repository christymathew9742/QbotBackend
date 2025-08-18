const  AppointmentModal = require('../models/AppointmentModal');
const { errorResponse } = require('../utils/errorResponse');

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const getAllAppointments = async (
    userId,
    page = 1,
    limit = 1,
    search = '',
    status = null,
    date = null,
    user = false
) => {
    try {
        const filter = { user: userId };
        search = search.trim();
    
        if (search) {
            filter.$or = [
                { flowTitle: { $regex: search, $options: 'i' } },
                { whatsAppNumber: { $regex: search, $options: 'i' } },
                { profileName: { $regex: search, $options: 'i' } }
            ];
        }
  
        if (status && status !== 'null') filter.status = status;
  
        if (date && date !== 'null') {
            const selectedDate = new Date(date);
            const nextDate = new Date(selectedDate);
            nextDate.setDate(selectedDate.getDate() + 1);
            filter.createdAt = { $gte: selectedDate, $lt: nextDate };
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
                        default: 5,
                    }
                }
            }
        };
  
        const basePipeline = [{ $match: filter }, statusSortStage];
  
        if (user === 'true' || user === true) {
            basePipeline.push (
                { $sort: { sortStatus: 1, lastUpdatedAt: -1 } },
                {
                    $group: {
                        _id: "$whatsAppNumber",
                        doc: { $first: "$$ROOT" }
                    }
                },
                { $replaceRoot: { newRoot: "$doc" } }
            );
        }
  
        basePipeline.push (
            { $sort: { sortStatus: 1, lastUpdatedAt: -1 } },
            { $skip: skip },
            { $limit: Number(limit)}
        );
  
        const [aggResult] = await AppointmentModal.aggregate ([
            {
                $facet: {
                    data: basePipeline,
                    totalCount: [
                        { $match: filter },
                        ...(user === 'true' || user === true
                        ? [{ $group: { _id: "$whatsAppNumber" } }]
                        : []),
                        { $count: "total" }
                    ],
                    statusCounts: [
                        { $match: filter },
                        { $group: { _id: "$status", count: { $sum: 1 } } }
                    ],
                    sentimentScores: [
                        { $match: filter },
                        {
                            $group: {
                                _id: null,
                                behaviourScore: { $avg: "$sentimentScores.behaviourScore" },
                                sentimentScore: { $avg: "$sentimentScores.sentimentScore" },
                                speedScore: { $avg: "$sentimentScores.speedScore" }
                            }
                        }
                    ],
                    sentimentStats: [
                        {
                            $group: {
                                _id: null,
                                totalBehaviour: { $sum: { $ifNull: ["$sentimentScores.behaviourScore", 0] } },
                                totalSentiment: { $sum: { $ifNull: ["$sentimentScores.sentimentScore", 0] } },
                                totalSpeed: { $sum: { $ifNull: ["$sentimentScores.speedScore", 0] } },
                                totalCount: { $sum: 1 }
                            }
                        }
                    ],
                    completedCount: [
                        { $match: { ...filter, status: "completed" } },
                        { $count: "totalCompleted" }
                    ],
                }
            }
        ]);
  
        let appointments = aggResult.data || null;
        const total = aggResult?.totalCount[0]?.total || 0;
        const appointmentComplited = aggResult?.completedCount[0]?.totalCompleted || 0;
    
        const totalStatusCounts = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
        aggResult.statusCounts.forEach(item => {
            if (totalStatusCounts.hasOwnProperty(item._id)) {
                totalStatusCounts[item._id] = item.count;
            }
        });
  
        const numbers = appointments.map(a => a.whatsAppNumber);
        const historyCountsRaw = numbers.length
        ? await AppointmentModal.aggregate([
            { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
            {
              $group: {
                _id: { number: "$whatsAppNumber", status: "$status" },
                count: { $sum: 1 }
              }
            }
          ])
        : [];
  
        const historyMap = {};
        historyCountsRaw.forEach(item => {
            const number = item._id.number;
            const status = item._id.status;
            if (!historyMap[number]) {
                historyMap[number] = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
            }
                historyMap[number][status] = item.count;
        });

        const sentimentPerNumber = await AppointmentModal.aggregate([
            { $match: { user: userId } },
            {
                $group: {
                    _id: "$whatsAppNumber",
                    totalBehaviour: { $sum: { $ifNull: ["$sentimentScores.behaviourScore", 0] } },
                    totalSentiment: { $sum: { $ifNull: ["$sentimentScores.sentimentScore", 0] } },
                    totalSpeed: { $sum: { $ifNull: ["$sentimentScores.speedScore", 0] } },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    whatsAppNumber: "$_id",
                    behaviourScore: { $divide: ["$totalBehaviour", "$count"] },
                    sentimentScore: { $divide: ["$totalSentiment", "$count"] },
                    speedScore: { $divide: ["$totalSpeed", "$count"] }
                }
            }
        ]);
          
        const sentimentMap = sentimentPerNumber.reduce((acc, s) => {
            acc[s.whatsAppNumber] = {
                behaviourScore: parseFloat(s.behaviourScore.toFixed(1)),
                sentimentScore: parseFloat(s.sentimentScore.toFixed(1)),
                speedScore: parseFloat(s.speedScore.toFixed(1)),
            };
            return acc;
        }, {})
          
        appointments = appointments.map(app => {
            const status = historyMap[app.whatsAppNumber] || { booked: 0, completed: 0, rescheduled: 0, cancelled: 0 };
            const totalAppointments = (status.booked ?? 0) + (status.completed ?? 0) + (status.rescheduled ?? 0);
            const avgSentimentScores = sentimentMap[app.whatsAppNumber] || { behaviourScore: 0, sentimentScore: 0, speedScore: 0 }
            
            let userType = 'Frequent';
            if (totalAppointments === 0) userType = 'Inactive';
            else if (totalAppointments < 3) userType = 'New';
            else if (totalAppointments < 10) userType = 'Engaged';
            
            return { ...app, statusCounts: status, userType, totalAppointments, avgSentimentScores };
        });
  

        let generalData = {};

        if (user !== 'true' && user !== true && limit == 1) {
            const totalUserCound = await AppointmentModal.distinct("whatsAppNumber", { user: userId });
            generalData.totalUniqueUsers = totalUserCound.length;

            const totalActiveUsers = await AppointmentModal.distinct("whatsAppNumber", {
                user: userId,
                status: { $in: ["booked", "rescheduled"] }
            });
            generalData.activeUserCount = totalActiveUsers.length;

            const avgGlobalSentiment = await AppointmentModal.aggregate([
                { $match: { user: userId } },
                {
                    $group: {
                        _id: null,
                        behaviourScore: { $avg: "$sentimentScores.behaviourScore" },
                        finalScore: { $avg: "$sentimentScores.finalScore" },
                        sentimentScore: { $avg: "$sentimentScores.sentimentScore" },
                        speedScore: { $avg: "$sentimentScores.speedScore" }
                    }
                }
            ]);

            generalData.globalAverageSentimentScores = avgGlobalSentiment.map(g => ({
                behaviourScore: parseFloat(g.behaviourScore.toFixed(1) || 0),
                finalScore: parseFloat(g.finalScore.toFixed(1) || 0),
                sentimentScore: parseFloat(g.sentimentScore.toFixed(1) || 0),
                speedScore: parseFloat(g.speedScore.toFixed(1) || 0)
            }));

            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth() + 1;

            const monthlyDataRaw = await AppointmentModal.aggregate([
                {
                    $match: {
                        user: userId,
                        status: { $in: ["booked", "rescheduled", "completed"] },
                        createdAt: {
                            $gte: new Date(currentYear, 0, 1),
                            $lt: new Date(currentYear + 1, 0, 1)
                        }
                    }
                },
                {
                    $group: {
                        _id: { month: { $month: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.month": 1 } }
            ]);

            // Map of current year counts
            const monthCountMap = {};
            monthlyDataRaw.forEach(m => {
                monthCountMap[m._id.month] = m.count;
            });

            // Previous year data
            const previousYearDataRaw = await AppointmentModal.aggregate([
                {
                    $match: {
                        user: userId,
                        status: { $in: ["booked", "rescheduled", "completed"] },
                        createdAt: {
                            $gte: new Date(currentYear - 1, 0, 1),
                            $lt: new Date(currentYear, 0, 1)
                        }
                    }
                },
                {
                    $group: {
                        _id: { month: { $month: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.month": 1 } }
            ]);

            const previousYearData = {};
            previousYearDataRaw.forEach(d => {
                previousYearData[d._id.month] = d.count;
            });

            // Build finalMonthlyData (guarantee all months exist)
            let finalMonthlyData = [];
            for (let m = 1; m <= 12; m++) {
                if (m < currentMonth) {
                    // Past months → only use current year data or 0
                    finalMonthlyData.push({
                        month: m,
                        count: monthCountMap[m] || 0
                    });
                } else if (m === currentMonth) {
                    // Current month → current year, else previous year, else 0
                    finalMonthlyData.push({
                        month: m,
                        count: monthCountMap[m] || previousYearData[m] || 0
                    });
                } else {
                    // Future months → current year, else previous year, else 0
                    finalMonthlyData.push({
                        month: m,
                        count: monthCountMap[m] || previousYearData[m] || 0
                    });
                }
            }

            generalData.monthlyAppointments = finalMonthlyData;


            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const totalAppointments = await AppointmentModal.find({
                user: userId,
                status: { $in: ["booked", "rescheduled"] },
            });
            generalData.totalAppointments = totalAppointments.length;

            const todaysAppointments = await AppointmentModal.countDocuments({
                user: userId,
                status: { $in: ["booked", "rescheduled"] },
                createdAt: { $gte: startOfDay, $lt: endOfDay }
            });
            generalData.todaysAppointments = todaysAppointments;

            const todaysCompletedAppointments = await AppointmentModal.countDocuments({
                user: userId,
                status: "completed",
                lastUpdatedAt: { $gte: startOfDay, $lt: endOfDay }
            });
            generalData.todaysCompletedAppointments = todaysCompletedAppointments;

            const todaysCancelledAppointments = await AppointmentModal.countDocuments({
                user: userId,
                status: "cancelled",
                lastUpdatedAt: { $gte: startOfDay, $lt: endOfDay }
            });

            generalData.todaysCancelledAppointments = todaysCancelledAppointments;
        }
  
        return {
            ...(limit > 1 && { data: appointments }),
            totalBookings: total,
            page: Number(page),
            pages: Math.ceil(total / limit),
            totalStatusCounts,
            ...generalData,
            appointmentComplited,
        };
        
    } catch (error) {
        throw new Error(`Error fetching appointment: ${error.message}`);
    }
};
  
// Getting a single Appointments by ID for a specific user
const getAppointmentsById = async (id, userId) => {
    try {
        const appointment = await AppointmentModal.findOne({ _id: id, user: userId }).lean();
        if (!appointment) {
            throw errorResponse('Appointment not found', 404);
        }

        const { whatsAppNumber } = appointment;

        const [result] = await AppointmentModal.aggregate([
            { $match: { whatsAppNumber, user: userId } },
            {
                $facet: {
                    statusSummary: [
                        { $group: { _id: "$status", count: { $sum: 1 } } }
                    ],
                    allAppointments: [
                        {
                            $addFields: {
                                statusPriority: {
                                    $switch: {
                                        branches: [
                                            { case: { $eq: ["$status", "booked"] }, then: 1 },
                                            { case: { $eq: ["$status", "rescheduled"] }, then: 2 },
                                            { case: { $eq: ["$status", "completed"] }, then: 3 },
                                            { case: { $eq: ["$status", "cancelled"] }, then: 4 }
                                        ],
                                        default: 99
                                    }
                                }
                            }
                        },
                        { $sort: { statusPriority: 1, lastUpdatedAt: -1 } },
                        {
                            $project: {
                                status: 1,
                                "sentimentScores.behaviourScore": 1,
                                "sentimentScores.sentimentScore": 1,
                                "sentimentScores.speedScore": 1,
                                lastUpdatedAt: 1,
                                flowTitle: 1,
                                rescheduleCount: 1
                            }
                        }
                    ],
                    sentimentStats: [
                        {
                            $group: {
                                _id: null,
                                totalBehaviour: { $sum: { $ifNull: ["$sentimentScores.behaviourScore", 0] } },
                                totalSentiment: { $sum: { $ifNull: ["$sentimentScores.sentimentScore", 0] } },
                                totalSpeed: { $sum: { $ifNull: ["$sentimentScores.speedScore", 0] } },
                                totalCount: { $sum: 1 }
                            }
                        }
                    ],
                    latest: [
                        { $sort: { lastUpdatedAt: -1 } },
                        { $limit: 1 },
                        { $project: { status: 1, flowTitle: 1 } }
                    ]
                }
            }
        ]);

        const statusCounts = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };
        result.statusSummary.forEach(({ _id, count }) => {
            if (statusCounts.hasOwnProperty(_id)) {
                statusCounts[_id] = count;
            }
        });

        const totalAppointments = statusCounts.booked + statusCounts.completed + statusCounts.rescheduled;
        let userType = 'Frequent';
        if (totalAppointments === 0) userType = 'Inactive';
        else if (totalAppointments < 3) userType = 'New';
        else if (totalAppointments < 10) userType = 'Engaged';

        const sentimentData = [];
        const statusCounters = {};
        result.allAppointments.forEach(appt => {
            const behaviourScore = appt.sentimentScores?.behaviourScore ?? 0;
            const sentimentScore = appt.sentimentScores?.sentimentScore ?? 0;
            const speedScore = appt.sentimentScores?.speedScore ?? 0;

            if (appt.status === 'rescheduled') {
                sentimentData.push({
                    status: appt.status,
                    rescheduleCount: `(${appt.rescheduleCount ?? 0})`,
                    sentimentScores: { behaviourScore, sentimentScore, speedScore }
                });
            } else if (appt.status === 'booked') {
                sentimentData.push({
                    status: appt.status,
                    sentimentScores: { behaviourScore, sentimentScore, speedScore }
                });
            } else {
                statusCounters[appt.status] = (statusCounters[appt.status] || 0) + 1;
                sentimentData.push({
                    status: `${appt.status}(${statusCounters[appt.status]})`,
                    sentimentScores: { behaviourScore, sentimentScore, speedScore }
                });
            }
        });

        const stats = result.sentimentStats[0] || { totalBehaviour: 0, totalSentiment: 0, totalSpeed: 0, totalCount: 1 };
        const averageSentimentScores = {
            sentimentScores: {
                behaviourScore: parseFloat((stats.totalBehaviour / stats.totalCount).toFixed(1)) || 0,
                sentimentScore: parseFloat((stats.totalSentiment / stats.totalCount).toFixed(1)) || 0,
                speedScore: parseFloat((stats.totalSpeed / stats.totalCount).toFixed(1)) || 0
            }
        };

        const latestStatus = result.latest[0]?.status || null;
        const latestFlowTitle = result.latest[0]?.flowTitle || null;

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

