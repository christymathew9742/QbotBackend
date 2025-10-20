const axios = require('axios');
const NodeCache = require('node-cache');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const handleConversation = require('../../services/whatsappService/whatsappService');
const { baseUrl } = require('../../config/whatsappConfig');

const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

const verifyWebhook = async (req, res) => {
    const challenge = req.query['hub.challenge'];
    const webHooktoken = req.query['hub.verify_token'];
    const isRecord = await User.findOne({ verifytoken: webHooktoken });

    return isRecord ? res.status(200).send(challenge) : res.status(403).send('Invalid verify token');
};

const handleIncomingMessage = async (req, res) => {
    try {
        const message = req?.body?.entry?.[0]?.changes?.[0]?.value || {};
        const contact = message?.contacts?.[0] || {};
        const profile = contact?.profile || {};
        const whatsapData = message?.messages?.[0] || {};
        const jsonString = JSON.stringify(whatsapData?.timestamp);
        
        // Ignore status/system messages
        if (!whatsapData || message?.statuses) {
            return res.status(200).send('Ignoring status/system message');
        }

        const phoneNumberId = message?.metadata?.phone_number_id;
        const botUser = await User.findOne({ phonenumberid: phoneNumberId });
        if (!botUser) return res.status(401).send('Unauthorized: No matching bot user');

        const botStatus = validateToken(botUser, process.env.JWT_SECRET);
        if (!botStatus.valid) return res.status(401).send(botStatus.reason);

        const messageId = whatsapData?.id;
        const userPhone = whatsapData?.from;
        const profileName = profile?.name || '';
        const type = whatsapData?.type;

        // ✅ Prevent duplicate processing
        if (messageCache.get(messageId)) return res.status(200).send('Duplicate message ignored');
        messageCache.set(messageId);
        setTimeout(() => messageCache.del(messageId), 60000); // Remove after 1 min

        // ✅ Prevent bot's own echo messages
        if (userPhone === message?.metadata?.display_phone_number) {
            return res.status(200).send('Echo message ignored');
        }

        // ✅ Ignore empty or unsupported message types
        if (!whatsapData?.text?.body && !whatsapData?.interactive?.list_reply?.id && !whatsapData?.interactive?.button_reply?.id) {
            return res.status(400).send('No valid message body found');
        }

        // ✅ Prevent replay of old messages
        const now = Date.now() / 1000;
        const msgTimestamp = parseInt(whatsapData?.timestamp || '0', 10);
        if (now - msgTimestamp > 90) {
            return res.status(200).send('Old message ignored');
        }

        let aiResponse = null;
        let userData;
       
        switch (type) {
            case 'text':
                const body = whatsapData?.text?.body?.trim();
                userData = {
                    userPhone,
                    profileName,
                    userInput: body,
                    userOption: '',
                    userId: botUser._id,
                    whatsTimestamp: whatsapData?.timestamp,
                };
                
                aiResponse = await handleConversation(userData);
                break;

            case 'interactive':
                const interactiveType = whatsapData?.interactive?.type;
                const selectedOption = interactiveType === 'list_reply'
                    ? whatsapData?.interactive?.list_reply?.id
                    : whatsapData?.interactive?.button_reply?.id;
                userData = {
                    userPhone,
                    profileName,
                    userInput: '',
                    userOption: selectedOption,
                    userId: botUser._id,
                    whatsTimestamp: whatsapData?.timestamp,
                };

                aiResponse = await handleConversation(userData);
                break;

            default:
                return res.status(400).send('Unsupported message type');
        }

        if (aiResponse?.resp) {
            await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
        }

        res.status(200).send('Message handled');
    } catch (error) {
        console.error('Webhook error:', error);
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
    try {
        const { resp, type = "", mainTitle = "" } = aiResponse || {};
        let data;
        if(!type || !phoneNumber) return;
        
        // if (type === "list") {
        //     const rows = resp.map(item => ({
        //         id: item._id?.toString(),
        //         title: item?.title,
        //     }));

        //     data = {
        //         messaging_product: "whatsapp",
        //         to: phoneNumber,
        //         type: "interactive",
        //         interactive: {
        //             type: type,
        //             body: { text: mainTitle || "Please choose an option:" },
        //             action: {
        //                 button: "Choose",
        //                 sections: [
        //                     {
        //                         title: "Options", 
        //                         rows
        //                     }
        //                 ]
        //             }
        //         }
        //     };
        // } 

        if (type === "list") {
            const rows = resp.map(item => ({
                id: item._id?.toString(),
                title: item?.title,
            }));

            data = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "interactive",
                interactive: {
                    type: type,
                    body: { text: mainTitle || "Please choose an option:" },
                    action: {
                        button: "Choose",
                        sections: [
                            {
                                title: "Options", 
                                rows
                            }
                        ]
                    }
                }
            };
        }

        else if (type === "button") {
            data = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "interactive",
                interactive: {
                    type: type,
                    body: { text: mainTitle || "Please choose:" },
                    action: {
                        buttons: resp.map((option) => ({
                            type: "reply",
                            reply: {
                                id: String(option?._id),
                                title: String(option?.title)
                            }
                        }))
                    }
                }
            };
        } else if (type === "text") {
            data = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: type,
                text: { body: String(resp) }
            };
        } else {
            throw new Error(`Unsupported message type: ${type}`);
        }

        await axios.post(
            `${baseUrl}/${botUser?.phonenumberid}/messages`,
            data,
            {
                headers: {
                    Authorization: `Bearer ${botUser?.accesstoken}`,
                    "Content-Type": "application/json"
                }
            }
        );
    } catch (error) {
        console.error("Error sending message:", error?.response?.data || error?.message);
        await handleConversation(error?.response?.data || error?.message);
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
};









