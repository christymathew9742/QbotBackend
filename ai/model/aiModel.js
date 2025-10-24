const path = require('path');
const { MAX_RETRIES, RETRY_DELAY_MS } = require('../../config/constants');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let model = null;
let provider = null;

(async () => {
    try {
        if (process.env.API_GEM) {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.API_GEM);
            model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            provider = 'Gemini API';
            console.log('✅ Using Gemini API (gemini-2.5-flash)');
        } else {
            const { VertexAI } = require('@google-cloud/vertexai');
            process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(process.cwd(), 'vertex-key.json');

            const vertex = new VertexAI({
                project: process.env.GCLOUD_PROJECT || 'your-project-id',
                location: process.env.GCLOUD_LOCATION || 'us-central1',
            });

            model = vertex.getGenerativeModel({ model: 'gemini-2.5-flash' });
            provider = 'Vertex AI';
            console.log('✅ Using Vertex AI (gemini-2.5-flash)');
        }
    } catch (err) {
        console.error('❌ Failed to initialize AI model:', err);
    }
})();

const userQueues = new Map();
const aiQuestionTrackers = new Map();

const RATE_LIMIT = 15;
const MIN_PROMPT_GAP = 2000;
const QUESTION_TIMEOUT_MS = 30000;

const enqueueRequest = (userId, taskFn, promptId, clearUserSessionData = () => {}, resetUserInput = () => {}) => {
    return new Promise((resolve, reject) => {
        if (!userId || typeof userId !== 'string') return reject(new Error('Invalid user ID'));

        if (!userQueues.has(userId)) {
            userQueues.set(userId, {
                queue: [],
                processing: false,
                timestamps: [],
                latestPromptId: null,
                awaitingResponse: false,
                lastPromptTime: 0,
            });
        }

        const userQueue = userQueues.get(userId);
        const now = Date.now();
        const aiQuestionTracker = aiQuestionTrackers.get(userId);

        if (aiQuestionTracker && aiQuestionTracker.awaitingResponse) {
            if (aiQuestionTracker.hasResponded) {
                if (aiQuestionTracker.timeout) clearTimeout(aiQuestionTracker.timeout);
                resolve(null);
                return;
            }
                aiQuestionTracker.hasResponded = true;
            if (aiQuestionTracker.timeout) clearTimeout(aiQuestionTracker.timeout);
        }

        if (userQueue.awaitingResponse) {
            clearUserSessionData(userId);
            resetUserInput();
            resolve("⚠️ Oops! I'm still replying. Please hold on before sending more.");
            return;
        }

        if (now - userQueue.lastPromptTime < MIN_PROMPT_GAP) {
            resolve('⌛ Hold on a sec! Let me finish responding before we continue.');
            return;
        }

        userQueue.latestPromptId = promptId;
        userQueue.lastPromptTime = now;
        userQueue.awaitingResponse = true;
        userQueue.queue.push({ taskFn, resolve, reject, promptId });

        processQueue(userId);
    });
};

const processQueue = async (userId) => {
    const userQueue = userQueues.get(userId);
    if (!userQueue || userQueue.processing || userQueue.queue.length === 0) return;

    const now = Date.now();
    userQueue.timestamps = userQueue.timestamps.filter(ts => now - ts < 60000);
    if (userQueue.timestamps.length >= RATE_LIMIT) {
        const waitTime = 60000 - (now - userQueue.timestamps[0]);
        console.warn(`[${userId}] Rate limit hit. Waiting ${waitTime}ms...`);
        setTimeout(() => processQueue(userId), waitTime);
        return;
    }

    const { taskFn, resolve, reject, promptId } = userQueue.queue.shift();
    userQueue.processing = true;
    userQueue.timestamps.push(now);

    if (promptId !== userQueue.latestPromptId) {
        resolve(null);
        userQueue.processing = false;
        userQueue.awaitingResponse = false;
        processQueue(userId);
        return;
    }

    try {
        const result = await taskFn();
        resolve(result);
    } catch (err) {
        console.error(`[${userId}] Queue processing error:`, err);
        reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
        userQueue.processing = false;
        userQueue.awaitingResponse = false;
        processQueue(userId);
    }
};

const isQuestion = (text) => {
    const trimmed = text.trim();
    if (/[\?？]$/.test(trimmed)) return true;
    return /(^|\s)(who|what|when|where|why|how|which|can|could|would|will|do|does|did|is|are|was|were|may|might|must|shall|should)[\s\?]/i.test(trimmed);
};

const generateAIResponse = async (prompt, userId, clearUserSessionData = () => {}, resetUserInput = () => {}, retries = 0) => {
    if (!prompt || typeof prompt !== 'string') return null;
    if (!userId || typeof userId !== 'string') return null;
    if (retries >= MAX_RETRIES) {
        console.error(`[${userId}] Max retries reached.`);
        return "⚠️ I'm having trouble responding right now. Please try again later.";
    }

    const promptId = Date.now();

    return enqueueRequest(userId, async () => {
        try {
            if (!model) throw new Error('AI model not initialized');
            let responseText = '';

            if (provider === 'Gemini API') {
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }]}],
                });
                responseText = result?.response?.text?.() || '';
            }

            else if (provider === 'Vertex AI') {
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }]}],
                });
                if (result?.response?.candidates?.length > 0) {
                    const candidate = result.response.candidates[0];
                    const parts = candidate.content?.parts || [];
                    responseText = parts.map(p => p.text || '').join(' ').trim();
                }
            }

            responseText = (responseText || '').replace(/```[\s\S]*?```/g, '').trim();

            if (!responseText) {
                console.warn(`[${userId}] Empty response from ${provider}`);
                responseText = "⚠️ Sorry, I couldn’t generate a response. Please try again.";
            }

            const questionDetected = isQuestion(responseText);
            if (questionDetected) {
                aiQuestionTrackers.set(userId, {
                    awaitingResponse: true,
                    hasResponded: false,
                    timeout: setTimeout(() => aiQuestionTrackers.delete(userId), QUESTION_TIMEOUT_MS),
                });
            } else if (aiQuestionTrackers.has(userId)) {
                clearTimeout(aiQuestionTrackers.get(userId).timeout);
                aiQuestionTrackers.delete(userId);
            }

            return responseText;

        } catch (error) {
            if (error.status === 503 || error.status === 429) {
                const delayTime = RETRY_DELAY_MS * (retries + 1);
                console.log(`[${userId}] Retrying in ${delayTime}ms (Attempt ${retries + 1})...`);
                await delay(delayTime);
                return generateAIResponse(prompt, userId, clearUserSessionData, resetUserInput, retries + 1);
            }

            if (error?.response?.promptFeedback?.blockReason === 'PROHIBITED_CONTENT') {
                return "🙏 Sorry… I can’t reply to that as it may contain restricted content. Could you rephrase it? 🙂";
            }

            console.error(`[${userId}] ${provider} error:`, error);
            return "⚠️ I'm having trouble responding right now. Please try again later.";
        }

    }, promptId, clearUserSessionData, resetUserInput);
};

const clearUserTracking = (userId) => {
    if (aiQuestionTrackers.has(userId)) {
        clearTimeout(aiQuestionTrackers.get(userId).timeout);
        aiQuestionTrackers.delete(userId);
    }
    if (userQueues.has(userId)) {
        userQueues.delete(userId);
    }
    console.log(`[${userId}] Cleared all tracking`);
};

module.exports = {
    generateAIResponse,
    clearUserTracking,
};






