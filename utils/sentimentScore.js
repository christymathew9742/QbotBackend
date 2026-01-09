// const Sentiment = require('sentiment');
// const sentiment = new Sentiment();
// const AppointmentModal = require('../models/AppointmentModal');
// const WEIGHTS = {completed: 10,rescheduled: -1,cancelled: -5};

// const normalizeNumber = num => (num ? String(num).replace(/\D/g, '') : '');

// const normalizeChatHistory = (chatHistory) => {
//     if (!Array.isArray(chatHistory)) return [];
//     return chatHistory.map(chat => ({
//         ...chat,
//         message: typeof chat.message === 'string'
//             ? chat.message.trim()
//             : (() => {
//                 try {
//                     return JSON.stringify(chat.message);
//                 } catch {
//                     return '';
//                 }
//             })()
//     }));
// };

// // ---------------------- GET HISTORY COUNTS ----------------------
// const getHistoryCounts = async (numbers, userId, updateQuery = null, updateData = null) => {
//     if (!Array.isArray(numbers)) numbers = [numbers];

//     // Step 1: Get current counts
//     const historyCountsRaw = await AppointmentModal?.aggregate([
//         { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
//         {
//             $group: {
//                 _id: { number: "$whatsAppNumber", status: "$status" },
//                 count: { $sum: 1 }
//             }
//         }
//     ]).read("primary"); // ensures fresh data from primary

//     // Step 2: Build base historyMap with all statuses set to 0
//     const historyMap = {};
//     const defaultStatuses = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };

//     // Initialize for numbers found in DB
//     historyCountsRaw.forEach(item => {
//         const number = item?._id?.number;
//         const status = item?._id?.status;

//         // Always initialize with all default statuses
//         if (!historyMap[number]) {
//             historyMap[number] = { ...defaultStatuses };
//         }

//         // If Mongo returns an unknown status, add it dynamically
//         if (!(status in historyMap[number])) {
//             historyMap[number][status] = 0;
//         }

//         historyMap[number][status] = item.count;
//     });

//     // Ensure all requested numbers exist in historyMap
//     numbers.forEach(num => {
//         if (!historyMap[num]) {
//             historyMap[num] = { ...defaultStatuses };
//         }
//     });

//     // Step 3: Apply update if provided
//     if (updateQuery && updateData) {
//         await AppointmentModal.updateMany(updateQuery, updateData);

//         // Step 4: Adjust counts in-memory for instant feedback
//         const updatedStatus = updateData?.$set?.status;
//         if (updatedStatus) {
//             numbers.forEach(num => {
//                 if (!(updatedStatus in historyMap[num])) {
//                     historyMap[num][updatedStatus] = 0; // Add if missing
//                 }
//                 historyMap[num][updatedStatus] += 1;
//             });
//         }
//     }

//     return historyMap;
// };

// // ---------------------- SENTIMENT SCORE ----------------------
// const getSentimentScore = async (chatHistory, userSender = 'Consultant') => {
//     if (!Array.isArray(chatHistory)) return 0;

//     const userMessages = chatHistory
//         .filter(chat => chat.sender === userSender && chat.message.length > 0)
//         .map(chat => chat.message);

//     if (userMessages.length === 0) return 0;

//     let total = 0;
//     userMessages.forEach(msg => {
//         const result = sentiment.analyze(msg);
//         total += result.comparative;
//     });

//     const avg = total / userMessages.length;
//     const scaled = Math.max(0, Math.min(10, (avg + 1) * 5));

//     return parseFloat(scaled.toFixed(1));
// };

// // ---------------------- BEHAVIOUR SCORE ---------------------- 
// const getBehaviourScore = async (
//     { booked = 0, completed = 0, rescheduled = 0, cancelled = 0 },
//     userId,
//     numbers
// ) => {
//     if (!Array.isArray(numbers)) numbers = [numbers];
//     const MIN_APPOINTMENTS_FOR_FULL_CONFIDENCE = 5;
  
