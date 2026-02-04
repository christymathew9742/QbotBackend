const NodeCache = require('node-cache');
const { Mutex } = require('async-mutex');
const AppointmentModal = require('../../models/AppointmentModal');
const { generateDynamicPrompt, getFlowRequirements } = require('../../ai/training/preprocess');
const { generateAIResponse, clearUserTracking } = require('../model/aiModel');
const {
    cleanAIResponse,
    parseChatHistory,
    fillMissingSentimentFields,
    onWebhookEvent,
    generateRefID,
} = require('../../utils/common');
const {
    isAbusive,
    isEmojiOnly,
} = require('../../utils/validater');
const { getFinalSentimentScore } = require('../../utils/sentimentScore');
const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const User = require('../../models/User');
const { default: mongoose } = require('mongoose');
const { createNotification } = require('../../controllers/notificationController');
const { sendToUser } = require('../../utils/notifications');
const Slots = require('../../models/Slots');
const { generateDynamicFlowData } = require('../training/conversationFlowGenerator');
const { generateAndSendBookingSlip } = require('./bookingSlipGenerator');
const { 
    createBookingEvent, 
    deleteBookingEvent, 
    cleanupExpiredSlots 
} = require('../../services/googleCalendarService');

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
        averaged[key] = parseFloat((totals[key] / arr?.length).toFixed(1));
    });

    return averaged;
};

const updateConversationHistory = (userPhone, prompt, aiResponse) => {
    const session = userConversationHistories.get(userPhone) || { conversation: [] };

    const newTurn = [
        { sender: 'Consultant', message: prompt, timestamp: new Date() },
        { sender: 'AI', message: aiResponse, timestamp: new Date() }
    ];

    session.conversation.push(...newTurn);
    session.lastInteractionTime = new Date();
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
        autoSendBookingPdf, 
        generalWelcomeMessage,
        businessProfile,
        inactivityTimeoutMinutes,
        language,
        timezone,
    } = chatData;
