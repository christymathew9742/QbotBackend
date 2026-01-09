// const axios = require('axios');
// const NodeCache = require('node-cache');
// const jwt = require('jsonwebtoken');
// const User = require('../../models/User');
// const path = require('path');
// const handleConversation = require('../../services/whatsappService/whatsappService');
// const { baseUrl } = require('../../config/whatsappConfig');
// const { getMediaType, fetchFilesFromMessageParts, updateMIdByUrl, parseToArray } = require('../../utils/common');
// const validator = require("validator");
// const FormData = require("form-data");
// const mime = require('mime-types');
// const { Storage } = require("@google-cloud/storage");
// const speech = require('@google-cloud/speech');

// // --- 1. CONFIGURATION & CLIENTS ---

// const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// // Unified Credential Loader (Efficient)
// const getGcpConfig = () => {
//     if (process.env.NODE_ENV === 'production') {
//         return {
//             keyFilename: '/secrets/key.json', // Cloud Run Secrets
//             projectId: process.env.GCS_PROJECT_ID,
//         };
//     } else if (process.env.GCS_CREDENTIALS) {
//         return {
//             credentials: JSON.parse(process.env.GCS_CREDENTIALS),
//             projectId: process.env.GCS_PROJECT_ID,
//         };
//     } else {
//         return {
//             keyFilename: path.join(process.cwd(), 'gcs-key.json'), // Local Dev
//         };
//     }
// };

// const gcpConfig = getGcpConfig();
// const storage = new Storage(gcpConfig);
// const speechClient = new speech.SpeechClient(gcpConfig);
// const bucket = storage.bucket(GCS_BUCKET_NAME);

// // Caches
// const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // Deduplication
// const mediaGroupCache = new NodeCache({ stdTTL: 60, checkperiod: 30 }); // Batching

// const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// const MAX_RETRIES = 3;
// const RETRY_DELAY_MS = 1000;

// // --- 2. WEBHOOK VERIFICATION (Standard) ---
// const verifyWebhook = async (req, res) => {
//     const challenge = req.query['hub.challenge'];
//     const token = req.query['hub.verify_token'];
//     const isRecord = await User.findOne({ verifytoken: token });
//     console.log('veryfication done')
//     return isRecord ? res.status(200).send(challenge) : res.status(403).send('Invalid verify token');
// };

// // --- 3. MAIN HANDLER (OPTIMIZED FOR SPEED & COST) ---
// const handleIncomingMessage = async (req, res) => {
//     console.log('Incoming WhatsApp Webhook:', JSON.stringify(req.body));
//     // 🔥 STEP 1: ACKNOWLEDGE INSTANTLY (SAVES $$$)
//     // We send 200 OK immediately. This stops Meta from resending the message
//     // and prevents double-billing on Vertex/Speech APIs.
//     res.sendStatus(200); 

//     try {
//         const entry = req.body?.entry?.[0];
//         const changes = entry?.changes?.[0];
//         const message = changes?.value || {};
//         const whatsapData = message?.messages?.[0];
// console.log('Received WhatsApp message:', JSON.stringify(whatsapData));
//         // Basic validation
//         if (!whatsapData) return; // Nothing to do

//         const messageId = whatsapData.id;
//         const userPhone = whatsapData.from;

//         // 🔥 STEP 2: DEDUPLICATION
//         // Even with immediate 200 OK, network glitches happen. check cache.
//         if (messageCache.get(messageId)) {
//             console.log(`⚠️ Duplicate prevented: ${messageId}`);
//             return;
//         }
//         messageCache.set(messageId, true);

//         // Filter out status updates / echoes
//         const businessPhone = message?.metadata?.display_phone_number || message?.metadata?.phone_number_id;
//         if (userPhone === businessPhone) return;

//         // Check timestamp (don't process messages older than 2 mins)
//         const now = Date.now() / 1000;
//         const msgTimestamp = parseInt(whatsapData.timestamp || '0', 10);
//         if (now - msgTimestamp > 120) {
//             console.log('⏱️ Skipping old message');
//             return;
//         }

//         // 🔥 STEP 3: PROCESS IN BACKGROUND (Async)
//         // We do not await this. Logic runs while response is already sent.
//         processBackgroundMessage(whatsapData, message, userPhone).catch(err => {
//             console.error(`❌ Background Process Error [${userPhone}]:`, err.message);
//         });

