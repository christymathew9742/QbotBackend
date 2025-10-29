const axios = require('axios');
const NodeCache = require('node-cache');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const handleConversation = require('../../services/whatsappService/whatsappService');
const { baseUrl } = require('../../config/whatsappConfig');
const { parseToArray, getMediaType, cleanUrl } = require('../../utils/common');
const validator = require("validator");

const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const verifyWebhook = async (req, res) => {
    const challenge = req.query['hub.challenge'];
    const token = req.query['hub.verify_token'];
    const isRecord = await User.findOne({ verifytoken: token });

    return isRecord
        ? res.status(200).send(challenge)
        : res.status(403).send('Invalid verify token');
};

const handleIncomingMessage = async (req, res) => {
    try {
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value || {};
        const whatsapData = message?.messages?.[0];
        const userPhone = whatsapData?.from;
        const messageId = whatsapData?.id;

        if (!whatsapData || !messageId) {
            return res.status(200).send('Invalid or empty message');
        }

        if (messageCache.get(messageId)) {
            console.log('⚠️ Duplicate message ignored:', messageId);
            return res.status(200).send('Duplicate message ignored');
        }
        messageCache.set(messageId, true);

        const businessPhone =
            message?.metadata?.display_phone_number ||
            message?.metadata?.phone_number_id;
        if (userPhone === businessPhone) {
            console.log('🛑 Ignored echo message from bot:', userPhone);
            return res.status(200).send('Echo message ignored');
        }

        const now = Date.now() / 1000;
        const msgTimestamp = parseInt(whatsapData?.timestamp || '0', 10);
        if (now - msgTimestamp > 90) {
            console.log('⏱️ Old message ignored:', userPhone);
            return res.status(200).send('Old message ignored');
        }

        const phoneNumberId = message?.metadata?.phone_number_id;
        const botUser = await User.findOne({ phonenumberid: phoneNumberId });
        if (!botUser) return res.status(401).send('Unauthorized bot user');

        const botStatus = validateToken(botUser, process.env.JWT_SECRET);
        if (!botStatus.valid) return res.status(401).send(botStatus.reason);

        const type = whatsapData?.type;
        let aiResponse = null;
        let userData;

        switch (type) {
            case 'text': {
                const body = whatsapData?.text?.body?.trim();
                userData = {
                userPhone,
                profileName: message?.contacts?.[0]?.profile?.name || '',
                userInput: body,
                userOption: '',
                userId: botUser._id,
                whatsTimestamp: whatsapData?.timestamp,
                };
                aiResponse = await handleConversation(userData);
                break;
            }

            case 'interactive': {
                const interactiveType = whatsapData?.interactive?.type;
                const selectedOption =
                interactiveType === 'list_reply'
                    ? whatsapData?.interactive?.list_reply?.id
                    : whatsapData?.interactive?.button_reply?.id;

                userData = {
                    userPhone,
                    profileName: message?.contacts?.[0]?.profile?.name || '',
                    userInput: '',
                    userOption: selectedOption,
                    userId: botUser._id,
                    whatsTimestamp: whatsapData?.timestamp,
                };
                aiResponse = await handleConversation(userData);
                break;
            }

            default:
                return res.status(400).send('Unsupported message type');
        }

        if (aiResponse?.resp) {
            await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
        }

        res.status(200).send('Message handled successfully');
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).send('Internal server error');
    }
};

const validateToken = (user, secretKey) => {
    const token = user?.verifytoken || '';
    if (!token || !secretKey) return { valid: false, reason: 'Missing token or secret' };

    try {
        jwt.verify(token, secretKey);
        return { valid: true, reason: 'Token valid' };
    } catch (err) {
        return {
            valid: false,
            reason: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
        };
    }
};

