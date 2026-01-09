const path = require('path');
const { MAX_RETRIES, RETRY_DELAY_MS } = require('../../config/constants');

let model = null;
let provider = null;

/* ---------------- AI INIT ---------------- */

(async () => {
    try {
        if (process.env.API_GEM) {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.API_GEM);
            model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash-lite',
                generationConfig: {
                    maxOutputTokens: 120,
                    temperature: 0.2,
                },
            });
            provider = 'Gemini API';
            console.log('✅ Using Gemini API');
            return;
        }

        const { VertexAI } = require('@google-cloud/vertexai');
        const vertexAI = new VertexAI({
            project: process.env.GOOGLE_PROJECT_ID || 'qbot-441905',
            location: process.env.GOOGLE_PROJECT_LOCATION || 'us-central1',
            keyFilename:
                process.env.VERTEX_AI === 'yes'
                    ? '/gvc-secrets/gvc.json'
                    : process.env.VERTEX_AI_CREDENTIALS
                    ? undefined
                    : path.join(process.cwd(), 'vertex-api-key.json'),
            credentials: process.env.VERTEX_AI_CREDENTIALS
                ? JSON.parse(process.env.VERTEX_AI_CREDENTIALS)
                : undefined,
        });

        model = vertexAI.getGenerativeModel({
            model: 'gemini-2.5-flash-lite',
            generationConfig: {
                maxOutputTokens: 120,
                temperature: 0.2,
            },
        });

        provider = 'Vertex AI';
        console.log('✅ Using Vertex AI');
    } catch (err) {
        console.error('❌ Failed to initialize AI:', err);
    }
})();

/* ---------------- SECURITY LIMITS ---------------- */

// Per-user
const RATE_LIMIT = 60;               // req/min (smooth for humans)
const MIN_PROMPT_GAP = 800;          // ms
const MAX_INPUT_LENGTH = 2000;       // chars (~350 tokens)

// Global (CRITICAL)
const GLOBAL_RATE_LIMIT = 3000;      // req/min total

const userQueues = new Map();
let globalTimestamps = [];

/* ---------------- HELPERS ---------------- */

const isValidUserId = (userId) =>
    typeof userId === 'string' && /^[0-9]{8,16}$/.test(userId);

const allowGlobalRequest = () => {
    const now = Date.now();
    globalTimestamps = globalTimestamps.filter(t => now - t < 60000);
    if (globalTimestamps.length >= GLOBAL_RATE_LIMIT) return false;
    globalTimestamps.push(now);
    return true;
};

/* ---------------- QUEUE ---------------- */

const enqueueRequest = (userId, taskFn) => {
    if (!isValidUserId(userId)) {
        return Promise.resolve('⚠️ Invalid request.');
    }

    if (!allowGlobalRequest()) {
        return Promise.resolve('⚠️ System busy. Please try again shortly.');
    }

    if (!userQueues.has(userId)) {
        userQueues.set(userId, {
            queue: [],
            processing: false,
            timestamps: [],
            lastPromptTime: 0,
        });
    }

    return new Promise((resolve, reject) => {
        const q = userQueues.get(userId);
        const now = Date.now();

        if (now - q.lastPromptTime < MIN_PROMPT_GAP) {
            return resolve('⌛ Please wait a moment...');
        }

        q.timestamps = q.timestamps.filter(ts => now - ts < 60000);
        if (q.timestamps.length >= RATE_LIMIT) {
            return resolve('⚠️ Too many requests. Please slow down.');
        }

        q.lastPromptTime = now;
        q.timestamps.push(now);
        q.queue.push({ taskFn, resolve, reject });

        processQueue(userId);
    });
};

const processQueue = async (userId) => {
    const q = userQueues.get(userId);
    if (!q || q.processing || q.queue.length === 0) return;

    q.processing = true;
    const { taskFn, resolve, reject } = q.queue.shift();

    try {
        resolve(await taskFn());
    } catch (err) {
        reject(err);
    } finally {
        q.processing = false;
        if (q.queue.length === 0) {
            setTimeout(() => userQueues.delete(userId), 10 * 60 * 1000);
        } else {
            processQueue(userId);
        }
    }
};

/* ---------------- MAIN API ---------------- */

const generateAIResponse = async (
    prompt,
    userId,
    options = { systemPrompt: null, jsonMode: false }
) => {
    if (!model) return '⚠️ AI warming up. Please try again.';
    if (!prompt || typeof prompt !== 'string') return null;
    if (prompt.length > MAX_INPUT_LENGTH) {
        return '⚠️ Message too long. Please shorten your input.';
    }

    return enqueueRequest(userId, async () => {
        let attempt = 0;

        const finalPrompt = options.systemPrompt
            ? `${options.systemPrompt}\n\nTask Input: ${prompt}`
            : prompt;

        const generationConfig = {
            temperature: 0.4,
            ...(options.jsonMode && { responseMimeType: 'application/json' }),
        };

        while (attempt < MAX_RETRIES) {
            try {
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
                    generationConfig,
                });

                let text = '';

                if (provider === 'Gemini API') {
                    text = result?.response?.text?.() || '';
                } else {
                    const parts = result?.response?.candidates?.[0]?.content?.parts || [];
                    text = parts.map(p => p.text || '').join(' ');
                }

                return (
                    text.replace(/```(json)?|```/g, '').trim() ||
                    'Sorry, I couldn’t respond right now.'
                );
            } catch (err) {
                if (err?.status === 429 || err?.status === 503) {
                    await new Promise(r =>
                        setTimeout(r, RETRY_DELAY_MS * (attempt + 1))
                    );
                    attempt++;
                    continue;
                }

                if (err?.response?.promptFeedback?.blockReason === 'PROHIBITED_CONTENT') {
                    return JSON.stringify({
                        status: 'abusive',
                        reply: 'Please be respectful.',
                    });
                }

                console.error(`[${userId}] ${provider} error:`, err);
                break;
            }
        }
        return "⚠️ I'm having trouble responding right now.";
    });
};

/* ---------------- CLEANUP ---------------- */

const clearUserTracking = (userId) => {
    userQueues.delete(userId);
    console.log(`[${userId}] User tracking cleared`);
};

module.exports = {
    generateAIResponse,
    clearUserTracking,
};