//     } catch (error) {
//         // Just log, response is already sent.
//         console.error('❌ Webhook ingestion error:', error.message);
//     }
// };

// // --- 4. BACKGROUND LOGIC (The Heavy Lifting) ---
// // This runs AFTER the 200 OK is sent.
// const processBackgroundMessage = async (whatsapData, message, userPhone) => {
    
//     // Database Lookup
//     const phoneNumberId = message?.metadata?.phone_number_id;
//     console.log(phoneNumberId,'phoneNumberIdphoneNumberIdphoneNumberId')
//     const botUser = await User.findOne({ phonenumberid: phoneNumberId });
    
//     if (!botUser) {
//         console.log(`🚫 Unknown Bot ID: ${phoneNumberId}`);
//         return;
//     }
// console.log(botUser,'botUserbotUserbotUser')
//     const botStatus = validateToken(botUser, process.env.JWT_SECRET);
//     if (!botStatus.valid) {
//         console.log(`🚫 Invalid Token for bot: ${botStatus.reason}`);
//         return;
//     }

//     const type = whatsapData.type;
//     let aiResponse = null;
//     let userData;

//     // --- MESSAGE TYPE HANDLING ---

//     switch (type) {
//         case 'text': {
//             const body = whatsapData.text?.body?.trim();
//             userData = buildUserData(userPhone, message, body, '', botUser, whatsapData.timestamp);
//             aiResponse = await handleConversation(userData);
//             break;
//         }

//         case 'interactive': {
//             const interactiveType = whatsapData.interactive?.type;
//             const selectedOption = interactiveType === 'list_reply'
//                 ? whatsapData.interactive.list_reply.id
//                 : whatsapData.interactive.button_reply.id;

//             userData = buildUserData(userPhone, message, '', selectedOption, botUser, whatsapData.timestamp);
//             aiResponse = await handleConversation(userData);
//             break;
//         }

//         case 'audio': {
//             const mediaId = whatsapData.audio?.id;
//             const isVoiceNote = whatsapData.audio?.voice === true;

//             if (isVoiceNote && mediaId) {
//                 // Audio Processing
//                 const mediaNames = await getMediaName(mediaId, botUser.accesstoken);
//                 const fileName = mediaNames[0];

//                 if (fileName) {
//                     const gcsUri = `gs://${GCS_BUCKET_NAME}/whatsappuser/${fileName}`;
//                     // Cost Note: This calls Google Speech API. Since we Ack'd early, 
//                     // user sees "typing..." instead of a timeout error.
//                     const transcribedText = await transcribeAudio(gcsUri);

//                     if (transcribedText) {
//                         userData = buildUserData(userPhone, message, transcribedText, '', botUser, whatsapData.timestamp);
//                         aiResponse = await handleConversation(userData);
//                     } else {
//                         await sendSingleMessage(userPhone, botUser, "⚠️ I couldn't hear that clearly. Could you type it?");
//                     }
//                 }
//             } else {
//                 // It's an audio file, not a voice note -> Treat as media batch
//                 await handleMediaBatch(type, whatsapData, userPhone, message, botUser);
//             }
//             break;
//         }

//         case 'image':
//         case 'video':
//         case 'document': {
//             await handleMediaBatch(type, whatsapData, userPhone, message, botUser);
//             break;
//         }

//         case 'location': {
//             const { latitude, longitude } = whatsapData.location;
//             const input = `lat: ${latitude}, Lng: ${longitude}`;
//             userData = buildUserData(userPhone, message, input, '', botUser, whatsapData.timestamp);
//             aiResponse = await handleConversation(userData);
//             break;
//         }
        
//         default:
//             console.log(`Unsupported type: ${type}`);
//     }

//     // Send the final AI reply back to user
//     if (aiResponse?.resp) {
//         await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
//     }
// };

// // --- 5. BATCH MEDIA LOGIC (Preserved & Optimized) ---

// const handleMediaBatch = async (type, whatsapData, userPhone, message, botUser) => {
//     const mediaId = whatsapData?.[type]?.id;
//     const caption = whatsapData?.[type]?.caption || '';
//     if (!mediaId) return;

//     if (!mediaGroupCache.has(userPhone)) mediaGroupCache.set(userPhone, []);
//     if (!mediaGroupCache.has(`${userPhone}_promises`)) mediaGroupCache.set(`${userPhone}_promises`, []);
//     if (!mediaGroupCache.has(`${userPhone}_firstTime`)) mediaGroupCache.set(`${userPhone}_firstTime`, Date.now());
    
