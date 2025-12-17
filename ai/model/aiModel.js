const path = require('path');
const { MAX_RETRIES, RETRY_DELAY_MS } = require('../../config/constants');

/* =====================================================
   AI MODEL INITIALIZATION (SINGLE INSTANCE ONLY)
===================================================== */

let model = null;
let provider = null;

(async () => {
  try {
    // 👉 Prefer Gemini API (cheapest)
    if (process.env.API_GEM) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.API_GEM);

      model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.4,
        },
      });

      provider = 'Gemini API';
      console.log('✅ Using Gemini API (gemini-2.5-flash)');
      return;
    }

    // 👉 Vertex AI (only if Gemini API key not present)
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
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.4,
      },
    });

    provider = 'Vertex AI';
    console.log('✅ Using Vertex AI (gemini-2.5-flash)');
  } catch (err) {
    console.error('❌ Failed to initialize AI:', err);
  }
})();

/* =====================================================
   QUEUE + RATE LIMIT (COST SAFE)
===================================================== */

const userQueues = new Map();

const RATE_LIMIT = 100;       // per minute
const MIN_PROMPT_GAP = 1000; // ms

const enqueueRequest = (userId, taskFn) => {
  if (!userId || typeof userId !== 'string') {
    return Promise.reject(new Error('Invalid userId'));
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

    // Prevent spam / double sends
    if (now - q.lastPromptTime < MIN_PROMPT_GAP) {
      return resolve('⌛ Please wait a moment...');
    }

    q.lastPromptTime = now;
    q.queue.push({ taskFn, resolve, reject });
    processQueue(userId);
  });
};

const processQueue = async (userId) => {
  const q = userQueues.get(userId);
  if (!q || q.processing || q.queue.length === 0) return;

  const now = Date.now();

  // Rate limit (rolling 60s)
  q.timestamps = q.timestamps.filter(ts => now - ts < 60000);
  if (q.timestamps.length >= RATE_LIMIT) return;

  q.processing = true;
  q.timestamps.push(now);

  const { taskFn, resolve, reject } = q.queue.shift();

  try {
    const result = await taskFn();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    q.processing = false;
    processQueue(userId);
  }
};

/* =====================================================
   AI RESPONSE (NO RECURSIVE BILLING)
===================================================== */

const generateAIResponse = async (prompt, userId) => {
  if (!prompt || typeof prompt !== 'string') return null;
  if (!model) return "⚠️ AI is warming up. Please try again.";

  return enqueueRequest(userId, async () => {
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });

        let text = '';

        if (provider === 'Gemini API') {
          text = result?.response?.text?.() || '';
        } else {
          const parts =
            result?.response?.candidates?.[0]?.content?.parts || [];
          text = parts.map(p => p.text || '').join(' ');
        }

        text = text.replace(/```[\s\S]*?```/g, '').trim();

        return text || 'Sorry, I couldn’t respond right now.';

      } catch (err) {
        if (err?.status === 429 || err?.status === 503) {
          await new Promise(r =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1))
          );
          attempt++;
          continue;
        }

        if (err?.response?.promptFeedback?.blockReason === 'PROHIBITED_CONTENT') {
          return "🙏 Sorry, I can’t help with that request.";
        }

        console.error(`[${userId}] ${provider} error:`, err);
        break;
      }
    }

    return "⚠️ I'm having trouble responding right now.";
  });
};

/* =====================================================
   CLEANUP
===================================================== */

const clearUserTracking = (userId) => {
  userQueues.delete(userId);
  console.log(`[${userId}] User tracking cleared`);
};

/* =====================================================
   EXPORTS
===================================================== */

module.exports = {
  generateAIResponse,
  clearUserTracking,
};