const sendMessageToWhatsApp = async (phoneNumber, aiResponse, botUser) => {
    if (!phoneNumber || !aiResponse) return;

    const { resp, type = '', mainTitle = '' } = aiResponse;
    if (!type) return;

    let data = null;

    try {
        if (type === 'list') {
        const rows = (resp || []).map((item) => ({
            id: item._id?.toString(),
            title: item?.title,
        }));

        data = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'interactive',
            interactive: {
                type,
                body: { text: mainTitle || 'Please choose an option:' },
                action: { button: 'Choose', sections: [{ title: 'Options', rows }] },
            },
        };
        } else if (type === 'button') {
            data = {
                messaging_product: 'whatsapp',
                to: phoneNumber,
                type: 'interactive',
                interactive: {
                type,
                body: { text: mainTitle || 'Please choose:' },
                action: {
                    buttons: (resp || []).map((option) => ({
                        type: 'reply',
                        reply: { id: String(option?._id), title: String(option?.title) },
                    })),
                },
                },
            };
        } else if (type === 'text') {
            const messagesArray = parseToArray(resp);
            for (const msg of messagesArray) {
                await sendSingleMessage(phoneNumber, botUser, msg);
                await delay(500);
            }
            return;
        }

        if (data) {
            await sendWithRetry(botUser, data);
        }
    } catch (error) {
        console.error('❌ Error sending message:', error?.response?.data || error?.message);
    }
};

const sendSingleMessage = async (phoneNumber, botUser, rawMessage) => {
    try {

        if (!phoneNumber || !botUser || !rawMessage) {
            throw new Error("Invalid input data");
        }

        const message = rawMessage.trim();
        let data;
        const urlRegex = /(https?:\/\/[^\s]+)/;
        const match = message.match(urlRegex);
        const rawUrl = match ? match[0].trim() : null;
        const cleanedMessage = rawUrl ? encodeURI(rawUrl) : message.trim();
        const isUrl = rawUrl ? validator.isURL(cleanedMessage, { require_protocol: true }) : false;
        const coordRegex = /(-?\d{1,2}\.\d+)[,\s-]+(-?\d{1,3}\.\d+)/;
        const coordMatch = message.match(coordRegex);

        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lng = parseFloat(coordMatch[2]);

            if (
                !validator.isFloat(lat.toString()) ||
                !validator.isFloat(lng.toString()) ||
                lat < -90 || lat > 90 ||
                lng < -180 || lng > 180
            ) {
                throw new Error("Invalid coordinates format");
            }

            data = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "location",
                location: { latitude: lat, longitude: lng },
            };
        } else if (isUrl) {
            const cleanLink = cleanUrl(message);
            if (!cleanLink) throw new Error("Invalid or unsafe media URL");

            const type = getMediaType(cleanLink).toLowerCase().trim();
            const base = { messaging_product: "whatsapp", to: phoneNumber, type };
            console.log(type,cleanLink)
            switch (type) {
                case "image":
                case "video":
                case "audio":
                case "document":
                    data = { ...base, [type]: { link: cleanLink } };
                    break;
                default:
                    data = { ...base, type: "text", text: { body: message } };
            }
        } else {
            data = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "text",
                text: { body: message },
            };
        }

        await sendWithRetry(botUser, data);
    } catch (error) {
        console.error("sendSingleMessage error:", error.message);
        throw error;
    }
};