//     // If we already finalized this batch, ignore stragglers
//     if (mediaGroupCache.get(`${userPhone}_finalized`)) return;

//     // Add download task to array
//     const downloadTask = async () => {
//         try {
//             const mediaNames = await getMediaName(mediaId, botUser.accesstoken);
//             const current = mediaGroupCache.get(userPhone) || [];
//             mediaGroupCache.set(userPhone, [...current, ...mediaNames.filter(Boolean)]);
//         } catch (e) { console.error("Media DL failed", e.message); }
//     };

//     const promises = mediaGroupCache.get(`${userPhone}_promises`);
//     promises.push(downloadTask());
//     mediaGroupCache.set(`${userPhone}_promises`, promises);

//     // Reset Timer
//     const existingTimer = mediaGroupCache.get(`${userPhone}_idleTimer`);
//     if (existingTimer) clearTimeout(existingTimer);

//     // Hard Stop (2 mins)
//     const elapsed = Date.now() - mediaGroupCache.get(`${userPhone}_firstTime`);
//     if (elapsed >= 120000) {
//         await sendSingleMessage(userPhone, botUser, `Processing what I have so far...`);
//         await finalizeBatch(userPhone, caption, botUser, message);
//         return;
//     }

//     // Wait 15 seconds for more photos
//     const newTimer = setTimeout(async () => {
//         await finalizeBatch(userPhone, caption, botUser, message);
//     }, 15000);

//     mediaGroupCache.set(`${userPhone}_idleTimer`, newTimer);
// };

// const finalizeBatch = async (userPhone, caption, botUser, message) => {
//     if (mediaGroupCache.get(`${userPhone}_finalized`)) return;
//     mediaGroupCache.set(`${userPhone}_finalized`, true);

//     try {
//         await Promise.all(mediaGroupCache.get(`${userPhone}_promises`) || []);
//         const allMedia = mediaGroupCache.get(userPhone) || [];

//         if (allMedia.length > 0) {
//             if (allMedia.length > 5) {
//                 await sendSingleMessage(userPhone, botUser, `Received ${allMedia.length} files. Analyzing...`);
//             }
            
//             // Re-use logic for AI processing
//             const userInput = allMedia.join(",") || caption || "media";
//             const userData = buildUserData(userPhone, message, userInput, '', botUser, message?.messages?.[0]?.timestamp);
            
//             const aiResponse = await handleConversation(userData);
//             if (aiResponse?.resp) {
//                 await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
//             }
//         }
//     } catch (err) {
//         console.error('Batch Error:', err);
//     } finally {
//         // Cleanup
//         mediaGroupCache.del(`${userPhone}_promises`);
//         mediaGroupCache.del(`${userPhone}_idleTimer`);
//         mediaGroupCache.del(userPhone);
//         mediaGroupCache.del(`${userPhone}_firstTime`);
//         mediaGroupCache.del(`${userPhone}_finalized`);
//     }
// };

// // --- 6. UTILITIES (Helpers) ---

// const buildUserData = (phone, message="", input="", option="", botUser, ts="") => ({
//     userPhone: phone,
//     profileName: message?.contacts?.[0]?.profile?.name || '',
//     userInput: input,
//     userOption: option,
//     userId: botUser._id,
//     whatsTimestamp: ts,
// });

// const validateToken = (user, secretKey) => {
//     const token = user?.verifytoken || '';
//     if (!token || !secretKey) return { valid: false, reason: 'Missing Config' };
//     try {
//         jwt.verify(token, secretKey);
//         return { valid: true };
//     } catch (err) {
//         return { valid: false, reason: 'Token Invalid' };
//     }
// };

// const getMediaName = async (mediaIds, accessToken) => {
//     const mediaArray = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
//     const filePaths = [];
//     const expiryDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

//     for (const mediaId of mediaArray) {
//         if (!mediaId) continue;
//         try {
//             const { data } = await axios.get(`${baseUrl}/${mediaId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
//             if (!data?.url) continue;

//             const fileResp = await axios({ url: data.url, method: "GET", responseType: "stream", headers: { Authorization: `Bearer ${accessToken}` } });
            
//             const contentType = fileResp.headers["content-type"] || "application/octet-stream";
//             const ext = mime.extension(contentType) || "bin";
//             const filename = `${mediaId}.${ext}`;
//             const file = bucket.file(`whatsappuser/${filename}`);

