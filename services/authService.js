const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppointmentModal = require('../models/AppointmentModal');
const { default: mongoose } = require('mongoose');

const registerUserService = async ({ username, email, password, role}, creatorRole) => {
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            throw new Error('Email already in use.');
        }
        const userRole = (creatorRole === 'superadmin' && role) ? role : 'user';
        const user = new User({ username, email, password, role: userRole});
        await user.save();

        // Create JWT token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        return { user, token };
    } catch (error) {
        throw error;
    }
};

const loginUserService = async ({ email, password }) => {
    try {
        const user = await User.findOne({ email });
        if (!user) {
            const error = new Error('Invalid email.');
            error.statusCode = 401;
            throw error;
        }

        const passwordMatch = bcrypt.compareSync(password, user.password);
        
        if (!passwordMatch) {
            const error = new Error('Invalid  password');
            error.statusCode = 401;
            throw error;
        }

        // Create JWT token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        return { user, token };
    } catch (error) {
        throw error;
    }
};

//update user details
const updateUserService = async (userId, updateFields) => {
   console.log('Update fields received:', updateFields);
    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true, runValidators: true },
        ).select('-password');
  
        if (!updatedUser) {
            throw new Error('User not found');
        }
        return updatedUser;

    } catch (error) {
        console.error(error); 
        throw error;
    }
};

// whatsApp user service
const buildHistoryMap = (historyArr) => {
    const historyMap = {};
    historyArr.forEach(({ _id: { number, status }, count }) => {
        if (!historyMap[number]) {
            historyMap[number] = { booked: 0, completed: 0, rescheduled: 0, cancelled: 0 };
        }
        historyMap[number][status] = count;
    });
    return historyMap;
};

const buildSentimentMap = (sentimentArr) => {
    return sentimentArr.reduce((acc, s) => {
        acc[s._id] = {
            behaviourScore: parseFloat(((s.totalBehaviour / s.count) || 0).toFixed(1)),
            sentimentScore: parseFloat(((s.totalSentiment / s.count) || 0).toFixed(1)),
            speedScore: parseFloat(((s.totalSpeed / s.count) || 0).toFixed(1)),
            finalScore: parseFloat(((s.totalFinalScore / s.count) || 0).toFixed(1)),
        };
        return acc;
    }, {});
};