console.log(chatData, 'chatDatachatDatachatDatachatData');
    //Remove expired slots before processing
    await cleanupExpiredSlots(); 

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
            let userPrompt = /^[a-f\d]{24}$/i.test(userOption) ? prompt : (userOption || prompt);
            let session = userConversationHistories.get(userPhone);

            if (session && session.lastInteractionTime) {
                const lastTime = new Date(session.lastInteractionTime).getTime();
                const currentTime = new Date().getTime();
                const diffMinutes = (currentTime - lastTime) / (1000 * 60);
                const timeoutLimit = Number(inactivityTimeoutMinutes) || 3;

                if (diffMinutes > timeoutLimit) {
                    console.log(`⏱️ Session timed out for ${userPhone}. Resetting flow.`);
                    await clearUserSessionData(userPhone);
                    session = undefined;
                }
            }

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

            session = session || {
                conversation: [],
                selectedFlowId: null,
                userOptionsShown: false,
                existingUserData: null,
                awaitingRescheduleOrCancel: false,
                userHandledExistingAppointmentOption: false,
                flowState: null,
                lastInteractionTime: new Date()
            };

            if (session.userOptionsShown && userOption) {
                session.userOptionsShown = false;
                userConversationHistories.set(userPhone, session);
            }

            if (userOption === "cancel") {
                try {
                    // 1. Delete Google Calendar Event if it exists
                    if (existingAppointment?.googleEventId) {
                        await deleteBookingEvent(userId, existingAppointment.googleEventId);
                    }

                    const result = await AppointmentModal.updateOne(
                        {
                            whatsAppNumber: userPhone,
                            _id: existingAppointment?._id,
                            user: userId,
                            status: { $nin: ['cancelled', 'completed'] },
                        },
                        {
                            $set: {
                                status: "cancelled",
                                lastUpdatedAt: new Date().toISOString(),
                            }
                        }
                    );

                    await User.findOneAndUpdate(
                        { whatsAppNumber: userPhone, user: userId, },
                        {
                            $set: {
                                status: "cancelled",
                                lastUpdatedAt: new Date().toISOString(),
                            },
                        },
                        { new: true, upsert: true }
                    );

                    await Slots.deleteMany({
                        status: 'booked',
                        user: userId,
                        whatsappNumber: userPhone,
                    });

                    if (result.modifiedCount > 0) {
                        await createNotification({
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
                    await clearUserSessionData(userPhone);
                    resetUserInput();
                    return { message: `😔 ${messagePrefix}, Failed to cancel your appointment. Please try again later.` };
                }
            }

            if (userOption === 'reschedule' || userOption === 'reschedule_all') {
                session.selectedFlowId = session.existingUserData?.flowId || existingAppointment?.flowId || null
                session.conversation = [];
                session.awaitingRescheduleOrCancel = false;
                session.userHandledExistingAppointmentOption = true;
                session.flowState = null;
                userConversationHistories.set(userPhone, session);
            }

            // ... (Reschedule Slot Logic) ...
            if (userOption === 'reschedule_slot') {
                const targetFlowId = session.existingUserData?.flowId || existingAppointment?.flowId || null;
                session.selectedFlowId = targetFlowId;
                session.conversation = [];
                session.userHandledExistingAppointmentOption = true;

                let flowDataForReschedule = null;
                try {
                    flowDataForReschedule = await ChatBotModel.findOne(
                        { _id: targetFlowId, user: userId, status: true },
                        'nodes edges title'
                    ).lean();
                } catch (err) {
                    console.error("Reschedule Fetch Error", err);
                }

                if (flowDataForReschedule && flowDataForReschedule.nodes) {
                    const targetNodeCount = existingAppointment?.currentNode;
                    let targetSlotNode = null;
                    let targetSlotInputIndex = 0;
                    let targetFieldName = null;

                    for (const node of flowDataForReschedule.nodes) {
                        if (node.data?.nodeCount === targetNodeCount) {
                            const inputs = node.data?.inputs || [];
                            const slotIndex = inputs.findIndex(input =>
                                input.type === 'Slot' && Array.isArray(input.slots) && input.slots.length > 0
                            );

                            if (slotIndex !== -1) {
                                targetSlotNode = node;
                                targetSlotInputIndex = slotIndex;
                                targetFieldName = inputs[slotIndex].field;
                                break;
                            }
                        }
                    }

                    const retainedData = existingAppointment?.data ? JSON.parse(JSON.stringify(existingAppointment.data)) : {};

                    if (targetSlotNode && targetFieldName) {
                        if (retainedData[targetFieldName]) {
                            delete retainedData[targetFieldName];
                        }

                        Object.keys(retainedData).forEach(key => {
                            if (key === targetFieldName && typeof retainedData[key] === 'string' && retainedData[key].startsWith('PRE-')) {
                                delete retainedData[key];
                            }
                        });
                    }

                    let finalNodeId = null;
                    if (flowDataForReschedule.edges) {
                        const sourceNodeIds = new Set(flowDataForReschedule.edges.map(e => e.source));
                        const targetNodeIds = new Set(flowDataForReschedule.edges.map(e => e.target));

                        for (const id of targetNodeIds) {
                            if (!sourceNodeIds.has(id)) {
                                finalNodeId = id;
                                break;
                            }
                        }
                    }

                    session.flowState = {
                        currentNodeId: targetSlotNode ? targetSlotNode.id : null,
                        inputIndex: targetSlotInputIndex || 0,
                        collected: retainedData,
                        retryCount: 0,
                        overrideNextNodeId: finalNodeId,
                        startNodeId: targetSlotNode ? targetSlotNode.id : null
                    };

                    console.log(`Reschedule: Target Count[${targetNodeCount}] -> Node[${targetSlotNode?.id}] -> Field[${targetFieldName}]`);
                }

                userConversationHistories.set(userPhone, session);
                userPrompt = null;
            }

            if (
                existingAppointment &&
                !session.userHandledExistingAppointmentOption &&
                !['cancel', 'reschedule', 'reschedule_all', 'reschedule_slot'].includes(userOption)
            ) {
                session.existingUserData = existingAppointment;
                userConversationHistories.set(userPhone, session);

                let hasActiveSlots = existingAppointment.hasSlots;

                try {
                    const liveFlowData = await ChatBotModel.findOne(
                        { _id: existingAppointment.flowId, user: userId },
                        'nodes'
                    ).lean();

                    if (liveFlowData?.nodes) {
                        const foundSlot = liveFlowData.nodes.some(n =>
                            n.data?.inputs?.some(i => i.type === 'Slot' && i.slots?.length > 0)
                        );
                        hasActiveSlots = foundSlot;
                    }
                } catch (e) { }

                const rescheduleOption = hasActiveSlots
                    ? { _id: 'reschedule_slot', title: 'Reschedule Slot' }
                    : { _id: 'reschedule_all', title: 'Update Details' };

                const mainTitleText = hasActiveSlots
                    ? `🙌 ${messagePrefix}, welcome back! You already have a booking. Would you like to change the time 🕒 or cancel ❌?`
                    : `🙌 ${messagePrefix}, welcome back! You already have a booking. Would you like to update details 📝 or cancel ❌?`;

                return {
                    optionsArray: {
                        mainTitle: mainTitleText,
                        type: 'list',
                        resp: [
                            rescheduleOption,
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
                            type: 'list',
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

            session.lastInteractionTime = new Date();
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

            // ... (Smart Hybrid AI Logic) ...
            let processedInput = userPrompt;
            let shouldRunFlow = true;
            let aiLoopReply = null;
            session.flowState = session.flowState || {};

            const req = await getFlowRequirements(
                session.flowState,
                flowTrainingData,
                processedInput,
                userId,
                session.selectedFlowId || session.existingUserData?.flowId || existingAppointment?.flowId || null,
                language,
                timezone,
            );
            const conversationData = session.conversation.map(c => `${c.sender}: ${c.message}`);
            const optionsLabel = req?.optionsLabel || '';
            const currentRetryCount = req?.retryCount || session.flowState?.retryCount || 0;

            if (req?.needsInput && userPrompt) {
                const validationFailed = req?.isValid;
                const isAbus = isAbusive(userPrompt);
                const isEmoji = isEmojiOnly(userPrompt);
                const hasHistory = !!conversationData?.length;
                const isTextField = req?.fieldType?.toLowerCase() === 'text';

                const needsAI =
                    (isAbus || isEmoji) ||
                    validationFailed &&
                    (isTextField && hasHistory);

                if (needsAI) {
                    try {
                        const parsedAI = await generateDynamicFlowData({
                            userInput: userPrompt,
                            userPhone,
                            req,
                            conversationData,
                            generateAIResponse,
                        });

                        if (parsedAI?.status === 'valid' && parsedAI.value) {
                            processedInput = parsedAI.value;
                            shouldRunFlow = true;
                            if (session.flowState) session.flowState.retryCount = 0;
                        } else {
                            shouldRunFlow = false;
                            if (session.flowState) session.flowState.retryCount = currentRetryCount + 1;

                            aiLoopReply =
                                parsedAI?.reply ||
                                "I'm sorry, I didn’t understand that. Could you try again?";
                        }
                    } catch (error) {
                        console.error('AI Processing Error:', error);
                        shouldRunFlow = false;
                        if (session.flowState) session.flowState.retryCount = currentRetryCount + 1;
                        aiLoopReply = "Something went wrong. Please try again shortly.";
                    }
                }
            }

            let generatedPrompt;
            if (shouldRunFlow) {
                generatedPrompt = await generateDynamicPrompt(
                    session.flowState,
                    processedInput,
                    flowTrainingData,
                    currentRetryCount,
                    profileName,
                    userId,
                    session.selectedFlowId || session.existingUserData?.flowId || existingAppointment?.flowId || null,
                    async () => await clearUserSessionData(userPhone),
                    resetUserInput,
                    language,
                    timezone,
                    generalWelcomeMessage,
                );

                // ...(Safe Interceptor)...
                if (session.flowState?.overrideNextNodeId) {
                    const targetId = session.flowState.overrideNextNodeId;
                    const startId = session.flowState.startNodeId;
                    const currentId = generatedPrompt?.state?.currentNodeId;

                    if (currentId && currentId !== targetId && currentId !== startId) {
                        generatedPrompt.state.currentNodeId = targetId;
                        generatedPrompt.state.inputIndex = 0;

                        delete session.flowState.overrideNextNodeId;
                        delete session.flowState.startNodeId;

                        generatedPrompt = await generateDynamicPrompt(
                            generatedPrompt.state,
                            null,
                            flowTrainingData,
                            0,
                            profileName,
                            userId,
                            session.selectedFlowId || session.existingUserData?.flowId || existingAppointment?.flowId || null,
                            async () => await clearUserSessionData(userPhone),
                            resetUserInput,
                            language,
                            timezone,
                            generalWelcomeMessage,
                        );
                    }
                }

                while (!generatedPrompt.done && generatedPrompt.state) {
                    const { currentNodeId, inputIndex, collected } = generatedPrompt.state;
                    const node = flowTrainingData.nodes.find(n => n.id === currentNodeId);
                    const input = node?.data?.inputs?.[inputIndex || 0];

                    if (!input) break;

                    const isSlot = input.type === 'Slot';
                    const fieldName = input.field || 'preference';
                    const existingValue = collected[fieldName];

                    if (!isSlot && existingValue) {
                        generatedPrompt = await generateDynamicPrompt(
                            generatedPrompt.state,
                            existingValue,
                            flowTrainingData,
                            0,
                            profileName,
                            userId,
                            session.selectedFlowId || session.existingUserData?.flowId || existingAppointment?.flowId || null,
                            async () => await clearUserSessionData(userPhone),
                            resetUserInput,
                            language,
                            timezone,
                            generalWelcomeMessage,
                        );
                    } else {
                        break;
                    }
                }

            } else {
                generatedPrompt = {
                    reply: aiLoopReply,
                    done: false,
                    state: session.flowState
                };
            }

            // ... (Slot Locking Logic ) ...
            const HOLD_MINUTES = Number(inactivityTimeoutMinutes) || 3;
            const expirationThreshold = new Date(Date.now() - HOLD_MINUTES * 60 * 1000);

            if (userOption && userOption.startsWith('PRE-SUB_')) {
                const parts = userOption.split('_');
                const slotNodeSegment = parts[4] || ''; 
                const SlotId = parseInt(slotNodeSegment.split('-')[0] || '0', 10);

                try {
                    await Slots.findOneAndUpdate(
                        {
                            user: userId,
                            whatsappNumber: userPhone,
                            flowId: session.selectedFlowId,
                        },
                        {
                            $set: {
                                slot: userOption,
                                currentNode: generatedPrompt?.state?.nodeCount,
                                SlotId,
                                status: 'underProcess',
                                updatedAt: new Date(),
                            },
                        },
                        { new: true, upsert: true, setDefaultsOnInsert: true }
                    );
                } catch (createError) {
                    const isDuplicate = createError.code === 11000 || createError.code === '11000' || (createError.message && createError.message.includes('E11000'));
                    if (isDuplicate) {
                        const lockedSlot = await Slots.findOneAndUpdate(
                            {
                                slot: userOption,
                                flowId: session.selectedFlowId,
                                $or: [
                                    { status: 'available' },
                                    { status: 'underProcess', updatedAt: { $lt: expirationThreshold } }
                                ]
                            },
                            {
                                $set: {
                                    user: userId,
                                    whatsappNumber: userPhone,
                                    status: 'underProcess',
                                    updatedAt: new Date()
                                }
                            },
                            { new: true }
                        );

                        if (!lockedSlot) {
                            await clearUserSessionData(userPhone);
                            resetUserInput();
                            return { message: `😔 Sorry ${profileName}, that slot was just booked by someone else. Please select a different time.` };
                        }
                    } else {
                        throw createError;
                    }
                }
            } else {
                await Slots.findOneAndUpdate(
                    {
                        user: userId,
                        flowId: session.selectedFlowId,
                        whatsappNumber: userPhone,
                        status: 'underProcess'
                    },
                    { $set: { updatedAt: new Date() } }
                );

                await Slots.deleteMany({
                    status: 'underProcess',
                    user: userId,
                    flowId: session.selectedFlowId,
                    updatedAt: { $lt: expirationThreshold }
                });
            }

            session.flowState = generatedPrompt.state;
            userConversationHistories.set(userPhone, session);
            let aiResponse = generatedPrompt.reply;
            const options = generatedPrompt?.options;
            const collected = generatedPrompt?.state?.collected;
            const userResponse = userPrompt?.startsWith('PRE-') ? collected?.[optionsLabel] : userPrompt;

            updateConversationHistory(userPhone, userResponse, aiResponse || options[0]?.value);
            session = userConversationHistories.get(userPhone);
            const cleanAIResp = cleanAIResponse(aiResponse);
            const messageParts = cleanAIResp?.split(',')?.map(p => p.trim()).filter(Boolean) || [];

            if (Array.isArray(options) && options.length > 0) {
                 const [{ value: mainTitle, type }, ...rest] = options;
 
                if (!rest.length) {
                    await clearUserSessionData(userPhone);
                    resetUserInput();
                    return {
                        message: `😔 Sorry ${profileName}, all slots for this selection are fully booked. Please try choosing a different date or time.`
                    };
                }
                return {
                    optionsArray: {
                        mainTitle,
                        type: type?.toLowerCase(),
                        resp: rest.map(({ id, value }) => ({ _id: id, title: value })),
                    },
                    isQuestion: true
                };
            }

            if (!cleanAIResp) {
                await clearUserSessionData(userPhone);
                resetUserInput();
            }
            const averageSentimentScoresSafe = (scoresArray = []) =>
                fillMissingSentimentFields(averageSentimentScores(scoresArray));

            try {
                if (generatedPrompt.done) {
                    const history = parseChatHistory(session.conversation);
                    const sentimentScores = await getFinalSentimentScore(history, userPhone, userId);
                    const currentScores = fillMissingSentimentFields(sentimentScores[userPhone] || {});
                    const appointmentUid = new mongoose.Types.ObjectId();
                    const appointmentData = generatedPrompt.done && generatedPrompt.state && generatedPrompt.state.collected ? generatedPrompt.state.collected : '';
                    let firstUserCreated = userRespondTime;
                    const finalRefId = existingAppointment?.refId || await generateRefID();
console.log(appointmentData, 'appointmentDataappointmentDataappointmentData');
                    if (!appointmentData || (typeof appointmentData === 'string' && appointmentData.trim() === '') || (Array.isArray(appointmentData) && appointmentData.length === 0)) {
                        if (messageParts.length) {
                            return { message: messageParts, FlowId: session.selectedFlowId };
                        }
                        return { message: cleanAIResp };
                    }

                    if (generatedPrompt.state.isActiveSlots) {
                        try {
                            const bookedSlot = await Slots.findOneAndUpdate(
                                {
                                    user: userId,
                                    whatsappNumber: userPhone,
                                    flowId: session.selectedFlowId,
                                    status: 'underProcess'
                                },
                                {
                                    $set: {
                                        status: 'booked',
                                        updatedAt: new Date()
                                    }
                                },
                                { new: true }
                            );

                            if (!bookedSlot) {
                                throw new Error('SLOT_EXPIRED');
                            }

                            if (autoSendBookingPdf) {
                                const slotDisplayString = bookedSlot.slot
                                    .replace('PRE-SUB_', '')
                                    .split('_')
                                    .slice(0, 3)
                                    .join(' ');

                                await generateAndSendBookingSlip(userPhone, {
                                    refId: finalRefId,
                                    userId: userId,
                                    flowTitle: flowTrainingData?.title || "Appointment",
                                    businessProfile: businessProfile || "NimbleMeet",
                                    slot: slotDisplayString || "Confirmed Time",
                                    data: appointmentData,
                                    language,
                                    timezone,
                                });
                            }

                            const googleEventId = await createBookingEvent(
                                userId, 
                                profileName,
                                bookedSlot, 
                                { title: flowTrainingData?.title || "Consultation" },
                                finalRefId,
                                businessProfile,
                                language,
                                timezone,
                            );

                            if (googleEventId) {
                                await Slots.updateOne(
                                    { _id: bookedSlot._id },
                                    { $set: { googleEventId: googleEventId } },
                                );
                            }

                        } catch (err) {
                            if (err.message === 'SLOT_EXPIRED') {
                                const alreadyBooked = await Slots.findOne({
                                    user: userId,
                                    flowId: session.selectedFlowId,
                                    status: 'booked'
                                });

                                if (alreadyBooked) {
                                    return { message: `👍 You have already confirmed this slot for ${alreadyBooked.slot}.` };
                                }

                                await clearUserSessionData(userPhone);
                                resetUserInput();
                                return {
                                    message: `⏳ Sorry ${profileName}, your booking session timed out. The slot is no longer reserved. Please try selecting a time again.`
                                };
                            }
                            console.error("Booking Error:", err); 
                        }
                    }

                    if (existingAppointment) {
                        firstUserCreated = existingAppointment?.userCreated || userRespondTime;

                        await createNotification({
                            userId,
                            type: "rescheduled",
                            whatsAppNumber: userPhone,
                            chatBotTitle: existingAppointment?.flowTitle,
                            profileName,
                            appointmentId: existingAppointment?._id,
                        });
                        sendToUser({
                            userId,
                            type: 'RESHEDULED_NOTIFICATION',
                            status: 'rescheduled',
                        });
                    } else {
                            const firstAppointment = await AppointmentModal.findOne({
                                whatsAppNumber: userPhone,
                                user: userId
                            }).sort({ createdAt: 1 }).lean();
    
                            if (firstAppointment?.userCreated) {
                                firstUserCreated = firstAppointment.userCreated;
                            }
                            await createNotification({
                                userId,
                                type: "booked",
                                whatsAppNumber: userPhone,
                                chatBotTitle: flowTrainingData?.title || "No name",
                                profileName,
                                appointmentId: appointmentUid,
                            });
                            sendToUser({
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
                    
                    // Fetch the slot to get googleEventId (if it was just created)
                    const finalSlotData = await Slots.findOne({
                        user: userId,
                        whatsappNumber: userPhone,
                        flowId: session.selectedFlowId,
                        status: 'booked'
                    });

                    //...(SAVE APPOINTMENT (With Google Event ID))...
                    const userRef = await User.findOneAndUpdate(
                        { whatsAppNumber: userPhone, user: userId },
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
                        { new: true, upsert: true, setDefaultsOnInsert: true, }
                    );

                    await AppointmentModal.findOneAndUpdate(
                        { _id: existingAppointment?._id || appointmentUid },
                        {
                            $setOnInsert: {
                                whatsAppUser: userRef?._id,
                                user: userId,
                                flowId: session.selectedFlowId || "",
                                flowTitle: flowTrainingData?.title || "No name",
                                whatsAppNumber: userPhone,
                                profileName,
                                userCreated: firstUserCreated,
                                refId: finalRefId,
                            },
                            $set: {
                                data: appointmentData || {},
                                hasSlots: generatedPrompt?.state?.isActiveSlots || false,
                                currentNode: generatedPrompt?.state?.nodeCount || null,
                                history: parseChatHistory(session.conversation),
                                rescheduleCount,
                                status: existingAppointment ? "rescheduled" : "booked",
                                sentimentScores: averageSentimentScoresSafe(sentimentHistory),
                                lastActiveAt: userRespondTime,
                                lastUpdatedAt: new Date().toISOString(),
                                googleEventId: finalSlotData?.googleEventId || existingAppointment?.googleEventId 
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
                    return { message: !cleanAIResp ? `Thank you ${profileName}, your appointment is successfully completed. Have a wonderful day! 😊` : cleanAIResp };
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