//             await new Promise((resolve, reject) => {
//                 fileResp.data.pipe(file.createWriteStream({
//                     metadata: { contentType, metadata: { expiryDate } },
//                     resumable: false
//                 })).on("finish", resolve).on("error", reject);
//             });
//             filePaths.push(filename);
//         } catch (e) {
//             console.error(`Media fetch failed [${mediaId}]:`, e.message);
//         }
//     }
//     return filePaths;
// };

// const transcribeAudio = async (gcsUri) => {
//     try {
//         const [response] = await speechClient.recognize({
//             audio: { uri: gcsUri },
//             config: { encoding: 'OGG_OPUS', sampleRateHertz: 16000, languageCode: 'en-US', enableAutomaticPunctuation: true }
//         });
//         return response.results.map(result => result.alternatives[0].transcript).join('\n');
//     } catch (error) {
//         console.error("STT Error:", error.message);
//         return null;
//     }
// };

// // --- 7. SENDING MESSAGES (Retries included) ---

// const sendMessageToWhatsApp = async (phoneNumber, aiResponse, botUser) => {
//     if (!phoneNumber || !aiResponse || !aiResponse.type) return;
//     const { resp, type, mainTitle, FlowId } = aiResponse;

//     try {
//         let data = null;

//         if (type === 'list') {
//             const rows = (resp || []).map(i => ({ id: i._id?.toString(), title: i.title }));
//             data = {
//                 messaging_product: 'whatsapp', to: phoneNumber, type: 'interactive',
//                 interactive: { type, body: { text: mainTitle || 'Choose:' }, action: { button: 'Options', sections: [{ title: 'Menu', rows }] } }
//             };
//         } 
//         else if (type === 'button') {
//             const buttons = (resp || []).slice(0, 3).map(o => ({ type: 'reply', reply: { id: String(o._id), title: String(o.title) } }));
//             data = {
//                 messaging_product: 'whatsapp', to: phoneNumber, type: 'interactive',
//                 interactive: { type, body: { text: mainTitle || 'Select:' }, action: { buttons } }
//             };
//         } 
//         else if (type === 'text') {
//             const msgArray = parseToArray(resp);
//             const mediaData = await fetchFilesFromMessageParts(msgArray, FlowId, botUser._id);
//             const files = (mediaData?.meaasgeLink?.length) ? mediaData.meaasgeLink : msgArray;

//             for (const item of files) {
//                 await sendSingleMessage(phoneNumber, botUser, String(item).trim(), FlowId);
//                 if (files.length > 1) await delay(1000); // Small delay between multiple messages
//             }
//             console.log('media triggering here')
//             return; 
//         }

//         if (data) await sendWithRetry(botUser, data);
//     } catch (e) {
//         console.error('Send Logic Error:', e.message);
//     }
// };

// const sendSingleMessage = async (phoneNumber, botUser, content, FlowId = "") => {
//     if (!content) return;
//     const base = { messaging_product: "whatsapp", to: phoneNumber };
//     let data;

//     // Detect Coordinates
//     const coordMatch = content.match(/(-?\d{1,2}\.\d+)[,\s-]+(-?\d{1,3}\.\d+)/);
    
//     // Detect Media URL
//     const isUrl = validator.isURL(content, { require_protocol: true });
    
//     if (coordMatch) {
//         data = { ...base, type: "location", location: { latitude: parseFloat(coordMatch[1]), longitude: parseFloat(coordMatch[2]) } };
//     } 
//     else if (isUrl) {
//         // ... (Your existing media upload logic is preserved here to keep flow intact) ...
//         // Simplified for brevity, but logically identical to your original code
//         const type = getMediaType(content);
//         if (["image", "video", "audio", "document"].includes(type)) {
//             try {
//                 // Upload URL to Meta Logic (Preserved)
//                 const fileResp = await axios.get(content, { responseType: "stream" });
//                 const form = new FormData();
//                 form.append("messaging_product", "whatsapp");
//                 form.append("file", fileResp.data, { filename: "file", contentType: fileResp.headers["content-type"] });
                
//                 const upHeaders = { Authorization: `Bearer ${botUser.accesstoken}`, ...form.getHeaders() };
//                 const upResp = await axios.post(`${baseUrl}/${botUser.phonenumberid}/media`, form, { headers: upHeaders });
                
