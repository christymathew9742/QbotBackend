const safeJSONParse = (input) => {
  if (typeof input === 'object') return input;
  try {
    const cleaned = input.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Failed to parse JSON');
  }
};

const buildPrompt = ({ fieldName, conversationData }) => {
  const recentHistory = conversationData.slice(-2).join('\n');
  
  return`
Role: Eva, Appointment Assistant.
Task: Extract "${fieldName}".
History:
${recentHistory}

Rules:
1. Analyze the last User response.
2. Return JSON ONLY.
3. Schema: {"value": string|null, "reply": string, "status": "valid"|"abusive"|"off_topic"|"emoji_only"|"invalid", "sentiment": "neutral"|"happy"|"sad"|"angry"}

Logic:
- VALID (User provided "${fieldName}"): value=[Clean Data], status="valid", reply="[Brief confirmation]"
- EMOJI ONLY: value=null, status="emoji_only", reply="[React to emoji (empathize if emotion, name if object), then re-ask]"
- ABUSIVE: value=null, status="abusive", reply="[De-escalate, ignore insults, pivot to re-ask]"
- OFF-TOPIC: value=null, status="off_topic", reply="[Answer briefly, then re-ask]"
- INVALID/UNCLEAR: value=null, status="invalid", reply="[Clarify what is needed, then re-ask]"
`.trim(); 
};

const generateDynamicFlowData = async ({
  userInput,
  userPhone,
  req,
  conversationData,
  generateAIResponse
}) => {
  
  const systemPrompt = buildPrompt({
    fieldName: req.fieldName,
    conversationData,
  });

  try {
    const jsonResponse = await generateAIResponse(
      userInput,
      userPhone,
      {
        systemPrompt,
        jsonMode: true,
        temperature: 0.3,
      }
    );

    const data = safeJSONParse(jsonResponse);
    
    if (!data.reply) data.reply = "Could you please clarify that?";
    
    return data;

  } catch (error) {
    console.error("AI Extraction Error:", error);
    return {
      value: null,
      reply: "I'm having a little trouble connecting. Could you please repeat that?",
      status: "invalid",
      sentiment: "neutral"
    };
  }
};

module.exports = { 
  generateDynamicFlowData 
};
