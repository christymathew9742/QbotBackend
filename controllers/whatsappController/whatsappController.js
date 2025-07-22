const axios = require('axios');
const fs = require("fs");
const path = require('path');
const { Client } = require('whatsapp-web.js');
const User = require('../../models/User');
const vision = require('@google-cloud/vision');
const jwt = require('jsonwebtoken');
const { whatsappPhoneId, apiToken, webToken , baseUrl} = require('../../config/whatsappConfig');
const handleConversation = require('../../services/whatsappService/whatsappService'); 
// const {processAudioWithAzureSTT, playTextToSpeech}  = require('../../ai/voiceAssistant/voiceAssistant');


// const voicePath = path.resolve(__dirname, '../.././output.wav');
// const voiceStream = fs.createReadStream(voicePath);

const verifyWebhook = async (req, res) => {
    const challenge = req.query['hub.challenge'];
    const webHooktoken = req.query['hub.verify_token'];
    const isRecord = await User.findOne({ verifytoken: webHooktoken });
    
    if (isRecord) {
        res.status(200).send(challenge);
    } else {
        res.status(403).send(result?.reason);
    }
};

const handleIncomingMessage = async (req, res) => {
    
    try {
        const message = req?.body?.entry?.[0]?.changes?.[0]?.value || '';
        const phoneNumberId = message?.metadata?.phone_number_id || '';
        const whatsapData = message?.messages?.[0];
        const botUser =  await User.findOne({ phonenumberid: phoneNumberId });
        const botStatus = validateToken(botUser, process.env.JWT_SECRET);

        if (!botUser || !message?.messages?.[0] || !botStatus?.valid) return res.status(401).send(botStatus?.reason || 'Unauthorized user');

        const { from: userPhone, type } = whatsapData;
        const userId = botUser?._id || '';
        let { userData , aiResponce, audioMessage, imagedata } = {};

        switch (type) {
            case 'text':
                userData = {
                    userPhone,
                    userInput:whatsapData?.text?.body,
                    userOption:'',
                    userId,
                }
                aiResponce = await handleConversation(userData || null);
                break;
            case 'button':
                aiResponce = 'You selected a button option.';
                break;
            case 'interactive':
                userData = {
                    userPhone,
                    userInput:'',
                    userOption:whatsapData?.interactive?.list_reply?.id,
                    userId,
                }
                if (whatsapData?.interactive?.type === 'button_reply') {
                    aiResponce = `You selected: ${whatsapData?.interactive?.button_reply?.title}`;
                } else if (whatsapData?.interactive?.type === 'list_reply') {
                    aiResponce = await handleConversation(userData || null);
                }
                break;
            case 'audio':
                userData = whatsapData?.audio?.id;
                audioMessage = await processAudioMessage(userData || null)
               // aiResponce = audioMessage
                break;
            case 'image':
                userData = whatsapData?.image?.id;
                imagedata = await getImageUrl(userData);
               // aiResponce = await handleConversation(imagedata || null);
                break;
            default:
                return res.status(400).send('Unsupported message type.');
        }
        
        await sendMessageToWhatsApp(userPhone, aiResponce, botUser);
        res.status(200).send(botStatus?.reason);
    } catch (error) {
        console.error('Error:', error?.message);
        res.status(500).send('Internal server error');
    } 
};

const validateToken = (user, secretKey) => {
    const token = user?.verifytoken || '';
    if (!token || !secretKey) {
        return {
            valid: false,
            reason: 'Missing token or secret key',
            decoded: null,
        };
    }

    try {
        const decoded = jwt.verify(token, secretKey);
        return {
            valid: true,
            reason: 'Valid token',
            decoded,
        };
    } catch (err) {
        return {
            valid: false,
            reason: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
            decoded: null,
        };
    }
};

const sendMessageToWhatsApp = async (phoneNumber, aiResponce, botUser) => {
    try {
        let data;
        const {resp, type, mainTitle = ""} = aiResponce;
        if (type === "list") {
            const rows = resp?.map(item => ({
                id: item?._id.toString(),
                title: item?.title,
            }));
            data = JSON.stringify({
                messaging_product: 'whatsapp',
                to: phoneNumber,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    // header: {
                    //     type: 'text',
                    //     text: 'Select an Option',
                    // },
                    body: {
                        text: mainTitle,
                    },
                    action: {
                        button: 'Choose',
                        sections: [
                            {
                                rows:rows,
                            },
                        ],
                    },
                },
            });
        } else if (type === "button") {
            data = JSON.stringify({
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "interactive",
                interactive: {
                    type: "button",
                    header: {
                        type: "text",
                        text: "Choose an Option"
                    },
                    body: {
                        text: "Select one of the options below:"
                    },
                    action: {
                        buttons: options?.map((option, index) => ({
                            type: "reply",
                            reply: {
                                id: `option_${index + 1}`,
                                title: option.title
                            }
                        }))
                    }
                }
            });
        } else {
            data = JSON.stringify({
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "text",
                text: {
                    body: resp
                }
            });
        }

        const config = {
            headers: {
                Authorization: `Bearer ${botUser?.accesstoken}`,
                "Content-Type": "application/json"
            }
        };

        await axios.post(`${baseUrl}/${botUser?.phonenumberid}/messages`, data, config);
    } catch (error) {
        data = JSON.stringify({
            messaging_product: "whatsapp",
            to: phoneNumber,
            type: "text",
            text: {
                body: 'Give me a sec...'
            }
        });
        console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    }
};