//                 if(FlowId) await updateMIdByUrl(FlowId, botUser._id, content, `MFI-${upResp.data.id}-${type}`);
//                 data = { ...base, type, [type]: { id: upResp.data.id } };
//             } catch (e) {
//                 // Fallback to text link
//                 data = { ...base, type: "text", text: { body: content } }; 
//             }
//         } else {
//             data = { ...base, type: "text", text: { body: content } };
//         }
//     } else if (content.startsWith("MFI-")) {
//         const [, id, t] = content.split("-");
//         data = { ...base, type: t, [t]: { id } };
//     } else {
//         data = { ...base, type: "text", text: { body: content } };
//     }

//     if (data) await sendWithRetry(botUser, data);
//     console.log(data.type + " message sent to " + phoneNumber);

//     if(data.type !== "text") {
//         userData = buildUserData(phoneNumber, message, 'trigger', '', botUser);
//         aiResponse = await handleConversation(userData);
//     }
// };

// const sendWithRetry = async (botUser, data) => {
//     const url = `${baseUrl}/${botUser.phonenumberid}/messages`;
//     for (let i = 1; i <= MAX_RETRIES; i++) {
//         try {
//             await axios.post(url, data, { headers: { Authorization: `Bearer ${botUser.accesstoken}` } });
//             return;
//         } catch (e) {
//             if (i === MAX_RETRIES) console.error(`Failed to send to ${data.to}:`, e.message);
//             await delay(RETRY_DELAY_MS);
//         }
//     }
// };

// module.exports = { verifyWebhook, handleIncomingMessage };



const axios = require('axios');
const NodeCache = require('node-cache');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const path = require('path');
const handleConversation = require('../../services/whatsappService/whatsappService');
const { baseUrl } = require('../../config/whatsappConfig');
const { getMediaType, fetchFilesFromMessageParts, updateMIdByUrl, parseToArray } = require('../../utils/common');
const validator = require("validator");
const FormData = require("form-data");
const mime = require('mime-types');
const { Storage } = require("@google-cloud/storage");
const speech = require('@google-cloud/speech');


const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const ENABLE_STT = process.env.ENABLE_STT === true || false; 

const getGcpConfig = () => {
    if (process.env.NODE_ENV === 'production') {
        return {
            keyFilename: '/secrets/key.json',
            projectId: process.env.GCS_PROJECT_ID,
        };
    } else if (process.env.GCS_CREDENTIALS) {
        return {
            credentials: JSON.parse(process.env.GCS_CREDENTIALS),
            projectId: process.env.GCS_PROJECT_ID,
        };
    } else {
        return {
            keyFilename: path.join(process.cwd(), 'gcs-key.json'),
        };
    }
};

const gcpConfig = getGcpConfig();
const storage = new Storage(gcpConfig);
const speechClient = new speech.SpeechClient(gcpConfig);
const bucket = storage.bucket(GCS_BUCKET_NAME);
const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const mediaGroupCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const verifyWebhook = async (req, res) => {
    const challenge = req.query['hub.challenge'];
    const token = req.query['hub.verify_token'];
    const isRecord = await User.findOne({ verifytoken: token });
    return isRecord ? res.status(200).send(challenge) : res.status(403).send('Invalid verify token');
};

const handleIncomingMessage = async (req, res) => {
    res.sendStatus(200); 

    try {
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value || {};
        const whatsapData = message?.messages?.[0];

        if (!whatsapData) return;

        const messageId = whatsapData.id;
        const userPhone = whatsapData.from;

        if (messageCache.get(messageId)) {
            return;
        }
        messageCache.set(messageId, true);

        const businessPhone = message?.metadata?.display_phone_number || message?.metadata?.phone_number_id;
        if (userPhone === businessPhone) return;

        const now = Date.now() / 1000;
        const msgTimestamp = parseInt(whatsapData.timestamp || '0', 10);
        if (now - msgTimestamp > 120) {
            return;
        }

        processBackgroundMessage(whatsapData, message, userPhone).catch(err => {
            console.error(`❌ Background Process Error [${userPhone}]:`, err.message);
        });

    } catch (error) {
        console.error('❌ Webhook ingestion error:', error.message);
    }
};

