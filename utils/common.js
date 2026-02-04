const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
const trailingJsonRegex = /(?:\s*)({[\s\S]*}|\[[\s\S]*\])\s*$/;
const jwt = require('jsonwebtoken');
const AppointmentModal = require('../models/AppointmentModal');
const validator = require("validator");
const mongoose = require("mongoose");
const { ChatBotModel } = require('../models/chatBotModel/chatBotModel');
const { customAlphabet } = require('nanoid');
const generateId = customAlphabet('BCDFGHJKMNPQRSTVWXYZ23456789', 6); 


function cleanAIResponse(response) {
    if (typeof response !== 'string' || !response.trim()) return '';

    // Remove AI: prefix
    let cleaned = response.replace(/^AI:\s*/i, '').trim();

    // Remove all ```json ... ``` blocks
    cleaned = cleaned.replace(jsonBlockRegex, '').trim();

    // Remove trailing JSON object or array
    cleaned = cleaned.replace(trailingJsonRegex, '').trim();

    return cleaned;
}

function extractMandatoryFieldsFromFlow(flowTrainingData) {
    const fieldSet = new Set();
    const optionObjects = [];
  
    flowTrainingData?.nodes?.forEach((node) => {
        node?.data?.inputs?.forEach((input) => {
            if (input?.field === 'replay') {
                const matches = input.value.match(/\[([^\]]+)\]/g);
                matches?.forEach((match) => {
                    const fieldName = match.replace(/[\[\]]/g, '').trim();
                    if (fieldName) fieldSet.add(fieldName);
                });
            } else if (input?.field === 'preference') {
                input?.options?.forEach((opt, i) => {
                    if (i > 0) {
                    optionObjects.push({
                        id: opt?.id,
                        value: opt?.value?.trim()
                    });
                    }
                });
            }
        });
    });
  
    const result = Array.from(fieldSet);
        if (optionObjects.length > 0) {
        result.push({
            field: 'preference',
            preferenceOptions: optionObjects
        });
    }
  
    return result;
}

const validateToken = (token) => {
    const secretKey = process.env.JWT_SECRET
    if (!token || !secretKey) {
        return {
            hastocken: false,
            reason: 'Missing token or secret key',
            decoded: null,
            isExpired: true,
            expTime: null,
            remaining: null,
            expiryPercentage: null,
        };
    }

    try {
        const decoded = jwt.verify(token, secretKey);
        const now = Math.floor(Date.now() / 1000); 
        const { exp, iat } = decoded;

        const totalLifespan = exp - iat;
        const remainingSeconds = exp - now;
        const isExpired = remainingSeconds <= 0;
        const expiryPercentage = totalLifespan > 0
            ? `${((1 - remainingSeconds / totalLifespan) * 100).toFixed(2)}%`
            : null;

        let remaining;
        if (isExpired) {
            remaining = 'Expired';
        } else if (remainingSeconds >= 86400) {
            remaining = `${Math.floor(remainingSeconds / 86400)}d`;
        } else {
            const hrs = Math.floor(remainingSeconds / 3600);
            const mins = Math.floor((remainingSeconds % 3600) / 60);
            remaining = `${hrs > 0 ? hrs+'hr' : mins+'m'}`;
        }

        const expDate = new Date(exp * 1000);
        const expInHours = `${expDate.getUTCHours()}h ${expDate.getUTCMinutes()}m`;

        return {
            hastocken: true,
            reason: 'Valid token',
            decoded,
            isExpired,
            expTime: expInHours,
            remaining,
            expiryPercentage,
        };
    } catch (err) {
        return {
            hastocken: true,
            reason: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
            decoded: null,
            isExpired: true,
            expTime: null,
            remaining: null,
            expiryPercentage: null,
        };
    }
};