// const axios = require('axios');
// const fs = require("fs");
// const path = require('path');
// const { Client } = require('whatsapp-web.js');
// const User = require('../../models/User');
// const vision = require('@google-cloud/vision');
// const jwt = require('jsonwebtoken');
// const { apiToken, baseUrl} = require('../../config/whatsappConfig');
// const handleConversation = require('../../services/whatsappService/whatsappService'); 
// // const {processAudioWithAzureSTT, playTextToSpeech}  = require('../../ai/voiceAssistant/voiceAssistant');


// // const voicePath = path.resolve(__dirname, '../.././output.wav');
// // const voiceStream = fs.createReadStream(voicePath);

// const verifyWebhook = async (req, res) => {
//     const challenge = req.query['hub.challenge'];
//     const webHooktoken = req.query['hub.verify_token'];
//     const isRecord = await User.findOne({ verifytoken: webHooktoken });
    
//     if (isRecord) {
//         res.status(200).send(challenge);
//     } else {
//         res.status(403).send(result?.reason);
//     }
// };

// const handleIncomingMessage = async (req, res) => {

//     try {
//         const message = req?.body?.entry?.[0]?.changes?.[0]?.value || '';
//         const phoneNumberId = message?.metadata?.phone_number_id || '';
//         const whatsapData = message?.messages?.[0];
//         const botUser =  await User.findOne({ phonenumberid: phoneNumberId });
//         const botStatus = validateToken(botUser, process.env.JWT_SECRET);

//         if (!botUser || !message?.messages?.[0] || !botStatus?.valid) return res.status(401).send(botStatus?.reason || 'Unauthorized user');

//         const { from: userPhone, type, profile } = whatsapData;
//         const userId = botUser?._id || '';
//         const profileName = profile?.name;
//         let { userData , aiResponce, audioMessage, imagedata } = {};
//         console.log(whatsapData?.text?.body, 'whatsapData');
//         switch (type) {
//             case 'text':
//                 userData = {
//                     userPhone,
//                     profileName,
//                     userInput:whatsapData?.text?.body,
//                     userOption:'',
//                     userId,
//                 }
//                 aiResponce = await handleConversation(userData || null);
//                 break;
//             case 'button':
//                 aiResponce = 'You selected a button option.';
//                 break;
//             case 'interactive':
//                 userData = {
//                     userPhone,
//                     profileName,
//                     userInput:'',
//                     userOption:whatsapData?.interactive?.list_reply?.id,
//                     userId,
//                 }
//                 if (whatsapData?.interactive?.type === 'button_reply') {
//                     aiResponce = `You selected: ${whatsapData?.interactive?.button_reply?.title}`;
//                 } else if (whatsapData?.interactive?.type === 'list_reply') {
//                     aiResponce = await handleConversation(userData || null);
//                 }
//                 break;
//             case 'audio':
//                 userData = whatsapData?.audio?.id;
//                 audioMessage = await processAudioMessage(userData || null)
//                // aiResponce = audioMessage
//                 break;
//             case 'image':
//                 userData = whatsapData?.image?.id;
//                 imagedata = await getImageUrl(userData);
//                // aiResponce = await handleConversation(imagedata || null);
//                 break;
//             default:
//                 return res.status(400).send('Unsupported message type.');
//         }
        
//         await sendMessageToWhatsApp(userPhone, aiResponce, botUser);

//         if (req.body.messages || Array.isArray(req.body.messages)) {
//             res.status(200).send(botStatus?.reason);
//         }
//     } catch (error) {
//         console.error('Error:', error?.message);
//         res.status(500).send('Internal server error');
//     } 
// };

