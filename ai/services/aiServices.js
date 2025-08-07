// const NodeCache = require('node-cache');
// const { Mutex } = require('async-mutex');
// const AppointmentModal = require('../../models/AppointmentModal');
// const generateDynamicPrompt = require('../../ai/training/preprocess');
// const { generateAIResponse, clearUserTracking } = require('../model/aiModel');
// const {
//     cleanAIResponse,
//     extractJsonFromResponse,
//     safeParseOptions,
//     parseChatHistory,
// } = require('../../utils/common');
// const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');

// const userConversationHistories = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// const userLocks = new Map();

// const getUserMutex = (userPhone) => {
//     if (!userLocks.has(userPhone)) {
//         userLocks.set(userPhone, new Mutex());
//     }
//     return userLocks.get(userPhone);
// };

// const updateConversationHistory = (userPhone, prompt, aiResponse) => {
//     const session = userConversationHistories.get(userPhone) || { conversation: [] };
//     const newTurn = [`Consultant: ${prompt}`, `AI: ${aiResponse}`];
//     session.conversation.push(...newTurn);
//     userConversationHistories.set(userPhone, session);
// };

// const clearUserSessionData = async (userPhone) => {
//     userConversationHistories.del(userPhone);
//     clearUserTracking(userPhone);
// };

// const createAIResponse = async (chatData) => {
//     let {
//         userPhone,
//         userInput: prompt,
//         userOption,
//         userId,
//         profileName
//     } = chatData;

//     const mutex = getUserMutex(userPhone);

//     if (!userPhone || !userId) {
//         return { message: 'Invalid user data provided.' };
//     }

//     return await mutex.runExclusive(async () => {
//         try {
//             const isStartingWithP = typeof userOption === 'string' && userOption?.startsWith('P-');
//             let userPrompt = userOption && isStartingWithP ? userOption : prompt;

//             const resetUserInput = () => {
//                 userPrompt = null;
//                 userOption = null;
//             };

//             let existingAppointment;
//             try {
//                 existingAppointment = await AppointmentModal.findOne({
//                     whatsAppNumber: userPhone,
//                     status: { $in: ['rescheduled', 'booked'] }
//                 }).lean();
//             } catch (err) {
//                 console.error('DB Read Error:', err);
//                 return { message: '🙁🛑 Error checking your appointment. Please try again.' };
//             }

//             let session = userConversationHistories.get(userPhone) || {
//                 conversation: [],
//                 selectedFlowId: null,
//                 userOptionsShown: false,
//                 existingUserData: null,
//                 awaitingRescheduleOrCancel: false,
//                 userHandledExistingAppointmentOption: false,
//             };

//             if (session.userOptionsShown && userOption) {
//                 session.userOptionsShown = false;
//                 userConversationHistories.set(userPhone, session);
//             }

//             if (userOption === 'cancel') {
//                 try {
//                     await AppointmentModal.updateOne(
//                         { whatsAppNumber: userPhone, status: { $in: ['rescheduled', 'booked'] } },
//                         { $set: { status: 'cancelled' } }
//                     );
//                     await clearUserSessionData(userPhone);
//                     return { message: '👍😃 Your appointment has been cancelled successfully.' };
//                 } catch (err) {
//                     console.error('Cancel Error:', err);
//                     return { message: '😔🚫 Failed to cancel your appointment. Please try again later.' };
//                 }
//             }

//             if (userOption === 'reschedule') {
//                 session.selectedFlowId = session.existingUserData?.flowId || null;
//                 session.conversation = [];
//                 session.awaitingRescheduleOrCancel = false;
//                 session.userHandledExistingAppointmentOption = true;
//                 userConversationHistories.set(userPhone, session);
//             }

//             if (
//                 existingAppointment &&
//                 !session.userHandledExistingAppointmentOption &&
//                 !['cancel', 'reschedule'].includes(userOption)
//             ) {
//                 session.existingUserData = existingAppointment;
//                 userConversationHistories.set(userPhone, session);
//                 return {
//                     optionsArray: {
//                         mainTitle: `🙌 Hi ${existingAppointment?.data?.name || 'there'}, welcome back again! You already have an appointment. Would you like to cancel ❌ or reschedule 🔄 it?`,
//                         items: [
//                             { _id: 'reschedule', title: 'Reschedule Appointment' },
//                             { _id: 'cancel', title: 'Cancel Appointment' },
//                         ],
//                     },
//                     isQuestion: true
//                 };
//             }