const allAppointmentSentimentMap = (allAppointmentSentiment) => {
    const sentimentData = [];
    const statusCounters = {};
    allAppointmentSentiment.forEach(appt => {
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
    return sentimentData;
};

const getUserType = (appointments) => {
    if (appointments === 0) return "Inactive";
    if (appointments < 3) return "New";
    if (appointments < 10) return "Engaged";
    return "Frequent";
};

const fetchHistoryAndSentiment = async (numbers, userId = null) => {
    const extraAgg = await AppointmentModal.aggregate([
        { $match: { whatsAppNumber: { $in: numbers }, ...(userId && { user: userId }) } },
        {
            $facet: {
                history: [
                    {
                        $group: {
                        _id: { number: "$whatsAppNumber", status: "$status" },
                        count: { $sum: 1 },
                        },
                    },
                ],
                sentiment: [
                    {
                        $group: {
                            _id: "$whatsAppNumber",
                            totalBehaviour: { $sum: { $ifNull: ["$sentimentScores.behaviourScore", 0] } },
                            totalSentiment: { $sum: { $ifNull: ["$sentimentScores.sentimentScore", 0] } },
                            totalSpeed: { $sum: { $ifNull: ["$sentimentScores.speedScore", 0] } },
                            totalFinalScore: { $sum: { $ifNull: ["$sentimentScores.finalScore", 0] } },
                            count: { $sum: 1 },
                        },
                    },
                ],
                allAppointmentSentiments: [
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
            },
        },
    ]);

    return {
        historyMap: buildHistoryMap(extraAgg[0].history),
        sentimentMap: buildSentimentMap(extraAgg[0].sentiment),
        allAppointmentSentiments: allAppointmentSentimentMap(extraAgg[0].allAppointmentSentiments),
    };
};

const enrichUserData = (user, historyMap, sentimentMap, allAppointmentSentiments = []) => {
    const number = user.whatsAppNumber;

    const statusCounts = historyMap[number] || { booked: 0, completed: 0, rescheduled: 0, cancelled: 0 };
    const totalAppointments =
        (statusCounts.booked ?? 0) +
        (statusCounts.completed ?? 0) +
        (statusCounts.rescheduled ?? 0);

    const avgSentimentScores = sentimentMap[number] || {
        behaviourScore: 0,
        sentimentScore: 0,
        speedScore: 0,
        finalScore: 0,
    };

    return {
        ...user,
        statusCounts,
        totalAppointments,
        AppointmentsCount: totalAppointments,
        avgSentimentScores,
        ...(allAppointmentSentiments.length > 0 && { sentimentData: allAppointmentSentiments }),
        userType: getUserType(totalAppointments),
    };
};

const whtatsAppUserService = async (userId = null, page = 1, limit = 10, search = "", status = null) => {
    console.log(page,limit,search)
    try {
        const filter = { source: "whatsapp" };
        search = search.trim();

        if (userId) filter.user = userId;
        if (search) {
            filter.$or = [
                { whatsAppNumber: { $regex: search, $options: "i" } },
                { profileName: { $regex: search, $options: "i" } },
            ];
        }
        
        if (status && status !== "") {
            filter.status = status === "active";
        }

        const skip = (page - 1) * Number(limit);

        const results = await User.aggregate ([
            { $match: filter },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: { createdAt: -1 } },
                        { $skip: skip },
                        { $limit: Number(limit) },
                        {
                            $project: {
                                _id: 1,
                                user: 1,
                                whatsAppNumber: 1,
                                profileName: 1,
                                status: 1,
                                createdAt: 1,
                            },
                        },
                    ],
                },
            },
        ]);

        const total = results[0].metadata[0]?.total || 0;
        let whatsAppUser = results[0].data;

        if (!whatsAppUser.length) {
            return { data: [], total, page: Number(page), pages: Math.ceil(total / Number(limit)) };
        }

        const numbers = whatsAppUser.map((u) => u.whatsAppNumber);
        const { historyMap, sentimentMap } = await fetchHistoryAndSentiment(numbers, userId);

        whatsAppUser = whatsAppUser.map((user) => enrichUserData(user, historyMap, sentimentMap));

        return { data: whatsAppUser, total, page: Number(page), pages: Math.ceil(total / Number(limit)) };
    } catch (error) {
        throw new Error(`Error fetching WhatsApp users: ${error.message}`);
    }
};

const getWhatsAppUserDetails = async (id, userId) => {
    try {
            const filter = { _id: new mongoose.Types.ObjectId(id) };
        if (userId) filter.user = userId;

        const userAgg = await User.aggregate ([
            { $match: filter },
            {
                $project: {
                    _id: 1,
                    user: 1,
                    flowTitle:1,
                    whatsAppNumber: 1,
                    profileName: 1,
                    status: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    lastActiveAt: 1,
                    lastUpdatedAt: 1,
                },
            },
        ]);

        if (!userAgg.length) throw new Error("WhatsApp user not found");

        const user = userAgg[0];
        const { historyMap, sentimentMap, allAppointmentSentiments } = await fetchHistoryAndSentiment([user.whatsAppNumber], userId);

        return enrichUserData(user, historyMap, sentimentMap, allAppointmentSentiments);
    } catch (error) {
        throw new Error(`Error fetching WhatsApp user details: ${error.message}`);
    }
};