const processBackgroundMessage = async (whatsapData, message, userPhone) => {
    
    const phoneNumberId = message?.metadata?.phone_number_id;
    const botUser = await User.findOne({ phonenumberid: phoneNumberId });
    
    if (!botUser) {
        return;
    }

    const botStatus = validateToken(botUser, process.env.JWT_SECRET);
    if (!botStatus.valid) {
        console.log(`🚫 Invalid Token for bot: ${botStatus.reason}`);
        return;
    }

    const type = whatsapData.type;
    let aiResponse = null;
    let userData;

    switch (type) {
        case 'text': {
            const body = whatsapData.text?.body?.trim();
            userData = buildUserData(userPhone, message, body, '', botUser, whatsapData.timestamp);
            aiResponse = await handleConversation(userData);
            break;
        }

        case 'interactive': {
            const interactiveType = whatsapData.interactive?.type;
            const selectedOption = interactiveType === 'list_reply'
                ? whatsapData.interactive.list_reply.id
                : whatsapData.interactive.button_reply.id;

            userData = buildUserData(userPhone, message, '', selectedOption, botUser, whatsapData.timestamp);
            aiResponse = await handleConversation(userData);
            break;
        }

        case 'audio': {
            const mediaId = whatsapData.audio?.id;
            const isVoiceNote = whatsapData.audio?.voice === true;

            if (isVoiceNote && mediaId) {
                if (ENABLE_STT) {
                    const mediaNames = await getMediaName(mediaId, botUser.accesstoken);
                    const fileName = mediaNames[0];

                    if (fileName) {
                        const gcsUri = `gs://${GCS_BUCKET_NAME}/whatsappuser/${fileName}`;
                        const transcribedText = await transcribeAudio(gcsUri);

                        if (transcribedText) {
                            userData = buildUserData(userPhone, message, transcribedText, '', botUser, whatsapData.timestamp);
                            aiResponse = await handleConversation(userData);
                        } else {
                            await sendSingleMessage(userPhone, botUser, "⚠️ I couldn't hear that clearly. Could you type it?");
                        }
                    }
                } else {
                    await sendSingleMessage(userPhone, botUser, "🎤 I cannot recognize voice messages. Please type your message.");
                    return; 
                }
            } else {
                await handleMediaBatch(type, whatsapData, userPhone, message, botUser);
            }
            break;
        }

        case 'image':
        case 'video':
        case 'document': {
            await handleMediaBatch(type, whatsapData, userPhone, message, botUser);
            break;
        }

        case 'location': {
            const { latitude, longitude } = whatsapData.location;
            const input = `lat: ${latitude}, Lng: ${longitude}`;
            userData = buildUserData(userPhone, message, input, '', botUser, whatsapData.timestamp);
            aiResponse = await handleConversation(userData);
            break;
        }
        
        default:
            console.log(`Unsupported type: ${type}`);
    }

    if (aiResponse?.resp) {
        await sendMessageToWhatsApp(userPhone, aiResponse, botUser, message);
    }
};

const handleMediaBatch = async (type, whatsapData, userPhone, message, botUser) => {
    const mediaId = whatsapData?.[type]?.id;
    const caption = whatsapData?.[type]?.caption || '';
    if (!mediaId) return;

    if (!mediaGroupCache.has(userPhone)) mediaGroupCache.set(userPhone, []);
    if (!mediaGroupCache.has(`${userPhone}_promises`)) mediaGroupCache.set(`${userPhone}_promises`, []);
    if (!mediaGroupCache.has(`${userPhone}_firstTime`)) mediaGroupCache.set(`${userPhone}_firstTime`, Date.now());
    
    if (mediaGroupCache.get(`${userPhone}_finalized`)) return;

    const downloadTask = async () => {
        try {
            const mediaNames = await getMediaName(mediaId, botUser.accesstoken);
            const current = mediaGroupCache.get(userPhone) || [];
            mediaGroupCache.set(userPhone, [...current, ...mediaNames.filter(Boolean)]);
        } catch (e) { console.error("Media DL failed", e.message); }
    };

    const promises = mediaGroupCache.get(`${userPhone}_promises`);
    promises.push(downloadTask());
    mediaGroupCache.set(`${userPhone}_promises`, promises);

    const existingTimer = mediaGroupCache.get(`${userPhone}_idleTimer`);
    if (existingTimer) clearTimeout(existingTimer);

    const elapsed = Date.now() - mediaGroupCache.get(`${userPhone}_firstTime`);
    if (elapsed >= 120000) {
        await sendSingleMessage(userPhone, botUser, `Processing what I have so far...`);
        await finalizeBatch(userPhone, caption, botUser, message);
        return;
    }

    const newTimer = setTimeout(async () => {
        await finalizeBatch(userPhone, caption, botUser, message);
    }, 15000);

    mediaGroupCache.set(`${userPhone}_idleTimer`, newTimer);
};