const generateOtpEmailTemplate = (otp) => {
    const currentYear = new Date().getFullYear();
  
    return `
        <div style="max-width: 480px; margin: 0 auto; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb; padding: 24px; border-radius: 12px; color: #1f2937;">
            <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #111827;">Password Reset OTP</h2>
            <p style="font-size: 14px; margin-bottom: 20px; color: #4b5563;">
                Hello, <br />
                Please use the following OTP to reset your password. This code is valid for <strong>10 minutes</strong>.
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <span style="display: inline-block; font-size: 28px; font-weight: bold; color: #2563eb; background-color: #e0f2fe; padding: 12px 24px; border-radius: 8px; letter-spacing: 4px;">
                    ${otp}
                </span>
            </div>
            <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
                If you didn’t request a password reset, you can safely ignore this email.
            </p>
            <p style="font-size: 12px; color: #9ca3af; margin-top: 28px; text-align: center;">
                &copy; ${currentYear} Qbot. All rights reserved.
            </p>
        </div>
    `;
}

const parseChatHistory = (rawData) => {
    const parsed = [];

    const isPureJson = (msg) => {
        if (typeof msg !== 'string') return false;
        const trimmed = msg.trim();
        try {
            const parsed = JSON.parse(trimmed);
            return typeof parsed === 'object' && parsed !== null;
        } catch {
            return false;
        }
    };

    const removeJsonIfMixed = (msg) => {
        if (typeof msg !== 'string') return msg;

        const trimmed = msg.trim();
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        } catch {
            // continue to remove trailing JSON
        }

        const jsonStartIndex = msg.indexOf('{');
        const arrayStartIndex = msg.indexOf('[');
        const startIndex = Math.min(
            ...(jsonStartIndex !== -1 ? [jsonStartIndex] : [Infinity]),
            ...(arrayStartIndex !== -1 ? [arrayStartIndex] : [Infinity])
        );

        if (startIndex !== Infinity) {
            return msg.slice(0, startIndex).trim();
        }

        return msg;
    };

    for (let i = 0; i < rawData.length; i++) {
        const current = rawData[i];
        let { sender, message, timestamp } = current;

        if (sender === 'AI') {
            message = removeJsonIfMixed(message);
            parsed.push({ sender, message, timestamp });
        }

        else if (sender === 'Consultant') {
            const previous = parsed[parsed.length - 1];

            if (
                previous &&
                previous.sender === 'AI' &&
                Array.isArray(previous.message)
            ) {
                const match = previous.message.find((item) => item.id === message);
                if (match) {
                    message = match.value;
                }
            }

            if (typeof message === 'string' && message.trim() === '') continue;

            parsed.push({ sender, message, timestamp });
        }
    }

    return parsed;
};

const fillMissingSentimentFields = (scores = {}) => ({
    finalScore: scores.finalScore ?? 0,
    speedScore: scores.speedScore ?? 0,
    behaviourScore: scores.behaviourScore ?? 0,
    sentimentScore: scores.sentimentScore ?? 0,
    ...scores
});

const onWebhookEvent = async (userRespondTime, userPhone, userId) => {
    if (!userRespondTime || !userPhone || !userId) throw new Error("Invalid inputs");
  
    await AppointmentModal.updateMany(
        {
            whatsAppNumber: userPhone,
            user: userId,
            $or: [
                { lastActiveAt: { $exists: false } },
                { lastActiveAt: { $lt: userRespondTime } }
            ]
        },
        { $set: { lastActiveAt: userRespondTime } }
    );
};

const getMediaType = (message) => {
    if (!message || typeof message !== "string") return null;

    const url = message.trim();

    if (!validator.isURL(url, { require_protocol: true })) return null;

    try {
        const ext = url.split(".").pop().toLowerCase().split("?")[0].split("#")[0];

        if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
        if (["mp4", "3gp"].includes(ext)) return "video";
        if (["mp3", "aac", "m4a", "amr", "ogg", "opus" ].includes(ext)) return "audio";
        if ([ "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",  "txt", "csv", "rtf", "zip", "rar"].includes(ext)) return "document";
        return null;
    } catch {
        return null;
    }
};

