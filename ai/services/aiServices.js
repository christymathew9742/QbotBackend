const NodeCache = require('node-cache');
const { Mutex } = require('async-mutex');
const Sentiment = require('sentiment');
const { v4: uuidv4 } = require("uuid");
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
const { notifyAppointmentCreated, notifyAppointmentUpdated } = require('../../utils/notifications');

const userConversationHistories = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const userLocks = new Map();
const newDate = new Date(); 

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
    const timestamp = newDate;

    const newTurn = [
        { sender: 'Consultant', message: prompt, timestamp },
        { sender: 'AI', message: aiResponse, timestamp}
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
        profileName,
        whatsTimestamp,
    } = chatData;

    const mutex = getUserMutex(userPhone);

    if (!userPhone || !userId) {
        return { message: 'Invalid user data provided.' };
    }

    onWebhookEvent(whatsTimestamp, userPhone, userId);

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
                    user: userId,
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
                                lastUpdatedAt: newDate.toISOString(),
                            } 
                        }
                    );

                   
                    notifyAppointmentUpdated({  
                        ...existingAppointment || {}, 
                        status: 'cancelled',  
                        lastUpdatedAt: newDate.toISOString(),
                    });
                
                    if (result.modifiedCount > 0) {
                        await clearUserSessionData(userPhone);
                        return { message: "👍😃 Your appointment has been cancelled successfully." };
                    } else {
                        return { message: "ℹ️ No active appointment found to cancel." };
                    }
                } catch (err) {
                    console.error("Cancel Error:", err);
                    return { message: "😔🚫 Failed to cancel your appointment. Please try again later." };
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

            const averageSentimentScoresSafe = (scoresArray = []) =>
                fillMissingSentimentFields(averageSentimentScores(scoresArray));

            if (extractJsonFromResp) {
                const history = parseChatHistory(session.conversation);
                const sentimentScores = await getFinalSentimentScore(history, userPhone, userId);
                const currentScores = fillMissingSentimentFields(sentimentScores[userPhone] || {});
                const notifyId = uuidv4();
            
                let appointmentData = typeof extractJsonFromResp === 'string'
                    ? JSON.parse(extractJsonFromResp)
                    : extractJsonFromResp;
            
                const date = new Date(whatsTimestamp * 1000);
                const isoStringWithOffset = date.toISOString().replace('Z', '+00:00');
            
                try {
                    let firstUserCreated = isoStringWithOffset;
                    if (existingAppointment) {
                        firstUserCreated = existingAppointment.userCreated || isoStringWithOffset;
                    } else {
                        const firstAppointment = await AppointmentModal.findOne({ whatsAppNumber: userPhone, user: userId})
                            .sort({ createdAt: 1 })
                            .lean();
                        if (firstAppointment?.userCreated) {
                            firstUserCreated = firstAppointment.userCreated;
                        }
                    }
            
                    if (existingAppointment) {
                        const newRescheduleCount = (existingAppointment.rescheduleCount || 0) + 1;
                        const sentimentHistory = [
                            ...(existingAppointment.sentimentScoresHistory || []).map(fillMissingSentimentFields),
                            currentScores
                        ];

                        await AppointmentModal.updateOne(
                            { 
                                whatsAppNumber: userPhone, 
                                user: userId, 
                                status:  { $nin: ['cancelled', 'completed'] },
                                _id: existingAppointment?._id
                            },
                            {
                                $set: {
                                    data: appointmentData || {},
                                    _id: existingAppointment?._id,
                                    status: 'rescheduled',
                                    flowId: session.selectedFlowId || '',
                                    history,
                                    sentimentScores: averageSentimentScoresSafe(sentimentHistory),
                                    rescheduleCount: newRescheduleCount,
                                    lastActiveAt: isoStringWithOffset,
                                    userCreated: firstUserCreated ,
                                    lastUpdatedAt: newDate.toISOString(),
                                },
                                $push: {
                                    sentimentScoresHistory: { $each: [currentScores], $position: 0 }
                                }
                            }
                        );
                        notifyAppointmentUpdated({ 
                            ...existingAppointment || {}, 
                            status: 'rescheduled', 
                            lastUpdatedAt: newDate.toISOString(), 
                        });

                    } else {
                        await AppointmentModal.create ({
                            user: userId,
                            notifyId,
                            flowTitle: flowTrainingData?.title || "No name",
                            whatsAppNumber: userPhone,
                            flowId: session.selectedFlowId || "",
                            status: "booked",
                            profileName,
                            data: { ...(appointmentData || {}) },
                            history: [...(history || [])],
                            sentimentScores: { ...currentScores },
                            sentimentScoresHistory: [{ ...currentScores }],
                            rescheduleCount: 0,
                            lastActiveAt: isoStringWithOffset,
                            userCreated: firstUserCreated,
                            lastUpdatedAt: newDate.toISOString()
                        });

                        notifyAppointmentCreated ({
                            user: userId,
                            notifyId,
                            flowTitle: flowTrainingData?.title || "No name",
                            whatsAppNumber: userPhone,
                            flowId: session.selectedFlowId || "",
                            status: "booked",
                            profileName,
                            data: { ...(appointmentData || {}) },
                            history: [...(history || [])],
                            sentimentScores: { ...currentScores },
                            sentimentScoresHistory: [{ ...currentScores }],
                            rescheduleCount: 0,
                            lastActiveAt: isoStringWithOffset,
                            userCreated: firstUserCreated,
                            lastUpdatedAt: newDate.toISOString()  
                        });
                    }
                    
                    await clearUserSessionData(userPhone);
                    resetUserInput();

                } catch (err) {
                    console.error('Save/Update appointment error:', err);
                    return {
                        message: '😔 Sorry, I couldn’t save your appointment 🔄 Let’s try again in a bit ⏳'
                    };
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