//     const latestData = await AppointmentModal.aggregate([
//         { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
//         { $sort: { createdAt: -1 } },
//         { $limit: 1 },
//         { $project: { _id: 0, rescheduleCount: 1 } }
//     ]).read("primary");
  
//     if (latestData.length > 0) {
//         rescheduled = latestData[0].rescheduleCount || rescheduled;
//     }

//     const total = booked + completed + rescheduled + cancelled || 1;
  
//     const rawScore =
//         (completed / total) * WEIGHTS.completed +
//         (rescheduled / total) * WEIGHTS.rescheduled +
//         (cancelled / total) * WEIGHTS.cancelled;
//     const confidenceFactor = Math.min(1, total / MIN_APPOINTMENTS_FOR_FULL_CONFIDENCE);
//     const adjustedScore = rawScore * confidenceFactor + (5 * (1 - confidenceFactor));
//     return parseFloat(Math.min(10, Math.max(0, adjustedScore.toFixed(1))));
// };
  
// // ---------------------- RESPONSE SPEED SCORE ----------------------
// const getResponseSpeedScore = async (chatHistory, aiSender = 'AI', userSender = 'Consultant') => {
//     let totalDelay = 0;
//     let count = 0;

//     for (let i = 0; i < chatHistory.length - 1; i++) {
//         const current = chatHistory[i];
//         const next = chatHistory[i + 1];

//         if (current.sender === aiSender && next.sender === userSender) {
//             const delayMs = new Date(next.timestamp) - new Date(current.timestamp);
//             if (delayMs > 0) {
//                 totalDelay += delayMs / 1000; 
//                 count++;
//             }
//         }
//     }

//     if (count === 0) return 0;

//     const avgDelaySec = totalDelay / count;

//     if (avgDelaySec <= 10) return 10;
//     if (avgDelaySec >= 60) return 0;
//     const score = 10 - (avgDelaySec - 10) / 5;

//     return parseFloat(Math.max(0, score.toFixed(1)));
// };

// // ---------------------- FINAL SCORE ----------------------
// const getFinalSentimentScore = async (chatHistory, numbers, userId) => {
//     if (!Array.isArray(numbers)) numbers = [numbers];

//     const normalizedChats = normalizeChatHistory(chatHistory);
//     const numArray = Array.isArray(numbers) ? numbers : [numbers];
//     const normalizedNumbers = numArray.map(normalizeNumber);

//     const historyCounts = await getHistoryCounts(numArray, userId);
//     const appointmentdata = await AppointmentModal.aggregate([
//         { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
//         { $sort: { createdAt: -1 } },
//         { $limit: 1 },
//         { $project: { _id: 0, rescheduleCount: 1 } }
//     ])
//       .read("primary")
//       .then(latestData => {
//             return count = latestData.length > 0 ? latestData[0] : 0;
//       })
//       .catch(err => {
//             console.error("Error:", err);
//     });
//     rescheduled = appointmentdata?.rescheduleCount;

//     const scoreMap = {};
//     for (let i = 0; i < numArray.length; i++) {
//         const originalNum = numArray[i];
//         const normNum = normalizedNumbers[i];

//         const relevantChats = normalizedChats.some(c => c.whatsAppNumber)
//             ? normalizedChats.filter(chat => normalizeNumber(chat.whatsAppNumber) === normNum)
//             : normalizedChats;

//         const sentimentScore = await getSentimentScore(relevantChats, 'Consultant') || 0;
//         const behaviourScore = await getBehaviourScore(historyCounts[originalNum] || {}, userId, numbers) || 0;
//         const speedScore = await getResponseSpeedScore(relevantChats, 'AI', 'Consultant') || 0;
//         const finalScore = parseFloat((sentimentScore * 0.4 + behaviourScore * 0.4 + speedScore * 0.2).toFixed(1)) || 0;

//         scoreMap[originalNum] = {
//             sentimentScore,
//             behaviourScore,
//             speedScore,
//             finalScore,
//         };
//     }