// const validateToken = (user, secretKey) => {
//     const token = user?.verifytoken || '';
//     if (!token || !secretKey) {
//         return {
//             valid: false,
//             reason: 'Missing token or secret key',
//             decoded: null,
//         };
//     }

//     try {
//         const decoded = jwt.verify(token, secretKey);
//         return {
//             valid: true,
//             reason: 'Valid token',
//             decoded,
//         };
//     } catch (err) {
//         return {
//             valid: false,
//             reason: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
//             decoded: null,
//         };
//     }
// };

// const sendMessageToWhatsApp = async (phoneNumber, aiResponce, botUser) => {
//     try {
//         let data;
//         const {resp, type, mainTitle = ""} = aiResponce;
//         if (type === "list") {
//             const rows = resp?.map(item => ({
//                 id: item?._id.toString(),
//                 title: item?.title,
//             }));
//             data = JSON.stringify({
//                 messaging_product: 'whatsapp',
//                 to: phoneNumber,
//                 type: 'interactive',
//                 interactive: {
//                     type: 'list',
//                     // header: {
//                     //     type: 'text',
//                     //     text: 'Select an Option',
//                     // },
//                     body: {
//                         text: mainTitle,
//                     },
//                     action: {
//                         button: 'Choose',
//                         sections: [
//                             {
//                                 rows:rows,
//                             },
//                         ],
//                     },
//                 },
//             });
//         } else if (type === "button") {
//             data = JSON.stringify({
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "interactive",
//                 interactive: {
//                     type: "button",
//                     header: {
//                         type: "text",
//                         text: "Choose an Option"
//                     },
//                     body: {
//                         text: "Select one of the options below:"
//                     },
//                     action: {
//                         buttons: options?.map((option, index) => ({
//                             type: "reply",
//                             reply: {
//                                 id: `option_${index + 1}`,
//                                 title: option.title
//                             }
//                         }))
//                     }
//                 }
//             });
//         } else {
//             data = JSON.stringify({
//                 messaging_product: "whatsapp",
//                 to: phoneNumber,
//                 type: "text",
//                 text: {
//                     body: resp
//                 }
//             });
//         }

//         const config = {
//             headers: {
//                 Authorization: `Bearer ${botUser?.accesstoken}`,
//                 "Content-Type": "application/json"
//             }
//         };

//         await axios.post(`${baseUrl}/${botUser?.phonenumberid}/messages`, data, config);
//     } catch (error) {
//         data = JSON.stringify({
//             messaging_product: "whatsapp",
//             to: phoneNumber,
//             type: "text",
//             text: {
//                 body: 'Give me a sec...'
//             }
//         });
//         console.error("Error sending WhatsApp message:", error.response?.data || error.message);
//     }
// };

// const getMediaData = async (audiId) => {
//     try {
//         const url = `${baseUrl}/${audiId}`;
//         const response = await axios.get(url, {
//             headers: {
//                 Authorization: `Bearer ${apiToken}`,
//             },
//             responseType: 'stream',
//         });

//         const filePath = './outputnew.ogg'; 
//         response?.data.pipe(fs.createWriteStream(filePath));
//         console.log('File downloaded successfully!');

//         console.log(response?.data.url)

//         return response?.data;
       
//     } catch (error) {
//         console.error('Error retrieving media file URL:', error.message);
//         throw new Error('Failed to get media file URL.');
//     }
// };

// const processAudioMessage = async (audiId) => {
//     try {
//         const audioFile = await getMediaData(audiId);

//         function handleTextConversion(error, text) {
//             if (error) {
//                 console.error("Error converting speech to text:", error);
//             } else {
//                 console.log("Recognized Text:", text);
//                 return text;
//             }
//         }
//         // playTextToSpeech('halo i hop you are doin well i love you umma umma ')
//         // console.log(media,'mediamediamediamediamediamediamediamediamediamedia')
//         // processAudioWithAzureSTT(voiceStream);

//     } catch (error) {
//         console.error('Error processing audio message:', error.message);
//     }
// };

// // Function to get the image URL from WhatsApp Media ID
// const getImageUrl = async (mediaId) => {
//     try {
//         const url = `${baseUrl}/${mediaId}`;
//         const response = await axios.get(url, {
//             headers: {
//                 Authorization: `Bearer ${apiToken}`,
//             },
//             responseType: 'arraybuffer'
//         });
//         return response.data.url;
//     } catch (error) {
//         console.error('Error fetching image URL:', error.message);
//         throw new Error('Failed to fetch image URL');
//     }
// };

// module.exports = {
//     verifyWebhook,
//     handleIncomingMessage,
// };