//             if (!session.selectedFlowId && !userOption) {
//                 let flows = [];
//                 try {
//                     flows = await ChatBotModel.find({ user: userId, status: true }, '_id title').limit(5).lean();
//                 } catch (err) {
//                     console.error('Flow fetch error:', err);
//                     return { message: '😔❌ Could not fetch available appointment flows.' };
//                 }

//                 if (flows.length > 1) {
//                     session.userOptionsShown = true;
//                     userConversationHistories.set(userPhone, session);
//                     return {
//                         optionsArray: {
//                             mainTitle: '👉 Pick an option to book your appointment.',
//                             items: flows.map(({ _id, title }) => ({ _id, title })),
//                         },
//                         isQuestion: true
//                     };
//                 } else if (flows.length === 1) {
//                     session.selectedFlowId = flows[0]._id;
//                 } else {
//                     return { message: '😐🔍 No appointment is currently available for your profile.' };
//                 }
//             }

//             if (!existingAppointment && userOption && !session.selectedFlowId) {
//                 session.selectedFlowId = userOption;
//             }

//             userConversationHistories.set(userPhone, session, 300);

//             let flowTrainingData;
//             try {
//                 flowTrainingData = await ChatBotModel.findOne(
//                     { _id: session.selectedFlowId, user: userId, status: true },
//                     'edges nodes title'
//                 ).lean();
//             } catch (err) {
//                 console.error('Training flow load error:', err);
//                 return { message: "😢📅 I'm sorry, but I'm unable to show Booking." };
//             }

//             if (!flowTrainingData && !userPrompt) {
//                 await clearUserSessionData(userPhone);
//                 return { message: `😔📅 I'm sorry, but I'm unable to ${existingAppointment ? 'reschedule' : 'Book'} your appointment at the moment. Please try again later or contact us for assistance.` };
//             }

//             const generatedPrompt = await generateDynamicPrompt(session.conversation, userPrompt, flowTrainingData);
//             const aiResponse = await generateAIResponse(generatedPrompt, userPhone);
//             const options = safeParseOptions(aiResponse);

//             updateConversationHistory(userPhone, userPrompt, aiResponse);
//             session = userConversationHistories.get(userPhone);
//             const extractJsonFromResp = extractJsonFromResponse(aiResponse);
//             const cleanAIResp = cleanAIResponse(aiResponse);
            
//             if (Array.isArray(options) && options.length > 0) {
//                 const [{ id: firstId, value: mainTitle }, ...rest] = options;
//                 return {
//                     optionsArray: {
//                         mainTitle,
//                         items: rest.map(({ id, value }) => ({ _id: id, title: value })),
//                     },
//                     isQuestion: true
//                 };
//             }
//             console.log(parseChatHistory(session.conversation),'histo')
//             if (extractJsonFromResp) {
//                 const appointmentData =
//                     typeof extractJsonFromResp === 'string'
//                         ? JSON.parse(extractJsonFromResp)
//                         : extractJsonFromResp;

//                 try {
//                     if (existingAppointment) {
//                         await AppointmentModal.updateOne(
//                             {
//                                 whatsAppNumber: userPhone,
//                                 status: { $ne: 'cancelled' }
//                             },
//                             {
//                                 $set: {
//                                     data: appointmentData,
//                                     status: 'rescheduled',
//                                     flowId: session.selectedFlowId,
//                                     history: parseChatHistory(session.conversation),
//                                 },
//                             }
//                         );
//                     } else {
//                         await AppointmentModal.create({
//                             user: userId,
//                             flowTitle: flowTrainingData?.title || 'Unknown appointment',
//                             whatsAppNumber: userPhone,
//                             flowId: session.selectedFlowId,
//                             status: 'booked',
//                             profileName,
//                             data: appointmentData,
//                             history: parseChatHistory(session.conversation),
//                         });
//                     }
//                     await clearUserSessionData(userPhone);
//                     resetUserInput();
//                 } catch (err) {
//                     console.error('Save/Update appointment error:', err);
//                     return { message: '😢🔄 Could not save your appointment. Please try again later.' };
//                 }
//             }

