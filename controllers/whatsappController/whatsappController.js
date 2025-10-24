// const axios = require('axios');
// const NodeCache = require('node-cache');
// const jwt = require('jsonwebtoken');
// const User = require('../../models/User');
// const handleConversation = require('../../services/whatsappService/whatsappService');
// const { baseUrl } = require('../../config/whatsappConfig');
// const { parseToArray } = require('../../utils/common');

// const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// const delay = ms => new Promise(res => setTimeout(res, ms));


// const verifyWebhook = async (req, res) => {
//     const challenge = req.query['hub.challenge'];
//     const webHooktoken = req.query['hub.verify_token'];
//     const isRecord = await User.findOne({ verifytoken: webHooktoken });

//     return isRecord ? res.status(200).send(challenge) : res.status(403).send('Invalid verify token');
// };

// const handleIncomingMessage = async (req, res) => {
//     try {
//         const message = req?.body?.entry?.[0]?.changes?.[0]?.value || {};
//         const contact = message?.contacts?.[0] || {};
//         const profile = contact?.profile || {};
//         const whatsapData = message?.messages?.[0] || {};
//         const jsonString = JSON.stringify(whatsapData?.timestamp);
        
//         // Ignore status/system messages
//         if (!whatsapData || message?.statuses) {
//             return res.status(200).send('Ignoring status/system message');
//         }

//         const phoneNumberId = message?.metadata?.phone_number_id;
//         const botUser = await User.findOne({ phonenumberid: phoneNumberId });
//         if (!botUser) return res.status(401).send('Unauthorized: No matching bot user');

//         const botStatus = validateToken(botUser, process.env.JWT_SECRET);
//         if (!botStatus.valid) return res.status(401).send(botStatus.reason);

//         const messageId = whatsapData?.id;
//         const userPhone = whatsapData?.from;
//         const profileName = profile?.name || '';
//         const type = whatsapData?.type;

//         // ✅ Prevent duplicate processing
//         if (messageCache.get(messageId)) return res.status(200).send('Duplicate message ignored');
//         messageCache.set(messageId);
//         setTimeout(() => messageCache.del(messageId), 60000); // Remove after 1 min

//         // ✅ Prevent bot's own echo messages
//         if (userPhone === message?.metadata?.display_phone_number) {
//             return res.status(200).send('Echo message ignored');
//         }

//         // ✅ Ignore empty or unsupported message types
//         if (!whatsapData?.text?.body && !whatsapData?.interactive?.list_reply?.id && !whatsapData?.interactive?.button_reply?.id) {
//             return res.status(400).send('No valid message body found');
//         }

//         // ✅ Prevent replay of old messages
//         const now = Date.now() / 1000;
//         const msgTimestamp = parseInt(whatsapData?.timestamp || '0', 10);
//         if (now - msgTimestamp > 90) {
//             return res.status(200).send('Old message ignored');
//         }

//         let aiResponse = null;
//         let userData;
       
//         switch (type) {
//             case 'text':
//                 const body = whatsapData?.text?.body?.trim();
//                 userData = {
//                     userPhone,
//                     profileName,
//                     userInput: body,
//                     userOption: '',
//                     userId: botUser._id,
//                     whatsTimestamp: whatsapData?.timestamp,
//                 };
                
//                 aiResponse = await handleConversation(userData);
//                 break;

//             case 'interactive':
//                 const interactiveType = whatsapData?.interactive?.type;
//                 const selectedOption = interactiveType === 'list_reply'
//                     ? whatsapData?.interactive?.list_reply?.id
//                     : whatsapData?.interactive?.button_reply?.id;
//                 userData = {
//                     userPhone,
//                     profileName,
//                     userInput: '',
//                     userOption: selectedOption,
//                     userId: botUser._id,
//                     whatsTimestamp: whatsapData?.timestamp,
//                 };

//                 aiResponse = await handleConversation(userData);
//                 break;

//             default:
//                 return res.status(400).send('Unsupported message type');
//         }

//         if (aiResponse?.resp) {
//             await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
//         }

//         res.status(200).send('Message handled');
//     } catch (error) {
//         console.error('Webhook error:', error);
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

// const sendSingleMessage = async (phoneNumber, botUser, message) => {
//     try {
//         const data = {
//             messaging_product: "whatsapp",
//             to: phoneNumber,
//             type: "text",
//             text: { body: String(message) }
//         };
//         await axios.post(
//             `${baseUrl}/${botUser?.phonenumberid}/messages`,
//             data,
//             {
//                 headers: {
//                     Authorization: `Bearer ${botUser?.accesstoken}`,
//                     "Content-Type": "application/json"
//                 }
//             }
//         );
//     } catch (err) {
//         console.error("Error sending single message:", err?.response?.data || err?.message);
//     }
// };

// const sendMessageToWhatsApp = async (phoneNumber, aiResponse, botUser) => {
//     try {
//         if (!phoneNumber || !aiResponse) return;

//         const { resp, type = "", mainTitle = "" } = aiResponse;
//         if (!type) return;

//         let data;

//         if (type === "list") {
//             const rows = (resp || []).map(item => ({
//                 id: item._id?.toString(),
//                 title: item?.title
//             }));

//             data = {
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "interactive",
//                 interactive: {
//                     type,
//                     body: { text: mainTitle || "Please choose an option:" },
//                     action: {
//                         button: "Choose",
//                         sections: [
//                             { title: "Options", rows }
//                         ]
//                     }
//                 }
//             };

//         } else if (type === "button") {
//             data = {
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "interactive",
//                 interactive: {
//                     type,
//                     body: { text: mainTitle || "Please choose:" },
//                     action: {
//                         buttons: (resp || []).map(option => ({
//                             type: "reply",
//                             reply: { id: String(option?._id), title: String(option?.title) }
//                         }))
//                     }
//                 }
//             };

//         } else if (type === "text") {
//             const messagesArray = parseToArray(resp);
//             for (const msg of messagesArray) {
//                 await sendSingleMessage(phoneNumber, botUser, msg);
//                 await delay(500);
//             }

//             return; 
//         } else {
//             throw new Error(`Unsupported message type: ${type}`);
//         }

//         if (data) {
//             await axios.post(
//                 `${baseUrl}/${botUser?.phonenumberid}/messages`,
//                 data,
//                 {
//                     headers: {
//                         Authorization: `Bearer ${botUser?.accesstoken}`,
//                         "Content-Type": "application/json"
//                     }
//                 }
//             );
//         }

//     } catch (error) {
//         console.error("Error sending message:", error?.response?.data || error?.message);
//         await handleConversation(error?.response?.data || error?.message);
//     }
// };

// module.exports = {
//     verifyWebhook,
//     handleIncomingMessage,
// };



const axios = require('axios');
const NodeCache = require('node-cache');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const handleConversation = require('../../services/whatsappService/whatsappService');
const { baseUrl } = require('../../config/whatsappConfig');
const { parseToArray } = require('../../utils/common');

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

const sendSingleMessage = async (phoneNumber, botUser, message) => {
    const data = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: { body: String(message) },
    };
    await sendWithRetry(botUser, data);
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