const finalizeBatch = async (userPhone, caption, botUser, message) => {
    if (mediaGroupCache.get(`${userPhone}_finalized`)) return;
    mediaGroupCache.set(`${userPhone}_finalized`, true);

    try {
        await Promise.all(mediaGroupCache.get(`${userPhone}_promises`) || []);
        const allMedia = mediaGroupCache.get(userPhone) || [];

        if (allMedia.length > 0) {
            if (allMedia.length > 5) {
                await sendSingleMessage(userPhone, botUser, `Received ${allMedia.length} files. Analyzing...`);
            }
            
            const userInput = allMedia.join(",") || caption || "media";
            const userData = buildUserData(userPhone, message, userInput, '', botUser, message?.messages?.[0]?.timestamp);
            
            const aiResponse = await handleConversation(userData);
            if (aiResponse?.resp) {
                await sendMessageToWhatsApp(userPhone, aiResponse, botUser, message);
            }
        }
    } catch (err) {
        console.error('Batch Error:', err);
    } finally {
        mediaGroupCache.del(`${userPhone}_promises`);
        mediaGroupCache.del(`${userPhone}_idleTimer`);
        mediaGroupCache.del(userPhone);
        mediaGroupCache.del(`${userPhone}_firstTime`);
        mediaGroupCache.del(`${userPhone}_finalized`);
    }
};

const buildUserData = (phone, message="", input="", option="", botUser, ts="") => ({
    userPhone: phone,
    profileName: message?.contacts?.[0]?.profile?.name || '',
    userInput: input,
    userOption: option,
    userId: botUser._id,
    whatsTimestamp: ts,
});

const validateToken = (user, secretKey) => {
    const token = user?.verifytoken || '';
    if (!token || !secretKey) return { valid: false, reason: 'Missing Config' };
    try {
        jwt.verify(token, secretKey);
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: 'Token Invalid' };
    }
};