const getMediaData = async (audiId) => {
    try {
        const url = `${baseUrl}/${audiId}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
            responseType: 'stream',
        });

        const filePath = './outputnew.ogg'; 
        response?.data.pipe(fs.createWriteStream(filePath));
        console.log('File downloaded successfully!');

        console.log(response?.data.url)

        return response?.data;
       
    } catch (error) {
        console.error('Error retrieving media file URL:', error.message);
        throw new Error('Failed to get media file URL.');
    }
};

const processAudioMessage = async (audiId) => {
    try {
        const audioFile = await getMediaData(audiId);

        function handleTextConversion(error, text) {
            if (error) {
                console.error("Error converting speech to text:", error);
            } else {
                console.log("Recognized Text:", text);
                return text;
            }
        }
        // playTextToSpeech('halo i hop you are doin well i love you umma umma ')
        // console.log(media,'mediamediamediamediamediamediamediamediamediamedia')
        // processAudioWithAzureSTT(voiceStream);

    } catch (error) {
        console.error('Error processing audio message:', error.message);
    }
};

// Function to get the image URL from WhatsApp Media ID
const getImageUrl = async (mediaId) => {
    try {
        const url = `${baseUrl}/${mediaId}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
            responseType: 'arraybuffer'
        });
        return response.data.url;
    } catch (error) {
        console.error('Error fetching image URL:', error.message);
        throw new Error('Failed to fetch image URL');
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
};



















// const axios = require('axios');
// const fs = require('fs');
// const FormData = require('form-data');
// const { whatsappAPIUrl, apiToken, webToken } = require('../../config/whatsappConfig');
// const handleConversation = require('../../services/whatsappService/whatsappService');
// const { convertVoiceToText, convertTextToVoice } = require('../../ai/voiceAssistant/voiceAssistant');

// const verifyWebhook = (req, res) => {
//     const challenge = req.query['hub.challenge'];
//     const token = req.query['hub.verify_token'];
//     if (token === webToken) {
//         res.status(200).send(challenge);
//     } else {
//         res.status(403).send('Error, invalid token');
//     }
// };

// const sendTypingIndicator = async (phoneNumber, isTyping) => {
//     try {
//         const data = {
//             messaging_product: 'whatsapp',
//             to: phoneNumber,
//             type: isTyping ? 'typing_on' : 'typing_off',
//         };

//         const config = {
//             headers: {
//                 Authorization: `Bearer ${apiToken}`,
//                 'Content-Type': 'application/json',
//             },
//         };

//         await axios.post(`${whatsappAPIUrl}/messages`, data, config);
//     } catch (error) {
//         console.error('Error sending typing indicator:', error.message);
//     }
// };

// const sendMessageToWhatsApp = async (phoneNumber, message) => {
//     try {
//         const data = {
//             messaging_product: 'whatsapp',
//             to: phoneNumber,
//             type: 'text',
//             text: { body: message },
//         };

//         const config = {
//             headers: {
//                 Authorization: `Bearer ${apiToken}`,
//                 'Content-Type': 'application/json',
//             },
//         };

//         await axios.post(`${whatsappAPIUrl}/messages`, data, config);
//     } catch (error) {
//         console.error('Error sending WhatsApp message:', error.message);
//     }
// };

// const sendAudioToWhatsApp = async (phoneNumber, filePath) => {
//     try {
//         const formData = new FormData();
//         formData.append('file', fs.createReadStream(filePath));

//         const config = {
//             headers: {
//                 Authorization: `Bearer ${apiToken}`,
//                 ...formData.getHeaders(),
//             },
//         };

//         const mediaResponse = await axios.post(`${whatsappAPIUrl}/media`, formData, config);

//         const mediaId = mediaResponse.data.id;
//         const data = {
//             messaging_product: 'whatsapp',
//             to: phoneNumber,
//             type: 'audio',
//             audio: { id: mediaId },
//         };

//         await axios.post(`${whatsappAPIUrl}/messages`, data, config);
//     } catch (error) {
//         console.error('Error sending WhatsApp audio message:', error.message);
//     } finally {
//         if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // Clean up
//     }
// };

// const handleIncomingMessage = async (req, res) => {
//     try {
//         const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
//         if (!message) return res.status(400).send('Invalid or missing message.');

//         const { from: userPhone, text, type, voice } = message;
//         let userInput = text?.body || '';

//         if (type === 'voice') {
//             const voiceUrl = voice?.media_url;
//             if (!voiceUrl) return res.status(400).send('Invalid voice message URL.');
//             userInput = await convertVoiceToText(voiceUrl);
//         }

//         await sendTypingIndicator(userPhone, true);
//         userData= {
//             userInput,
//             userPhone,
//         }

//         const aiResponse = await handleConversation(userData);

//         if (type === 'voice') {
//             const audioPath = './temp/responseAudio.wav';
//             await convertTextToVoice(aiResponse, audioPath);
//             await sendAudioToWhatsApp(userPhone, audioPath);
//         } else {
//             await sendMessageToWhatsApp(userPhone, aiResponse);
//         }

//         await sendTypingIndicator(userPhone, false);

//         res.status(200).send('Message processed successfully.');
//     } catch (error) {
//         console.error('Error handling incoming message:', error.message);
//         res.status(500).send('Internal Server Error');
//     }
// };

// module.exports = {
//     verifyWebhook,
//     handleIncomingMessage,
// };