//             return { message: cleanAIResp };
//         } catch (error) {
//             console.error('AI Processing Error:', error);
//             return { message: '😊 All my AI buddies are a bit tied up right now. Please hang tight!' };
//         }
//     });
// };

// module.exports = createAIResponse;

const NodeCache = require('node-cache');
const { Mutex } = require('async-mutex');
const AppointmentModal = require('../../models/AppointmentModal');
const generateDynamicPrompt = require('../../ai/training/preprocess');
const { generateAIResponse, clearUserTracking } = require('../model/aiModel');
const {
    cleanAIResponse,
    extractJsonFromResponse,
    safeParseOptions,
    parseChatHistory,
} = require('../../utils/common');
const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');

const userConversationHistories = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const userLocks = new Map();

const getUserMutex = (userPhone) => {
    if (!userLocks.has(userPhone)) {
        userLocks.set(userPhone, new Mutex());
    }
    return userLocks.get(userPhone);
};

const updateConversationHistory = (userPhone, prompt, aiResponse) => {
    const session = userConversationHistories.get(userPhone) || { conversation: [] };
    const now = new Date();

    const newTurn = [
        { sender: 'Consultant', message: prompt, timestamp: now },
        { sender: 'AI', message: aiResponse, timestamp: new Date() }
    ];

    session.conversation.push(...newTurn);
    userConversationHistories.set(userPhone, session);
};

const clearUserSessionData = async (userPhone) => {
    userConversationHistories.del(userPhone);
    clearUserTracking(userPhone);
};

