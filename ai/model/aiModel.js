const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MAX_RETRIES, RETRY_DELAY_MS } = require('../../config/constants');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const genAI = new GoogleGenerativeAI(process.env.API_GEM);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const userQueues = new Map();
const RATE_LIMIT = 15;
const MIN_PROMPT_GAP = 2000; 
const QUESTION_TIMEOUT_MS = 30000; 

// Track AI-initiated questions and user responses
const aiQuestionTrackers = new Map();

/**
 * Enqueue a user-specific request to avoid overlapping & rate-limit issues
 */
const enqueueRequest = (userId, taskFn, promptId) => {

    return new Promise((resolve, reject) => {

        if (typeof userId !== 'string' || !userId) {
            reject(new Error('Invalid user ID'));
            return;
        }

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
            resolve("⚠️Oops! I'm still replying. Please hold on before sending more.");
            return;
        }

        if (now - userQueue.lastPromptTime < MIN_PROMPT_GAP) {
            resolve('⌛Hold on a sec! Let me finish responding before we continue.');
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

/**
 * Enhanced question detection
 */
const isQuestion = (text) => {
    const trimmed = text.trim();
    if (/[\?？]$/.test(trimmed)) return true;
    return /(^|\s)(who|what|when|where|why|how|which|can|could|would|will|do|does|did|is|are|was|were|may|might|must|shall|should)[\s\?]/i.test(trimmed);
};

/**
 * Generate AI response safely with user-based queue
*/
const generateAIResponse = async (prompt, userId, retries = 0) => {

    if (typeof prompt !== 'string' || !prompt.trim()) {
        console.error(`[${userId}] Invalid prompt:`, prompt);
        return null;
    }
    if (typeof userId !== 'string' || !userId) {
        console.error('Invalid user ID:', userId);
        return null;
    }
    if (retries >= MAX_RETRIES) {
        console.error(`[${userId}] Max retries reached for prompt:`, prompt.substring(0, 50));
        return null;
    }

    const promptId = Date.now();

    return enqueueRequest(userId, async () => {
        try {
            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }]
                }]
            });
            
            let responseText = result.response.text().trim();
            responseText = responseText.replace(/```[\s\S]*?```/g, '').trim();
            const questionDetected = isQuestion(responseText);
            
            if (questionDetected) {
                aiQuestionTrackers.set(userId, {
                    awaitingResponse: true,
                    hasResponded: false,
                    timeout: setTimeout(() => {
                        if (aiQuestionTrackers.has(userId)) {
                            aiQuestionTrackers.delete(userId);
                        }
                    }, QUESTION_TIMEOUT_MS)
                });
            } else if (aiQuestionTrackers.has(userId)) {
                clearTimeout(aiQuestionTrackers.get(userId).timeout);
                aiQuestionTrackers.delete(userId);
            }
            
            return responseText;
        } catch (error) {
            console.error(`[${userId}] AI Error (attempt ${retries + 1}):`, error);
            
            if (error.status === 503 || error.status === 429) { 
                const delayTime = RETRY_DELAY_MS * (retries + 1);
                console.log(`[${userId}] Retrying in ${delayTime}ms...`);
                await delay(delayTime);
                return generateAIResponse(prompt, userId, retries + 1);
            }
            
            return "⚠️ I'm having trouble responding right now. Please try again later.";
        }
    }, promptId);
};

/**
 * Call this when the conversation is complete to clear tracking
*/
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
    clearUserTracking
};
