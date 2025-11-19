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
const fs = require('fs');
const mime = require('mime-types');
const { Storage } = require("@google-cloud/storage");
let storage;

if (process.env.NODE_ENV === 'production') {
    storage = new Storage({
        keyFilename: '/secrets/key.json', 
        projectId: process.env.GCS_PROJECT_ID,
    });
} else if (process.env.GCS_CREDENTIALS) {
    storage = new Storage({
        credentials: JSON.parse(process.env.GCS_CREDENTIALS),
        projectId: process.env.GCS_PROJECT_ID,
    });
} else {
    storage = new Storage({
        keyFilename: path.join(process.cwd(), 'gcs-key.json'),
    });
}

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mediaGroupCache = new NodeCache({ stdTTL: 60, checkperiod: 30 }); 
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

const getMediaName = async (mediaIds, accessToken) => {
    try {
        const mediaArray = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
        const filePaths = [];
        const expiryDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

        for (const mediaId of mediaArray) {
            if (!mediaId) {
                filePaths.push(null);
                continue;
            }

            const mediaResponse = await axios.get(`${baseUrl}/${mediaId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const mediaUrl = mediaResponse.data?.url;
            if (!mediaUrl) {
                filePaths.push(null);
                continue;
            }

            const fileResponse = await axios({
                url: mediaUrl,
                method: "GET",
                responseType: "stream",
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const contentType = fileResponse.headers["content-type"] || "application/octet-stream";
            const ext = mime.extension(contentType) || "bin";
            const filename = `${mediaId}.${ext}`;
            const destination = `whatsappuser/${filename}`;
            const file = bucket.file(destination);

            await new Promise((resolve, reject) => {
                fileResponse.data
                    .pipe(
                        file.createWriteStream({
                            metadata: {
                                contentType,
                                metadata: { expiryDate }
                            },
                            resumable: false,
                        })
                    )
                    .on("finish", resolve)
                    .on("error", reject);
            });

            filePaths.push(filename);
        }
        return filePaths;
    } catch (error) {
        console.error("❌ Error fetching/uploading WhatsApp media:", error.response?.data || error.message);
        return Array.isArray(mediaIds) ? mediaIds.map(() => null) : [null];
    }
};

const processMediaBatch = async (userPhone, caption, botUser, message) => {
    try {
        const allMediaName = mediaGroupCache.get(userPhone) || [];
        if (!allMediaName.length) return;

        const userInput = allMediaName.join(",") || caption || "media";

        const userData = {
            userPhone,
            profileName: message?.contacts?.[0]?.profile?.name || '',
            userInput,
            userOption: '',
            userId: botUser._id,
            whatsTimestamp: message?.messages?.[0]?.timestamp,
        };

        const aiResponse = await handleConversation(userData);
        if (aiResponse?.resp) {
            await sendMessageToWhatsApp(userPhone, aiResponse, botUser);
        }

    } catch (err) {
        console.error('❌ Error processing AI media batch', err);
    } finally {
        mediaGroupCache.del(userPhone);
        mediaGroupCache.del(`${userPhone}_pending`);
        mediaGroupCache.del(`${userPhone}_processing`);
    }
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
            case 'image':
            case 'video':
            case 'audio':
            case 'document': {
                const mediaId = whatsapData?.[type]?.id;
                const caption = whatsapData?.[type]?.caption || '';
                if (!mediaId) break;
                if (!mediaGroupCache.has(userPhone)) mediaGroupCache.set(userPhone, []);
                if (!mediaGroupCache.has(`${userPhone}_promises`)) mediaGroupCache.set(`${userPhone}_promises`, []);
                if (!mediaGroupCache.has(`${userPhone}_firstTime`)) mediaGroupCache.set(`${userPhone}_firstTime`, Date.now());
                if (mediaGroupCache.get(`${userPhone}_finalized`)) {
                    break;
                }

                const fetchAndStoreMedia = async (id) => {
                    try {
                        const mediaNames = await getMediaName(id, botUser.accesstoken);
                        const currentMedia = mediaGroupCache.get(userPhone) || [];
                        mediaGroupCache.set(userPhone, [...currentMedia, ...mediaNames.filter(Boolean)]);
                    } catch (err) {
                        console.error(`❌ Error fetching media ${id}:`, err);
                    }
                };

                const promises = mediaGroupCache.get(`${userPhone}_promises`);
                promises.push(fetchAndStoreMedia(mediaId));
                mediaGroupCache.set(`${userPhone}_promises`, promises);
                const existingIdleTimer = mediaGroupCache.get(`${userPhone}_idleTimer`);
                if (existingIdleTimer) clearTimeout(existingIdleTimer);

                const idleTimeout = 15000;
                const maxTotal = 120000;
                const elapsed = Date.now() - mediaGroupCache.get(`${userPhone}_firstTime`);

                if (elapsed >= maxTotal) {
                    // Max wait reached
                    await sendSingleMessage(
                        userPhone, 
                        botUser, 
                        `Hi ${message?.contacts?.[0]?.profile?.name || ""}. Time limit reached — proceeding with available media`, 
                    );
                    await finalizeBatch();
                    break;
                }

                const newIdleTimer = setTimeout(async () => {
                    await finalizeBatch();
                }, idleTimeout);

                mediaGroupCache.set(`${userPhone}_idleTimer`, newIdleTimer);

                async function finalizeBatch() {
                    if (mediaGroupCache.get(`${userPhone}_finalized`)) return;
                    mediaGroupCache.set(`${userPhone}_finalized`, true);
                    try {
                        await Promise.all(mediaGroupCache.get(`${userPhone}_promises`) || []);
                        const allMedia = mediaGroupCache.get(userPhone) || [];
                        if (allMedia.length > 0) {
                            if(allMedia.length > 5) {
                                await sendSingleMessage(
                                    userPhone, 
                                    botUser, 
                                    `Hi ${message?.contacts?.[0]?.profile?.name || ""}. starting the upload — some may be skipped if delayed😔.`, 
                                );
                            }
                            await processMediaBatch(userPhone, caption, botUser, message);
                        } else {
                            console.log(`🟡 No media found to process for ${userPhone}`);
                        }
                    } catch (err) {
                        console.error('❌ Error processing media batch:', err);
                    } finally {
                        mediaGroupCache.del(`${userPhone}_promises`);
                        mediaGroupCache.del(`${userPhone}_idleTimer`);
                        mediaGroupCache.del(userPhone);
                        mediaGroupCache.del(`${userPhone}_firstTime`);
                    }
                }

                break;
            }
            case 'location': {
                const location = whatsapData?.location;
                const latitude = location?.latitude;
                const longitude = location?.longitude;
                const userInput = `lat: ${latitude},  Lng: ${longitude}`;
                userData = {
                    userPhone,
                    profileName: message?.contacts?.[0]?.profile?.name || '',
                    userOption: '',
                    userInput,
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

    const { resp, type = '', mainTitle = '', FlowId = '' } = aiResponse;
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
            
            const msgArray = parseToArray(resp);
            const mediaData = await fetchFilesFromMessageParts(msgArray, FlowId, botUser._id);
            const filesToSend = Array.isArray(mediaData?.meaasgeLink) && mediaData.meaasgeLink.length && FlowId
            ? mediaData.meaasgeLink
            : msgArray;

            for (const file of filesToSend) {
                const cleanedUrl = String(file).trim();
                await sendSingleMessage(phoneNumber, botUser, cleanedUrl, FlowId);
                await delay(2500);
            }
            return;
        }

        if(data) {
            await sendWithRetry(botUser, data);
        }
        
    } catch (error) {
        console.error('❌ Error sending message:', error?.response?.data || error?.message);
    }
};

const sendSingleMessage = async (phoneNumber, botUser, singleUrl, FlowId = "") => {
    try {
        if (!phoneNumber || !botUser || !singleUrl) {
            return;
        }

        const base = {
            messaging_product: "whatsapp",
            to: phoneNumber,
        };

        const isUrl = validator.isURL(singleUrl, { require_protocol: true });
        const coordRegex = /(-?\d{1,2}\.\d+)[,\s-]+(-?\d{1,3}\.\d+)/;
        const coordMatch = singleUrl.match(coordRegex);
        let data;

        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lng = parseFloat(coordMatch[2]);
            data = {
                ...base,
                type: "location",
                location: { latitude: lat, longitude: lng },
            };
        } else if (isUrl) {
            const type = getMediaType(singleUrl);
            let mediaId = null;

            if (["image", "video", "audio", "document"].includes(type)) {
                try {
                    const fileResp = await axios.get(singleUrl, { responseType: "stream" });
                    const formData = new FormData();
                    formData.append("messaging_product", "whatsapp");
                    formData.append("file", fileResp.data, {
                        filename: singleUrl.split("/").pop().split("?")[0] || "file",
                        contentType: fileResp.headers["content-type"] || "application/octet-stream",
                    });

                    const uploadUrl = `${baseUrl}/${botUser?.phonenumberid}/media`;
                    const uploadResp = await axios.post(uploadUrl, formData, {
                        headers: {
                        Authorization: `Bearer ${botUser.accesstoken}`,
                        ...formData.getHeaders(),
                        },
                    });

                    mediaId = uploadResp?.data?.id;
                    const mId = `MFI-${mediaId}-${type}`;
                    await updateMIdByUrl(FlowId, botUser._id, singleUrl, mId);

                    data = {
                        ...base,
                        type,
                        [type]: { id: mediaId },
                    };
                } catch (uploadErr) {
                    console.error("⚠️ Media upload failed:", uploadErr?.response?.data || uploadErr.message);
                    data = {
                        ...base,
                        type: "text",
                        text: { body: singleUrl },
                    };
                }
            } else {
                data = {
                ...base,
                type: "text",
                text: { body: singleUrl },
                };
            }
        } else if (singleUrl.startsWith("MFI-")) {
            const parts = singleUrl.split("-");
            const [, mediaId, type] = parts;
            if (!mediaId || !type) {
                throw new Error(`Invalid MFI format: ${singleUrl}`);
            }
            data = {
                ...base,
                type,
                [type]: { id: mediaId },
            };
        } else {
            data = {
                ...base,
                type: "text",
                text: { body: singleUrl },
            };
        }

        if(data) {
            await sendWithRetry(botUser, data);
        }

    } catch (error) {
            console.error("❌ sendSingleMessage error:", error?.response?.data || error.message);
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