const createAIResponse = async (chatData) => {
    let {
        userPhone,
        userInput: prompt,
        userOption,
        userId,
        profileName
    } = chatData;

    const mutex = getUserMutex(userPhone);

    if (!userPhone || !userId) {
        return { message: 'Invalid user data provided.' };
    }

    return await mutex.runExclusive(async () => {
        try {
            const isStartingWithP = typeof userOption === 'string' && userOption?.startsWith('P-');
            let userPrompt = userOption && isStartingWithP ? userOption : prompt;

            const resetUserInput = () => {
                userPrompt = null;
                userOption = null;
            };

            let existingAppointment;
            try {
                existingAppointment = await AppointmentModal.findOne({
                    whatsAppNumber: userPhone,
                    status: { $in: ['rescheduled', 'booked'] }
                }).lean();
            } catch (err) {
                console.error('DB Read Error:', err);
                return { message: '🙁🛑 Error checking your appointment. Please try again.' };
            }

            let session = userConversationHistories.get(userPhone) || {
                conversation: [],
                selectedFlowId: null,
                userOptionsShown: false,
                existingUserData: null,
                awaitingRescheduleOrCancel: false,
                userHandledExistingAppointmentOption: false,
            };

            if (session.userOptionsShown && userOption) {
                session.userOptionsShown = false;
                userConversationHistories.set(userPhone, session);
            }

            if (userOption === 'cancel') {
                try {
                    await AppointmentModal.updateOne(
                        { whatsAppNumber: userPhone, status: { $in: ['rescheduled', 'booked'] } },
                        { $set: { status: 'cancelled' } }
                    );
                    await clearUserSessionData(userPhone);
                    return { message: '👍😃 Your appointment has been cancelled successfully.' };
                } catch (err) {
                    console.error('Cancel Error:', err);
                    return { message: '😔🚫 Failed to cancel your appointment. Please try again later.' };
                }
            }

            if (userOption === 'reschedule') {
                session.selectedFlowId = session.existingUserData?.flowId || null;
                session.conversation = [];
                session.awaitingRescheduleOrCancel = false;
                session.userHandledExistingAppointmentOption = true;
                userConversationHistories.set(userPhone, session);
            }

            if (
                existingAppointment &&
                !session.userHandledExistingAppointmentOption &&
                !['cancel', 'reschedule'].includes(userOption)
            ) {
                session.existingUserData = existingAppointment;
                userConversationHistories.set(userPhone, session);
                return {
                    optionsArray: {
                        mainTitle: `🙌 Hi ${existingAppointment?.data?.name || 'there'}, welcome back again! You already have an appointment. Would you like to cancel ❌ or reschedule 🔄 it?`,
                        items: [
                            { _id: 'reschedule', title: 'Reschedule Appointment' },
                            { _id: 'cancel', title: 'Cancel Appointment' },
                        ],
                    },
                    isQuestion: true
                };
            }

            if (!session.selectedFlowId && !userOption) {
                let flows = [];
                try {
                    flows = await ChatBotModel.find({ user: userId, status: true }, '_id title').limit(5).lean();
                } catch (err) {
                    console.error('Flow fetch error:', err);
                    return { message: '😔❌ Could not fetch available appointment flows.' };
                }

                if (flows.length > 1) {
                    session.userOptionsShown = true;
                    userConversationHistories.set(userPhone, session);
                    return {
                        optionsArray: {
                            mainTitle: '👉 Pick an option to book your appointment.',
                            items: flows.map(({ _id, title }) => ({ _id, title })),
                        },
                        isQuestion: true
                    };
                } else if (flows.length === 1) {
                    session.selectedFlowId = flows[0]._id;
                } else {
                    return { message: '😐🔍 No appointment is currently available for your profile.' };
                }
            }

            if (!existingAppointment && userOption && !session.selectedFlowId) {
                session.selectedFlowId = userOption;
            }

            userConversationHistories.set(userPhone, session, 300);

            let flowTrainingData;
            try {
                flowTrainingData = await ChatBotModel.findOne(
                    { _id: session.selectedFlowId, user: userId, status: true },
                    'edges nodes title'
                ).lean();
            } catch (err) {
                console.error('Training flow load error:', err);
                return { message: "😢📅 I'm sorry, but I'm unable to show Booking." };
            }

            if (!flowTrainingData && !userPrompt) {
                await clearUserSessionData(userPhone);
                return { message: `😔📅 I'm sorry, but I'm unable to ${existingAppointment ? 'reschedule' : 'Book'} your appointment at the moment. Please try again later or contact us for assistance.` };
            }

            const conversationText = session.conversation.map(c => `${c.sender}: ${c.message}`);
            const generatedPrompt = await generateDynamicPrompt(conversationText, userPrompt, flowTrainingData);
            const aiResponse = await generateAIResponse(generatedPrompt, userPhone);
            const options = safeParseOptions(aiResponse);

            updateConversationHistory(userPhone, userPrompt, aiResponse);
            session = userConversationHistories.get(userPhone);
            const extractJsonFromResp = extractJsonFromResponse(aiResponse);
            const cleanAIResp = cleanAIResponse(aiResponse);

            if (Array.isArray(options) && options.length > 0) {
                const [{ id: firstId, value: mainTitle }, ...rest] = options;
                return {
                    optionsArray: {
                        mainTitle,
                        items: rest.map(({ id, value }) => ({ _id: id, title: value })),
                    },
                    isQuestion: true
                };
            }

            console.log(parseChatHistory(session.conversation), 'histo');

            if (extractJsonFromResp) {
                const appointmentData =
                    typeof extractJsonFromResp === 'string'
                        ? JSON.parse(extractJsonFromResp)
                        : extractJsonFromResp;

                try {
                    if (existingAppointment) {
                        await AppointmentModal.updateOne(
                            {
                                whatsAppNumber: userPhone,
                                status: { $ne: 'cancelled' }
                            },
                            {
                                $set: {
                                    data: appointmentData,
                                    status: 'rescheduled',
                                    flowId: session.selectedFlowId,
                                    history: parseChatHistory(session.conversation),
                                },
                            }
                        );
                    } else {
                        await AppointmentModal.create({
                            user: userId,
                            flowTitle: flowTrainingData?.title || 'Unknown appointment',
                            whatsAppNumber: userPhone,
                            flowId: session.selectedFlowId,
                            status: 'booked',
                            profileName,
                            data: appointmentData,
                            history: parseChatHistory(session.conversation),
                        });
                    }
                    await clearUserSessionData(userPhone);
                    resetUserInput();
                } catch (err) {
                    console.error('Save/Update appointment error:', err);
                    return { message: '😢🔄 Could not save your appointment. Please try again later.' };
                }
            }

            return { message: cleanAIResp };
        } catch (error) {
            console.error('AI Processing Error:', error);
            return { message: '😊 All my AI buddies are a bit tied up right now. Please hang tight!' };
        }
    });
};

module.exports = createAIResponse;