const whtatsAppGlobalUserService = async (userId) => {
    // ---------- GENERAL DATA ----------
    let generalData = {};
    const [
        totalUserCound, 
        totalActiveUsers, 
        avgGlobalSentiment, 
        monthlyDataRaw, 
        previousYearDataRaw, 
        totalAppointments, 
        todaysAppointments, 
        todaysCompletedAppointments, 
        todaysCancelledAppointments, 
        completedCount,
        cancelledCount,
        totalBooking,
    ] = await Promise.all([
        AppointmentModal.distinct("whatsAppNumber", { user: userId }),
        AppointmentModal.distinct("whatsAppNumber", { user: userId, status: { $in: ["booked", "rescheduled"] } }),
        AppointmentModal.aggregate([
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
        ]),
        AppointmentModal.aggregate([
            {
            $match: {
                user: userId,
                status: { $in: ["booked", "rescheduled", "completed"] },
                createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1), $lt: new Date(new Date().getFullYear() + 1, 0, 1) }
            }
            },
            { $group: { _id: { month: { $month: "$createdAt" } }, count: { $sum: 1 } } },
            { $sort: { "_id.month": 1 } }
        ]),
        AppointmentModal.aggregate([
            {
                $match: {
                    user: userId,
                    status: { $in: ["booked", "rescheduled", "completed"] },
                    createdAt: { $gte: new Date(new Date().getFullYear() - 1, 0, 1), $lt: new Date(new Date().getFullYear(), 0, 1) }
                }
            },
            { $group: { _id: { month: { $month: "$createdAt" } }, count: { $sum: 1 } } },
            { $sort: { "_id.month": 1 } }
        ]),
        AppointmentModal.find({ user: userId, status: { $in: ["booked", "rescheduled"] } }),
        AppointmentModal.countDocuments({
            user: userId,
            status: { $in: ["booked", "rescheduled"] },
            createdAt: { $gte: new Date().setHours(0, 0, 0, 0), $lt: new Date().setHours(23, 59, 59, 999) }
        }),
        AppointmentModal.countDocuments({
            user: userId,
            status: "completed",
            lastUpdatedAt: { $gte: new Date().setHours(0, 0, 0, 0), $lt: new Date().setHours(23, 59, 59, 999) }
        }),
        AppointmentModal.countDocuments({
            user: userId,
            status: "cancelled",
            lastUpdatedAt: { $gte: new Date().setHours(0, 0, 0, 0), $lt: new Date().setHours(23, 59, 59, 999) }
        }),
        AppointmentModal.countDocuments({
            user: userId,
            status: "completed"
        }),
        AppointmentModal.countDocuments({
            user: userId,
            status: "cancelled"
        }),
        AppointmentModal.countDocuments({
            user: userId,
        })
    ]);

    const monthCountMap = {};
    monthlyDataRaw.forEach(m => { monthCountMap[m._id.month] = m.count; });

    const previousYearData = {};
    previousYearDataRaw.forEach(d => { previousYearData[d._id.month] = d.count; });

    let finalMonthlyData = [];
    for (let m = 1; m <= 12; m++) {
        finalMonthlyData.push({ month: m, count: monthCountMap[m] || previousYearData[m] || 0 });
    }

    generalData = {
        totalUniqueUsers: totalUserCound.length,
        activeUserCount: totalActiveUsers.length,
        globalAverageSentimentScores: avgGlobalSentiment.map(g => ({
            behaviourScore: parseFloat(g.behaviourScore?.toFixed(1) || 0),
            finalScore: parseFloat(g.finalScore?.toFixed(1) || 0),
            sentimentScore: parseFloat(g.sentimentScore?.toFixed(1) || 0),
            speedScore: parseFloat(g.speedScore?.toFixed(1) || 0)
        })),
        monthlyAppointments: finalMonthlyData,
        totalAppointments: totalAppointments.length,
        todaysAppointments,
        todaysCompletedAppointments,
        todaysCancelledAppointments,
        completedCount,
        cancelledCount,
        totalBooking,
    };
    return generalData;
}

module.exports = {
    registerUserService,
    loginUserService,
    updateUserService,
    whtatsAppUserService,
    getWhatsAppUserDetails,
    whtatsAppGlobalUserService,
};