const getMediaName = async (mediaIds, accessToken) => {
    const mediaArray = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
    const filePaths = [];
    const expiryDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

    for (const mediaId of mediaArray) {
        if (!mediaId) continue;
        try {
            const { data } = await axios.get(`${baseUrl}/${mediaId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
            if (!data?.url) continue;

            const fileResp = await axios({ url: data.url, method: "GET", responseType: "stream", headers: { Authorization: `Bearer ${accessToken}` } });
            const contentType = fileResp.headers["content-type"] || "application/octet-stream";
            const ext = mime.extension(contentType) || "bin";
            const filename = `${mediaId}.${ext}`;
            const file = bucket.file(`whatsappuser/${filename}`);

            await new Promise((resolve, reject) => {
                fileResp.data.pipe(file.createWriteStream({
                    metadata: { contentType, metadata: { expiryDate } },
                    resumable: false
                })).on("finish", resolve).on("error", reject);
            });
            filePaths.push(filename);
        } catch (e) {
            console.error(`Media fetch failed [${mediaId}]:`, e.message);
        }
    }
    return filePaths;
};

const transcribeAudio = async (gcsUri) => {
    try {
        const [response] = await speechClient.recognize({
            audio: { uri: gcsUri },
            config: { encoding: 'OGG_OPUS', sampleRateHertz: 16000, languageCode: 'en-US', enableAutomaticPunctuation: true }
        });
        return response.results.map(result => result.alternatives[0].transcript).join('\n');
    } catch (error) {
        console.error("STT Error:", error.message);
        return null;
    }
};

const sendMessageToWhatsApp = async (phoneNumber, aiResponse, botUser, originalMessage) => {
    if (!phoneNumber || !aiResponse || !aiResponse.type) return;
    const { resp, type, mainTitle, FlowId } = aiResponse;

    try {
        let data = null;

        if (type === 'list') {
            const rows = (resp || []).map(i => ({ id: i._id?.toString(), title: i.title }));
            data = {
                messaging_product: 'whatsapp', to: phoneNumber, type: 'interactive',
                interactive: { type, body: { text: mainTitle || 'Choose:' }, action: { button: 'Options', sections: [{ title: 'Menu', rows }] } }
            };
        } 
        else if (type === 'button') {
            const buttons = (resp || []).slice(0, 3).map(o => ({ type: 'reply', reply: { id: String(o._id), title: String(o.title) } }));
            data = {
                messaging_product: 'whatsapp', to: phoneNumber, type: 'interactive',
                interactive: { type, body: { text: mainTitle || 'Select:' }, action: { buttons } }
            };
        } 
        else if (type === 'text') {
            const msgArray = parseToArray(resp);
            const mediaData = await fetchFilesFromMessageParts(msgArray, FlowId, botUser._id);
            const files = (mediaData?.meaasgeLink?.length) ? mediaData.meaasgeLink : msgArray;

            // 🔥🔥 OPTIMIZED LOOP: Wait for ALL messages to send 🔥🔥
            let lastSentType = 'text';

            for (const item of files) {
                // Returns 'image', 'video', 'location', or 'text'
                const sentType = await sendSingleMessage(phoneNumber, botUser, String(item).trim(), FlowId);
                
                if (sentType) lastSentType = sentType;

                if (files.length > 1) await delay(1000); 
            }

            if (['image', 'video', 'audio', 'document', 'location'].includes(lastSentType)) {
                await triggerNextStep(phoneNumber, botUser, originalMessage);
            }
            return; 
        }

        if (data) await sendWithRetry(botUser, data);
    } catch (e) {
        console.error('Send Logic Error:', e.message);
    }
};

// Helper to trigger the AI "silently"
const triggerNextStep = async (phoneNumber, botUser, originalMessage) => {
    try {
        const dummyUserData = buildUserData(phoneNumber, originalMessage, '', '', botUser);
        const nextResponse = await handleConversation(dummyUserData);
        if (nextResponse?.resp) {
            // Recursive call to handle the next set of messages
            await sendMessageToWhatsApp(phoneNumber, nextResponse, botUser, originalMessage);
        }
    } catch (err) {
        console.error(`⚠️ Auto-Trigger Error:`, err.message);
    }
};

const sendSingleMessage = async (phoneNumber, botUser, content, FlowId = "") => {
    if (!content) return null;
    const base = { messaging_product: "whatsapp", to: phoneNumber };
    let data;

    // Detect Coordinates
    const coordMatch = content.match(/(-?\d{1,2}\.\d+)[,\s-]+(-?\d{1,3}\.\d+)/);
    // Detect Media URL
    const isUrl = validator.isURL(content, { require_protocol: true });
    
    if (coordMatch) {
        data = { ...base, type: "location", location: { latitude: parseFloat(coordMatch[1]), longitude: parseFloat(coordMatch[2]) } };
    } 
    else if (isUrl) {
        const type = getMediaType(content);
        if (["image", "video", "audio", "document"].includes(type)) {
            try {
                // Stream & Upload
                const fileResp = await axios.get(content, { responseType: "stream" });
                const form = new FormData();
                form.append("messaging_product", "whatsapp");
                form.append("file", fileResp.data, { filename: "file", contentType: fileResp.headers["content-type"] });
                
                const upHeaders = { Authorization: `Bearer ${botUser.accesstoken}`, ...form.getHeaders() };
                const upResp = await axios.post(`${baseUrl}/${botUser.phonenumberid}/media`, form, { headers: upHeaders });
                
                if(FlowId) await updateMIdByUrl(FlowId, botUser._id, content, `MFI-${upResp.data.id}-${type}`);
                data = { ...base, type, [type]: { id: upResp.data.id } };
            } catch (e) {
                // Fallback to text
                console.error(`Media upload failed (${content}), sending text.`);
                data = { ...base, type: "text", text: { body: content } }; 
            }
        } else {
            data = { ...base, type: "text", text: { body: content } };
        }
    } else if (content.startsWith("MFI-")) {
        const [, id, t] = content.split("-");
        data = { ...base, type: t, [t]: { id } };
    } else {
        data = { ...base, type: "text", text: { body: content } };
    }

    if (data) {
        await sendWithRetry(botUser, data);
        return data.type; 
    }
    return null;
};

const sendWithRetry = async (botUser, data) => {
    const url = `${baseUrl}/${botUser.phonenumberid}/messages`;
    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            await axios.post(url, data, { headers: { Authorization: `Bearer ${botUser.accesstoken}` } });
            return;
        } catch (e) {
            if (i === MAX_RETRIES) console.error(`Failed to send to ${data.to}:`, e.message);
            await delay(RETRY_DELAY_MS);
        }
    }
};

module.exports = { 
    verifyWebhook, 
    handleIncomingMessage 
};
