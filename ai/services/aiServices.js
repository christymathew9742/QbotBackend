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
    fillMissingSentimentFields,
    onWebhookEvent,
} = require('../../utils/common');
const { getFinalSentimentScore } = require('../../utils/sentimentScore');
const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const User = require('../../models/User');
const { default: mongoose } = require('mongoose');
const { createNotification } = require('../../controllers/notificationController');
const { sendToUser } = require('../../utils/notifications');
const { bookSlot } = require('./googleCalendar');

const userConversationHistories = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const userLocks = new Map();

const getUserMutex = (userPhone) => {
    if (!userLocks.has(userPhone)) {
        userLocks.set(userPhone, new Mutex());
    }
    return userLocks.get(userPhone);
};

const averageSentimentScores = arr => {
    if (!arr?.length) return null;
    const totals = {};
    
    arr.forEach(item => {
        Object.entries(item).forEach(([key, value]) => {
            if (typeof value === 'number') {
                totals[key] = (totals[key] || 0) + value;
            }
        });
    });
    
    const averaged = {};
    Object.keys(totals).forEach(key => {
        averaged[key] = parseFloat((totals[key] / arr.length).toFixed(1));
    });
    
    return averaged;
};
  
const updateConversationHistory = (userPhone, prompt, aiResponse) => {
    const session = userConversationHistories.get(userPhone) || { conversation: [] };

    const newTurn = [
        { sender: 'Consultant', message: prompt, timestamp: new Date()},
        { sender: 'AI', message: aiResponse, timestamp: new Date()}
    ];

    session.conversation.push(...newTurn);
    userConversationHistories.set(userPhone, session);
};

const clearUserSessionData = async (userPhone = "") => {
    try {
        if (userConversationHistories) {
            if (typeof userConversationHistories.del === "function") {
                userConversationHistories.del(userPhone);
            } else if (typeof userConversationHistories.delete === "function") {
                userConversationHistories.delete(userPhone);
            }
        }
        clearUserTracking?.(userPhone);

    } catch (err) {
        console.error("❌ Failed to clear session:", err.message);
    }
};