const validateInput = (type, value) => {
    if (!value || typeof value !== 'string') return false;
    const cleanValue = value.trim();
    if (cleanValue?.length === 0) return false;

    const getExtension = (input) => {
        let path = input;
        try {
            const url = new URL(input);
            path = url.pathname;
        } catch (e) {
            path = input.split(/[?#]/)[0];
        }
        return path.includes('.') ? path.split('.').pop().toLowerCase() : null;
    };

    switch (type?.toLowerCase()) {
        case 'number':
            return !isNaN(cleanValue);

        case 'email':
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanValue);

        case 'phone':
            return /^\+?\d{7,15}$/.test(cleanValue.replace(/[\s\-\(\)]/g, ''));

        case 'slot':
            return cleanValue.startsWith('PRE-S_') || cleanValue.startsWith('PRE-SUB_') || cleanValue === 'BACK';

        case 'list':
        case 'button':
            return cleanValue.startsWith('PRE-');

        case 'text':
            // Regex allows letters, marks, spaces, emojis, and join controls
            const nameRegex = /^[\p{L}\p{M}\s\p{Extended_Pictographic}\p{Join_Control}]+$/u;
            return nameRegex.test(value.trim());

        case 'date':
            const datePattern = /^(\d{4}[-./]\d{2}[-./]\d{2})|(\d{1,2}[-./]\d{1,2}[-./]\d{2,4})$/;
            if (!datePattern.test(cleanValue)) return false;
            const d = new Date(cleanValue);
            return d instanceof Date && !isNaN(d.getTime());

        case 'time':
            // Validates 24-hour format (HH:MM or HH:MM:SS) and 12-hour format (HH:MM AM/PM)
            const time24 = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
            const time12 = /^(0?[1-9]|1[0-2]):([0-5]\d)(\s?[AaPp][Mm])$/i;
            return time24.test(cleanValue) || time12.test(cleanValue);

        case 'locations':
            // Matches structure: "Lat: 19.99..., Lng: 77.00..."
            console.log("Validating location:", cleanValue);
            const locRegex = /^Lat:\s*-?\d+(\.\d+)?,\s*Lng:\s*-?\d+(\.\d+)?$/i;
            return locRegex.test(cleanValue);

        case 'file': {
            const ext = getExtension(cleanValue);
            return ext && ["jpg", "jpeg", "png", "webp", "mp4", "3gp", "mp3", "aac", "m4a", "amr", "ogg", "opus", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "zip", "rar"].includes(ext);
        }

        default:
            return false;
    }
};

const getInputFormat = (type) => {
    if (!type || typeof type !== 'string') return '';

    switch (type.toLowerCase()) {
        case 'date':
            return "YYYY-MM-DD, DD/MM/YYYY";

        case 'time':
            return "HH:MM (24-hour), HH:MM AM/PM (12-hour)";

        case 'file':
            return "Please upload a supported file format.";

        case 'text':
            return "John Doe or Anna, London, Emojis(😊)";

        case 'phone':
            return "+1234567890, 7865453467, 7-15 Digits";

        case 'email':
            return "user@domain.com";

        case 'number':
            return "1234, 5678...";

        case 'slot':
            return "Jan 01: 19:00-22:10";

        case 'locations':
            return "Lat: 19.997453, Lng: 77.000321";    

        case 'list':
        case 'button':
            return "Option1, Option2...";

        default:
            return "Unknown Type";
    }
};

const  fetchFilesFromMessageParts = async (messageParts, selectedFlowId, userId) => {
    try {
        if (!Array.isArray(messageParts) || !selectedFlowId || !userId) {
            return; 
        }

        const fileIds = messageParts.filter(p => typeof p === "string" && p.startsWith("FI-"));
        if (!fileIds.length) return null;

        const batchSize = 200;
        const batches = [];
        for (let i = 0; i < fileIds.length; i += batchSize) {
            batches.push(fileIds.slice(i, i + batchSize));
        }

        const results = await Promise.all(
            batches.map(async (ids) =>
                ChatBotModel.aggregate([
                    {
                        $match: {
                            _id: new mongoose.Types.ObjectId(selectedFlowId),
                            user: userId,
                            status: true,
                        },
                    },
                    { $unwind: "$nodes" },
                    { $unwind: "$nodes.data.inputs" },
                    { $unwind: "$nodes.data.inputs.fileData" },
                    {
                        $match: {
                            "nodes.data.inputs.fileData.fileId": { $in: ids },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            fileId: "$nodes.data.inputs.fileData.fileId",
                            output: {
                                $ifNull: [
                                    "$nodes.data.inputs.fileData.url",
                                    "$nodes.data.inputs.fileData.location",
                                ],
                            },
                        },
                    },
                ])
            )
        );

        const matchedFiles = results.flat();
        const fileMap = Object.create(null);
        for (const f of matchedFiles) {
            if (f.fileId && f.output) {
                fileMap[f.fileId.trim()] = f.output;
            }
        }

        const orderedOutputs = messageParts
            .map((part) => {
                const trimmed = String(part).trim();
                return trimmed.startsWith("FI-")
                    ? fileMap[trimmed] || ""
                    :trimmed;
            })
            .filter(Boolean);

        return orderedOutputs.length ? { meaasgeLink: orderedOutputs } : null;
    } catch (error) {
        console.error("Error in fetchFilesFromMessageParts:", error);
        throw error;
    }
}

async function updateMIdByUrl(chatbotId, userId, singleUrl, newMId) {
    try {
        if (!mongoose.Types.ObjectId.isValid(chatbotId) || !mongoose.Types.ObjectId.isValid(userId) || !newMId) {
           return;
        }

        const chatbot = await ChatBotModel.findOne({
            _id: chatbotId,
            user: userId,
            status: true,
        });

        if (!chatbot) throw new Error("Chatbot not found or access denied");

        let updated = false;

        for (const node of chatbot?.nodes || []) {
            for (const input of node?.data?.inputs || []) {
                for (const file of input?.fileData || []) {
                    if (file.url === singleUrl) {
                        file.mId = newMId;
                        updated = true;
                        break;
                    }
                }
                if (updated) break;
            }
            if (updated) break;
        }

        if (updated) {
            chatbot.markModified("nodes");
            await chatbot.save();
            return { success: true };
        } else {
            return { success: false };
        }
    } catch (error) {
        console.error("❌ Error updating mId:", error);
        return { success: false, error: error.message };
    }
}

const parseToArray = (resp) => {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp.map(s => String(s).trim()).filter(Boolean);

    if (typeof resp === 'object') return Object.values(resp).map(s => String(s).trim()).filter(Boolean);

    if (typeof resp === 'string') {
        const match = resp.match(/\[([^\]]+)\]/);
        if (match) {
            return match[1].split(',').map(s => s.trim()).filter(Boolean);
        }

        return resp.split(',').map(s => s.trim()).filter(Boolean);
    }

    return [String(resp)];
};

const stripHtml = (html = '') =>
  html.replace(/<[^>]*>?/gm, '').trim();

const extractField = (text = '') => {
  const match = text.match(/\[(.*?)\]/);
  return match ? match[1] : null;
};

const generateRefID = async () => {
    return `NM00${generateId()}`; 
};

module.exports = {
    cleanAIResponse,
    extractMandatoryFieldsFromFlow,
    validateToken,
    generateOtpEmailTemplate,
    parseChatHistory,
    fillMissingSentimentFields,
    onWebhookEvent,
    getMediaType,
    validateInput,
    getInputFormat,
    fetchFilesFromMessageParts,
    updateMIdByUrl,
    parseToArray,
    stripHtml,
    extractField,
    generateRefID,
};
