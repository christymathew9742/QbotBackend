const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
const trailingJsonRegex = /(?:\s*)({[\s\S]*}|\[[\s\S]*\])\s*$/;
const jwt = require('jsonwebtoken');
const AppointmentModal = require('../models/AppointmentModal')

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

function extractJsonFromResponse(response) {
    if (!response || typeof response !== 'string') return null;

    const blockMatch = response.match(jsonBlockRegex);
    if (blockMatch && blockMatch[1]) {
        return blockMatch[1].trim();
    }

    const objectMatch = response.match(trailingJsonRegex);
    if (objectMatch && objectMatch[0]) {
        return objectMatch[0].trim();
    }

    return null;
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

function safeParseOptions(aiResponse) {
    if (typeof aiResponse !== 'string') return [];
  
    const match = aiResponse.match(/\[\s*\{[\s\S]*?\}\s*\]/s);
    if (!match) return [];
  
    try {
        const parsed = JSON.parse(match[0]);
    
        if (
            Array.isArray(parsed) &&
            parsed.length &&
            parsed.every (
            item =>
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                /^P-\d+$/.test(item.id) &&
                typeof item.value === 'string'
            )
        ) {
            return parsed;
        }
    
        return [];
    } catch (err) {
        console.error("safeParseOptions failed:", err.message);
        return [];
    }
}

const getValidationHint = (type, requiredFields = []) => {
    const baseText = `Mandatory: true\n  - Expected`;
    const hints = {
        Text: `${baseText} Text only:\n - User Keywords: "name(Only alphabets and common words)", "title", "location name", "reason", "text field"\n - Format: String (e.g., John Doe)\n - Error Message: "Please enter a valid [fieldName]"`,
        Number: `${baseText} Numbers only:\n  - User Keywords: "age(ALLOW:1 to 100)", "quantity", "amount", "duration", "count", "number of items"\n  - Format: Numbers only (e.g., 25)\n  - Error Message: "Please enter a valid [fieldName]"`,
        Email: `${baseText} Email:\n  - User Keywords: "email", "mail", "email address"\n  - Format: Valid email (e.g., john@example.com)\n  - Error Message: "Please enter a valid email address like john@example.com."`,
        Phone: `${baseText} Phone:\n  - User Keywords: "phone", "mobile", "contact number"\n  - Format: 6-12-digit number (e.g., 9876543210)\n  - Error Message: "Please enter a valid phone number."`,
        Date: `${baseText} Date:\n  - User Keywords: "date", "appointment date", "birthdate", "meeting date"\n  - Format: YYYY-MM-DD (e.g., 2025-07-10)\n  - Error Message: "Please enter a valid date in YYYY-MM-DD format."`,
        Time: `${baseText} Time:\n  - User Keywords: "time", "meeting time", "slot time", "appointment time"\n  - Format: HH:MM (24-hour) (e.g., 14:30)\n  - Error Message: "Please enter a valid time like 14:30 in 24-hour format."`,
        URL: `${baseText} URL:\n  - User Keywords: "website", "link", "portfolio", "profile URL"\n  - Format: Valid HTTP/HTTPS URL (e.g., https://example.com)\n  - Error Message: "Please enter a valid website URL starting with http or https."`,
        Location: `${baseText} Location:\n  - User Keywords: "location", "coordinates", "map point"\n  - Format: latitude,longitude (e.g., 12.9716,77.5946)\n  - Error Message: "Please provide a valid location format like latitude,longitude."`,
        File: `${baseText} File:\n  - User Keywords: "document", "attachment", "file upload", "image file"\n  - Format: Upload only (PDF, DOC, JPG, etc.)\n  - Error Message: "Please upload a valid file attachment only."`
    };
    return hints[type] || '';
};

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

module.exports = {
    cleanAIResponse,
    extractJsonFromResponse,
    extractMandatoryFieldsFromFlow,
    safeParseOptions,
    getValidationHint,
    validateToken,
    generateOtpEmailTemplate,
    parseChatHistory,
    fillMissingSentimentFields,
    onWebhookEvent,
};
  


  