const createAIResponse = async (chatData) => {
    let {
        userPhone,
        userInput: prompt,
        userOption,
        userId,
        profileName,
        whatsTimestamp,
    } = chatData;

    const mutex = getUserMutex(userPhone);

    if (!userPhone || !userId) {
        return { message: 'Invalid user data provided.' };
    }

    const resetUserInput = () => {
        userPrompt = null;
        userOption = null;
    };

    const date = new Date(whatsTimestamp * 1000);
    const userRespondTime = date.toISOString().replace('Z', '+00:00');
    const isPotentialFlowId = mongoose.Types.ObjectId.isValid(userOption);

    onWebhookEvent(userRespondTime, userPhone, userId);

    return await mutex.runExclusive(async () => {
        try {
            const isUserOption = typeof userOption === 'string' && userOption?.startsWith('P-');
            let userPrompt = userOption && isUserOption ? userOption : prompt;

            let existingAppointment;
            try {
                existingAppointment = await AppointmentModal.findOne({
                    whatsAppNumber: userPhone,
                    user: userId,
                    status: { $in: ['rescheduled', 'booked'] }
                }).lean();
            } catch (err) {
                console.error('DB Read Error:', err);
                return { message: '🙁🛑 Error checking your appointment. Please try again.' };
            }

            const messagePrefix = `Hi ${existingAppointment?.data?.name || profileName || 'there'}`
      
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

            if (userOption === "cancel") {
                try {
                    const result = await AppointmentModal.updateOne (
                        {
                            whatsAppNumber: userPhone,
                            _id: existingAppointment?._id,
                            user: userId,
                            status:  { $nin: ['cancelled', 'completed'] },
                        },
                        { 
                            $set: { 
                                status: "cancelled" ,
                                lastUpdatedAt: new Date().toISOString(),
                            } 
                        }
                    );

                    await User.findOneAndUpdate (
                        { whatsAppNumber: userPhone },
                        {
                            $set: {
                                status: "cancelled",
                                lastUpdatedAt: new Date().toISOString(),
                            },
                        },
                        { new: true, upsert: true }
                    );
                
                    if (result.modifiedCount > 0) {
                        await createNotification ({
                            userId,
                            type: "cancelled",
                            whatsAppNumber: userPhone,
                            chatBotTitle: existingAppointment?.flowTitle,
                            profileName,
                            appointmentId: existingAppointment?._id,
                        });
                        sendToUser({
                            userId,
                            type: 'CANCELLED_NOTIFICATION',
                            status: 'cancelled',
                        });
                        await clearUserSessionData(userPhone);

                        return { message: `${messagePrefix}, 👍Your appointment has been cancelled successfully.` };
                    } else {
                        return { message: `ℹ️ ${messagePrefix}, No active appointment found to cancel.` };
                    }
                } catch (err) {
                    console.error("Cancel Error:", err);
                    await  clearUserSessionData(userPhone);
                    resetUserInput();
                    return { message: `😔 ${messagePrefix}, Failed to cancel your appointment. Please try again later.` };
                }
            }
              
            if (userOption === 'reschedule') {
                session.selectedFlowId = session.existingUserData?.flowId || existingAppointment?.flowId || null
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
                        mainTitle: `🙌 ${messagePrefix}, welcome back again! You already have an appointment. Would you like to cancel ❌ or reschedule 🔄 it?`,
                        type:'list',
                        resp: [
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
                    await clearUserSessionData(userPhone);
                    resetUserInput();
                    return { message: `😔 Sorry ${profileName}, Could not fetch available appointment flows.` };
                }

                if (flows.length > 1) {
                    session.userOptionsShown = true;
                    userConversationHistories.set(userPhone, session);
                    return {
                        optionsArray: {
                            mainTitle: '👉 Pick an option to book your appointment.',
                            type:'list',
                            resp: flows.map(({ _id, title }) => ({ _id, title })),
                        },
                        isQuestion: true
                    };
                } else if (flows.length === 1) {
                    session.selectedFlowId = flows[0]._id;
                } else {
                    return { message: `Hi ${profileName}, No appointment is currently available for your profile.` };
                }
            }

            if (!existingAppointment && !session.selectedFlowId && isPotentialFlowId) {
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
                return { message: `😢📅 I'm sorry ${profileName}, but I'm unable to show Booking.` };
            }

            if (!flowTrainingData && !userPrompt) {
                await clearUserSessionData(userPhone);
                return { message: `😔📅 I'm sorry ${profileName}, but I'm unable to ${existingAppointment ? 'reschedule' : 'Book'} your appointment at the moment. Please try again later or contact us for assistance.` };
            }

            const conversationText = session.conversation.map(c => `${c.sender}: ${c.message}`);
            const generatedPrompt = await generateDynamicPrompt(conversationText, userPrompt, flowTrainingData);
            let aiResponse = await generateAIResponse(generatedPrompt, userPhone, clearUserSessionData, resetUserInput);
            const options = safeParseOptions(aiResponse, aiResponse?.slot);
            updateConversationHistory(userPhone, userPrompt, aiResponse);
            session = userConversationHistories.get(userPhone);
            const extractJsonFromResp = extractJsonFromResponse(aiResponse);
            const cleanAIResp = cleanAIResponse(aiResponse);
            const messageParts = cleanAIResp?.split(',').map(p => p.trim()).filter(Boolean) || [];
            console.log(userOption,'userOption')

            if (Array.isArray(options) && options.length > 0) {
                const [{ id: firstId, value: mainTitle, type }, ...rest] = options;
                return {
                    optionsArray: {
                        mainTitle,
                        type: type.toLowerCase(),
                        resp: rest.map(({ id, value }) => ({ _id: id, title: value })),
                    },
                    isQuestion: true
                };
            }
 
            if(!cleanAIResp) {
                await clearUserSessionData(userPhone);
                resetUserInput();
            }

            const averageSentimentScoresSafe = (scoresArray = []) =>
                fillMissingSentimentFields(averageSentimentScores(scoresArray));
            console.log(extractJsonFromResp,'extractJsonFromResp')
            try {
                if (extractJsonFromResp) {
                    const history = parseChatHistory(session.conversation);
                    const sentimentScores = await getFinalSentimentScore(history, userPhone, userId);
                    const currentScores = fillMissingSentimentFields(sentimentScores[userPhone] || {});
                    const appointmentUid = new mongoose.Types.ObjectId();
            
                    let appointmentData = typeof extractJsonFromResp === 'string'
                        ? JSON.parse(extractJsonFromResp)
                        : extractJsonFromResp;
                    console.log(appointmentData,'appointmentData')
                   if (
                        !appointmentData ||
                        (typeof appointmentData === 'string' && appointmentData.trim() === '') ||
                        (Array.isArray(appointmentData) && appointmentData.length === 0) ||
                        (typeof appointmentData === 'object' && !Array.isArray(appointmentData) && Object.keys(appointmentData).length === 0)
                    ) {
                        console.log('No appointment data to save.');
                        return;
                    }
            
                    let firstUserCreated = userRespondTime;
            
                    if (existingAppointment) {
                        firstUserCreated = existingAppointment?.userCreated || userRespondTime;
                        await createNotification ({
                            userId,
                            type: "rescheduled",
                            whatsAppNumber: userPhone,
                            chatBotTitle: existingAppointment?.flowTitle,
                            profileName,
                            appointmentId: existingAppointment?._id,
                        });
                        sendToUser ({
                            userId,
                            type: 'RESHEDULED_NOTIFICATION',
                            status: 'rescheduled',
                        });
                    } else {
                        const firstAppointment = await AppointmentModal.findOne ({
                            whatsAppNumber: userPhone,
                            user: userId
                        }).sort({ createdAt: 1 }).lean();
            
                        if (firstAppointment?.userCreated) {
                            firstUserCreated = firstAppointment.userCreated;
                        }
                        await createNotification ({
                            userId,
                            type: "booked",
                            whatsAppNumber: userPhone,
                            chatBotTitle: flowTrainingData?.title || "No name",
                            profileName,
                            appointmentId: appointmentUid,
                        });
                        sendToUser ({
                            userId,
                            type: 'BOOKED_NOTIFICATION',
                            status: 'booked',
                        });
                    }
            
                    const rescheduleCount = existingAppointment?.__v || 0;
                    const sentimentHistory = existingAppointment
                    ? [
                        ...(existingAppointment.sentimentScoresHistory || []).map(fillMissingSentimentFields),
                        currentScores,
                    ]
                    : [currentScores];

                    const userRef = await User.findOneAndUpdate(
                        {
                            whatsAppNumber: userPhone,
                            user: userId 
                        },
                        {
                            $setOnInsert: {
                                source: "whatsapp",
                                user: userId,
                                flowId: session.selectedFlowId || "",
                                profileName,
                                userCreated: firstUserCreated,
                            },
                            $set: {
                                status: existingAppointment ? "rescheduled" : "booked",
                                sentimentScores: averageSentimentScoresSafe(sentimentHistory),
                                rescheduleCount,
                                lastActiveAt: userRespondTime,
                                flowTitle: flowTrainingData?.title || existingAppointment?.flowTitle,
                                lastUpdatedAt: new Date().toISOString(),
                            },
                            $inc: { __v: 1 },
                            $push: {
                                sentimentScoresHistory: { $each: [currentScores], $position: 0 }
                            }
                        },
                        {
                            new: true,
                            upsert: true,
                            setDefaultsOnInsert: true,
                        }
                    );
                    console.log(appointmentData,'appointmentData before save or update')
                    await AppointmentModal.findOneAndUpdate (
                        {
                            _id: existingAppointment?._id || appointmentUid, 
                        },
                        {
                            $setOnInsert: {
                                whatsAppUser: userRef?._id,
                                user: userId,
                                flowId: session.selectedFlowId || "",
                                flowTitle: flowTrainingData?.title || "No name",
                                whatsAppNumber: userPhone,
                                profileName,
                                userCreated: firstUserCreated,
                            },
                            $set: {
                                data: appointmentData || {},
                                history,
                                rescheduleCount,
                                status: existingAppointment ? "rescheduled" : "booked",
                                sentimentScores: averageSentimentScoresSafe(sentimentHistory),
                                lastActiveAt: userRespondTime,
                                lastUpdatedAt: new Date().toISOString(),
                            },
                            $inc: { __v: 1 },
                            $push: {
                                sentimentScoresHistory: { $each: [currentScores], $position: 0 }
                            }
                        },
                        { new: true, upsert: true }
                    );
        
                    await clearUserSessionData(userPhone);
                    resetUserInput();
                    return  { message: !cleanAIResp? `Thank you ${profileName}, your appointment is successfully completed. Have a wonderful day! 😊` : cleanAIResp  };
                }
            
            } catch (err) {
                console.error('Save/Update error:', err);
                await clearUserSessionData(userPhone);
                resetUserInput();
                return {
                    message: `😔 Sorry ${profileName} , I couldn’t save your appointment  Let’s try again in a bit`
                };
            }

            if (messageParts.length) {
                return { message: messageParts, FlowId: session.selectedFlowId };
            }

            return { message: cleanAIResp };

        } catch (error) {
            console.error('AI Processing Error:', error);
            await clearUserSessionData(userPhone);
            resetUserInput();
            return { message: '😊 All my AI buddies are a bit tied up right now. Please hang tight!' };
        }
    });
};

module.exports = createAIResponse;