const sendWithRetry = async (botUser, data) => {
    const url = `${baseUrl}/${botUser?.phonenumberid}/messages`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await axios.post(url, data, {
                headers: {
                    Authorization: `Bearer ${botUser?.accesstoken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 8000,
            });

            console.log(`✅ Message sent successfully (Attempt ${attempt})`);
            return;
        } catch (error) {
            const status = error?.response?.status;
            const msg = error?.response?.data || error?.message;
            console.error(`⚠️ Send failed (Attempt ${attempt}):`, msg);

            if ([429, 500, 503].includes(status) && attempt < MAX_RETRIES) {
                console.log(`⏳ Retrying in ${RETRY_DELAY_MS}ms...`);
                await delay(RETRY_DELAY_MS);
            } else {
                console.error('🚫 Message failed permanently:', msg);
                break;
            }
        }
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
};




// const axios = require('axios');
// const NodeCache = require('node-cache');
// const jwt = require('jsonwebtoken');
// const User = require('../../models/User');
// const handleConversation = require('../../services/whatsappService/whatsappService');
// const { baseUrl } = require('../../config/whatsappConfig');
// const { parseToArray, getMediaType, cleanUrl } = require('../../utils/common');
// const validator = require("validator");

// const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// const MAX_RETRIES = 3;
// const RETRY_DELAY_MS = 1500;
// const AXIOS_TIMEOUT = 10000;

// const verifyWebhook = async (req, res) => {
//     const challenge = req.query['hub.challenge'];
//     const token = req.query['hub.verify_token'];
//     const isRecord = await User.findOne({ verifytoken: token });

//     return isRecord
//         ? res.status(200).send(challenge)
//         : res.status(403).send('Invalid verify token');
// };

// const handleIncomingMessage = async (req, res) => {
//     try {
//         const entry = req.body?.entry?.[0];
//         const changes = entry?.changes?.[0];
//         const message = changes?.value || {};
//         const whatsapData = message?.messages?.[0];
//         const userPhone = whatsapData?.from;
//         const messageId = whatsapData?.id;

//         if (!whatsapData || !messageId) {
//             return res.status(200).send('Invalid or empty message');
//         }

//         if (messageCache.get(messageId)) {
//             console.log('⚠️ Duplicate message ignored:', messageId);
//             return res.status(200).send('Duplicate message ignored');
//         }
//         messageCache.set(messageId, true);

//         const businessPhone =
//         message?.metadata?.display_phone_number ||
//         message?.metadata?.phone_number_id;
//         if (userPhone === businessPhone) {
//             console.log('🛑 Ignored echo message from bot:', userPhone);
//             return res.status(200).send('Echo message ignored');
//         }

//         const now = Date.now() / 1000;
//         const msgTimestamp = parseInt(whatsapData?.timestamp || '0', 10);
//         if (now - msgTimestamp > 90) {
//             return res.status(200).send('Old message ignored');
//         }

//         const phoneNumberId = message?.metadata?.phone_number_id;
//         const botUser = await User.findOne({ phonenumberid: phoneNumberId });
//         if (!botUser) return res.status(401).send('Unauthorized bot user');

//         const botStatus = validateToken(botUser, process.env.JWT_SECRET);
//         if (!botStatus.valid) return res.status(401).send(botStatus.reason);

//         const type = whatsapData?.type;
//         let aiResponse = null;
//         let userData;

//         switch (type) {
//             case 'text': {
//                 const body = whatsapData?.text?.body?.trim();
//                 userData = {
//                     userPhone,
//                     profileName: message?.contacts?.[0]?.profile?.name || '',
//                     userInput: body,
//                     userOption: '',
//                     userId: botUser._id,
//                     whatsTimestamp: whatsapData?.timestamp,
//                 };
//                 aiResponse = await handleConversation(userData);
//                 break;
//             }

//             case 'interactive': {
//                 const interactiveType = whatsapData?.interactive?.type;
//                 const selectedOption =
//                 interactiveType === 'list_reply'
//                     ? whatsapData?.interactive?.list_reply?.id
//                     : whatsapData?.interactive?.button_reply?.id;

//                 userData = {
//                     userPhone,
//                     profileName: message?.contacts?.[0]?.profile?.name || '',
//                     userInput: '',
//                     userOption: selectedOption,
//                     userId: botUser._id,
//                     whatsTimestamp: whatsapData?.timestamp,
//                 };
//                 aiResponse = await handleConversation(userData);
//                 break;
//             }

//             default:
//                 return res.status(400).send('Unsupported message type');
//         }

//         if (aiResponse && (typeof aiResponse === 'object' || Array.isArray(aiResponse))) {
//             await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
//         }

//         res.status(200).send('Message handled successfully');
//     } catch (error) {
//         console.error('❌ Webhook error:', error);
//         res.status(500).send('Internal server error');
//     }
// };

// const validateToken = (user, secretKey) => {
//     const token = user?.verifytoken || '';
//     if (!token || !secretKey) return { valid: false, reason: 'Missing token or secret' };

//     try {
//         jwt.verify(token, secretKey);
//         return { valid: true, reason: 'Token valid' };
//     } catch (err) {
//         return {
//             valid: false,
//             reason: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
//         };
//     }
// };

// const sendMessageToWhatsApp = async (phoneNumber, aiResponse, botUser) => {
//     if (!phoneNumber || !aiResponse) return;

//     try {
//         console.log('📩 WhatsApp aiResponse:', JSON.stringify(aiResponse, replacerLimited, 2));

//         if (Array.isArray(aiResponse)) {
//             for (const item of aiResponse) {
//                 await sendMessageToWhatsApp(phoneNumber, item, botUser);
//                 await delay(500);
//             }
//             return;
//         }

//         if (aiResponse?.optionsArray && aiResponse?.message) {
//             const { message, optionsArray } = aiResponse;

//             await sendSingleMessage(phoneNumber, botUser, String(message));
//             await delay(500);

//             await sendListMessage(phoneNumber, botUser, optionsArray);
//             return;
//         }

//         if (aiResponse?.optionsArray) {
//             await sendListMessage(phoneNumber, botUser, aiResponse.optionsArray);
//             return;
//         }

//         const { resp, type = '', mainTitle = '' } = aiResponse || {};
//         if (!type) {
//             console.warn('No message type present in aiResponse, skipping send.');
//             return;
//         }

//         if (type === 'text') {
//             const messagesArray = parseToArray(resp);
//             for (const msg of messagesArray) {
//                 await sendSingleMessage(phoneNumber, botUser, msg);
//                 await delay(500);
//             }
//             return;
//         }

//         if (type === 'list' || type === 'button') {
//             await sendListMessage(phoneNumber, botUser, { mainTitle, type, resp });
//             return;
//         }

//         console.warn('Unhandled message type in sendMessageToWhatsApp:', type);
//     } catch (error) {
//         console.error('❌ Error sending WhatsApp message:', error?.response?.data || error?.message || error);
//     }
// };

// function replacerLimited(key, value) {
//     if (typeof value === 'object' && value !== null && Object.keys(value).length > 50) {
//         return '[LargeObject]';
//     }
//     return value;
// }

// const sendListMessage = async (phoneNumber, botUser, optionsArray) => {
//   try {
//     if (!phoneNumber || !botUser || !optionsArray) return;
//     const { mainTitle = '', type = 'list', resp = [] } = optionsArray;
//     if (!Array.isArray(resp) || resp.length === 0) return;

//     if (type === 'list') {
//         const rows = resp.slice(0, 10).map((item, idx) => ({
//             id: String(item?._id ?? item?.id ?? `opt_${idx}`),
//             title: String(item?.title ?? item?.value ?? `Option ${idx + 1}`),
//             description: item?.description ? String(item.description) : undefined,
//         }));

//         const data = {
//             messaging_product: 'whatsapp',
//             to: phoneNumber,
//             type: 'interactive',
//             interactive: {
//                 type: 'list',
//                 body: { text: mainTitle || 'Please choose an option:' },
//                 action: { button: 'Choose', sections: [{ title: 'Options', rows }] },
//             },
//         };
//         await sendWithRetry(botUser, data);
//         return;
//     }

//     if (type === 'button') {
//         const buttons = resp.slice(0, 3).map((option, idx) => ({
//             type: 'reply',
//             reply: {
//                 id: String(option?._id ?? option?.id ?? `btn_${idx}`),
//                 title: String(option?.title ?? option?.value ?? `Choice ${idx + 1}`),
//             },
//         }));
//         if (!buttons.length) return;
//         const data = {
//             messaging_product: 'whatsapp',
//             to: phoneNumber,
//             type: 'interactive',
//             interactive: {
//                 type: 'button',
//                 body: { text: mainTitle || 'Please choose:' },
//                 action: { buttons },
//             },
//         };
//         await sendWithRetry(botUser, data);
//         return;
//     }
//         const fallbackText = `${mainTitle}\n\n${resp.map((r, i) => `${i + 1}. ${r.title ?? r.value ?? r}`).join('\n')}`;
//         await sendSingleMessage(phoneNumber, botUser, fallbackText);
//     } catch (error) {
//         console.error('sendListMessage error:', error?.response?.data || error?.message || error);
//     }
// };

// const sendSingleMessage = async (phoneNumber, botUser, rawMessage) => {
//     try {
//         if (!phoneNumber || !botUser || !rawMessage) {
//         throw new Error("Invalid input data");
//         }

//         const message = String(rawMessage).trim();
//         let data;
//         const urlRegex = /(https?:\/\/[^\s]+)/;
//         const match = message.match(urlRegex);
//         const rawUrl = match ? match[0].trim() : null;
//         const cleanedMessage = rawUrl ? encodeURI(rawUrl) : message.trim();
//         const isUrl = rawUrl ? validator.isURL(cleanedMessage, { require_protocol: true }) : false;
//         const coordRegex = /(-?\d{1,2}\.\d+)[,\s-]+(-?\d{1,3}\.\d+)/;
//         const coordMatch = message.match(coordRegex);

//         if (coordMatch) {
//             const lat = parseFloat(coordMatch[1]);
//             const lng = parseFloat(coordMatch[2]);

//             if (
//                 !validator.isFloat(lat.toString()) ||
//                 !validator.isFloat(lng.toString()) ||
//                 lat < -90 || lat > 90 ||
//                 lng < -180 || lng > 180
//             ) {
//                 throw new Error("Invalid coordinates format");
//             }

//             data = {
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "location",
//                 location: { latitude: lat, longitude: lng },
//             };
//         } else if (isUrl) {
//             const cleanLink = cleanUrl(message);
//             if (!cleanLink) throw new Error("Invalid or unsafe media URL");

//             const type = getMediaType(cleanLink).toLowerCase().trim();
//             const base = { messaging_product: "whatsapp", to: phoneNumber, type };
//             switch (type) {
//                 case "image":
//                 case "video":
//                 case "audio":
//                 case "document":
//                 data = { ...base, [type]: { link: cleanLink } };
//                 break;
//                 default:
//                 data = { messaging_product: "whatsapp", to: phoneNumber, type: "text", text: { body: message } };
//             }
//         } else {
//             data = {
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "text",
//                 text: { body: message },
//             };
//         }
//         await sendWithRetry(botUser, data);
//     } catch (error) {
//         console.error("sendSingleMessage error:", error?.response?.data || error?.message || error);
//         throw error;
//     }
// };

// const sendWithRetry = async (botUser, data) => {
//     if (!botUser || !data) {
//         console.error('sendWithRetry called with invalid params');
//         return;
//     }

//     const url = `${baseUrl}/${botUser?.phonenumberid}/messages`;
//     for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
//         try {
//             await axios.post(url, data, {
//                 headers: {
//                     Authorization: `Bearer ${botUser?.accesstoken}`,
//                     'Content-Type': 'application/json',
//                 },
//                 timeout: AXIOS_TIMEOUT,
//             });

//             console.log(`✅ Message sent successfully (Attempt ${attempt})`);
//             return;
//         } catch (error) {
//             const status = error?.response?.status;
//             const msg = error?.response?.data || error?.message;
//             console.error(`⚠️ Send failed (Attempt ${attempt}):`, msg);
//             if ([429, 500, 502, 503, 504].includes(status) && attempt < MAX_RETRIES) {
//                 console.log(`⏳ Retrying in ${RETRY_DELAY_MS}ms...`);
//                 await delay(RETRY_DELAY_MS);
//             } else {
//                 console.error('🚫 Message failed permanently:', msg);
//                 break;
//             }
//         }
//     }
// };

// module.exports = {
//     verifyWebhook,
//     handleIncomingMessage,
// };


