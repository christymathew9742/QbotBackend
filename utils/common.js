const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
const trailingJsonRegex = /(?:\s*)({[\s\S]*}|\[[\s\S]*\])\s*$/;
const jwt = require('jsonwebtoken');

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
        const now = Math.floor(Date.now() / 1000); // current time in seconds
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

  
module.exports = {
    cleanAIResponse,
    extractJsonFromResponse,
    extractMandatoryFieldsFromFlow,
    safeParseOptions,
    getValidationHint,
    validateToken,
};
  


  