//     return scoreMap;
// };

// module.exports = {
//     getHistoryCounts,
//     getSentimentScore,
//     getBehaviourScore,
//     getResponseSpeedScore,
//     getFinalSentimentScore
// };

const Sentiment = require('sentiment');
const sentiment = new Sentiment();
const AppointmentModal = require('../models/AppointmentModal');
const WEIGHTS = { completed: 10, rescheduled: -1, cancelled: -5 };

const normalizeNumber = num => (num ? String(num).replace(/\D/g, '') : '');

const normalizeChatHistory = (chatHistory) => {
    if (!Array.isArray(chatHistory)) return [];
    return chatHistory.map(chat => ({
        ...chat,
        message: typeof chat.message === 'string'
            ? chat.message.trim()
            : (() => {
                try {
                    // Safety check: ensure chat.message exists before stringifying
                    return chat.message ? JSON.stringify(chat.message) : '';
                } catch {
                    return '';
                }
            })()
    }));
};

// ---------------------- GET HISTORY COUNTS ----------------------
const getHistoryCounts = async (numbers, userId, updateQuery = null, updateData = null) => {
    if (!Array.isArray(numbers)) numbers = [numbers];

    const historyCountsRaw = await AppointmentModal?.aggregate([
        { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
        {
            $group: {
                _id: { number: "$whatsAppNumber", status: "$status" },
                count: { $sum: 1 }
            }
        }
    ]).read("primary");

    const historyMap = {};
    const defaultStatuses = { completed: 0, cancelled: 0, rescheduled: 0, booked: 0 };

    historyCountsRaw.forEach(item => {
        const number = item?._id?.number;
        const status = item?._id?.status;

        if (!historyMap[number]) {
            historyMap[number] = { ...defaultStatuses };
        }

        if (!(status in historyMap[number])) {
            historyMap[number][status] = 0;
        }

        historyMap[number][status] = item.count;
    });

    numbers.forEach(num => {
        if (!historyMap[num]) {
            historyMap[num] = { ...defaultStatuses };
        }
    });

    if (updateQuery && updateData) {
        await AppointmentModal.updateMany(updateQuery, updateData);
        const updatedStatus = updateData?.$set?.status;
        if (updatedStatus) {
            numbers.forEach(num => {
                if (!(updatedStatus in historyMap[num])) {
                    historyMap[num][updatedStatus] = 0;
                }
                historyMap[num][updatedStatus] += 1;
            });
        }
    }

    return historyMap;
};

// ---------------------- SENTIMENT SCORE ----------------------
const getSentimentScore = async (chatHistory, userSender = 'Consultant') => {
    if (!Array.isArray(chatHistory)) return 0;

    const userMessages = chatHistory
        .filter(chat => 
            chat && 
            chat.sender === userSender && 
            chat.message && // FIX: Check if message exists
            typeof chat.message === 'string' && // FIX: Check if it's a string
            chat.message.length > 0
        )
        .map(chat => chat.message);

    if (userMessages.length === 0) return 0;

    let total = 0;
    userMessages.forEach(msg => {
        const result = sentiment.analyze(msg);
        total += result.comparative;
    });

    const avg = total / userMessages.length;
    const scaled = Math.max(0, Math.min(10, (avg + 1) * 5));

    return parseFloat(scaled.toFixed(1));
};

// ---------------------- BEHAVIOUR SCORE ---------------------- 
const getBehaviourScore = async (
    { booked = 0, completed = 0, rescheduled = 0, cancelled = 0 },
    userId,
    numbers
) => {
    if (!Array.isArray(numbers)) numbers = [numbers];
    const MIN_APPOINTMENTS_FOR_FULL_CONFIDENCE = 5;
  
    const latestData = await AppointmentModal.aggregate([
        { $match: { user: userId, whatsAppNumber: { $in: numbers } } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        { $project: { _id: 0, rescheduleCount: 1 } }
    ]).read("primary");
  
    let currentRescheduleCount = rescheduled;
    if (latestData && latestData.length > 0) {
        currentRescheduleCount = latestData[0].rescheduleCount || rescheduled;
    }

    const total = booked + completed + currentRescheduleCount + cancelled || 1;
  
    const rawScore =
        (completed / total) * WEIGHTS.completed +
        (currentRescheduleCount / total) * WEIGHTS.rescheduled +
        (cancelled / total) * WEIGHTS.cancelled;
        
    const confidenceFactor = Math.min(1, total / MIN_APPOINTMENTS_FOR_FULL_CONFIDENCE);
    const adjustedScore = rawScore * confidenceFactor + (5 * (1 - confidenceFactor));
    return parseFloat(Math.min(10, Math.max(0, adjustedScore.toFixed(1))));
};
  
// ---------------------- RESPONSE SPEED SCORE ----------------------
const getResponseSpeedScore = async (chatHistory, aiSender = 'AI', userSender = 'Consultant') => {
    if (!Array.isArray(chatHistory)) return 0;
    
    let totalDelay = 0;
    let count = 0;

    for (let i = 0; i < chatHistory.length - 1; i++) {
        const current = chatHistory[i];
        const next = chatHistory[i + 1];

        if (current.sender === aiSender && next.sender === userSender && current.timestamp && next.timestamp) {
            const delayMs = new Date(next.timestamp) - new Date(current.timestamp);
            if (!isNaN(delayMs) && delayMs > 0) {
                totalDelay += delayMs / 1000; 
                count++;
            }
        }
    }

    if (count === 0) return 0;

    const avgDelaySec = totalDelay / count;
    if (avgDelaySec <= 10) return 10;
    if (avgDelaySec >= 60) return 0;
    const score = 10 - (avgDelaySec - 10) / 5;

    return parseFloat(Math.max(0, score.toFixed(1)));
};

// ---------------------- FINAL SCORE ----------------------
const getFinalSentimentScore = async (chatHistory, numbers, userId) => {
    const numArray = Array.isArray(numbers) ? numbers : [numbers];
    const normalizedChats = normalizeChatHistory(chatHistory);
    const normalizedNumbers = numArray.map(normalizeNumber);

    const historyCounts = await getHistoryCounts(numArray, userId);
    
    // FIX: Simplified the aggregation logic to use await and handled undefined properly
    let latestRescheduleCount = 0;
    try {
        const appointmentData = await AppointmentModal.aggregate([
            { $match: { user: userId, whatsAppNumber: { $in: numArray } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, rescheduleCount: 1 } }
        ]).read("primary");
        
        if (appointmentData && appointmentData.length > 0) {
            latestRescheduleCount = appointmentData[0].rescheduleCount || 0;
        }
    } catch (err) {
        console.error("Aggregation Error:", err);
    }

    const scoreMap = {};
    for (let i = 0; i < numArray.length; i++) {
        const originalNum = numArray[i];
        const normNum = normalizedNumbers[i];

        const relevantChats = normalizedChats.some(c => c.whatsAppNumber)
            ? normalizedChats.filter(chat => normalizeNumber(chat.whatsAppNumber) === normNum)
            : normalizedChats;

        const sentimentScore = await getSentimentScore(relevantChats, 'Consultant') || 0;
        const behaviourScore = await getBehaviourScore(historyCounts[originalNum] || {}, userId, numArray) || 0;
        const speedScore = await getResponseSpeedScore(relevantChats, 'AI', 'Consultant') || 0;
        
        const finalScore = parseFloat((sentimentScore * 0.4 + behaviourScore * 0.4 + speedScore * 0.2).toFixed(1)) || 0;

        scoreMap[originalNum] = {
            sentimentScore,
            behaviourScore,
            speedScore,
            finalScore,
        };
    }

    return scoreMap;
};

module.exports = {
    getHistoryCounts,
    getSentimentScore,
    getBehaviourScore,
    getResponseSpeedScore,
    getFinalSentimentScore
};