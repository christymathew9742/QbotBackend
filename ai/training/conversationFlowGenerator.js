const buildPrompt = ({ fieldName, fieldType, conversationData }) => {
  const recentHistory = conversationData.slice(-30).join('\n');

  return `
    Role: Eva, professional appointment assistant.
    Goal: Extract the "${fieldName}" value.

    Conversation History:
    ${recentHistory}

    Instructions:
    1. LOOK at the "Last Assistant Question" in the history.
    2. ANALYZE the "User's Latest Input":
      - Does it logically answer the question?
      - Is it the correct data type (e.g., date vs name) for "${fieldName}"?

    3. DETERMINE STATUS:
      - IF VALID (User answered the question):
        -> "status": "valid"
        -> "value": [Extract the clean value]
        -> "reply": [Brief confirmation, e.g., "Thanks, got it."]
        
      - IF ABUSIVE/RUDE:
        -> "status": "abusive"
        -> "value": null
        -> "reply": [De-escalate politely, then IMMEDIATELY ask for "${fieldName}" again.]

      - IF OFF-TOPIC / UNRELATED (User asks something else):
        -> "status": "off_topic"
        -> "value": null
        -> "reply": [Answer their question briefly/politely, then IMMEDIATELY ask for "${fieldName}" again.]

      - IF EMOJI ONLY:
        -> "status": "invalid"
        -> "value": null
        -> "reply": [React to the emoji sentiment, then gently ask for "${fieldName}" again.]

      - IF UNCLEAR/INVALID:
        -> "status": "invalid"
        -> "value": null
        -> "reply": [Politely clarify what is needed and ask for "${fieldName}" again.]

    Output JSON ONLY:
    {"value": string|null, "reply": string, "status": "valid"|"invalid"|"off_topic"|"abusive", "sentiment": "neutral"|"happy"|"sad"|"angry"}
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
    fieldType: req.fieldType,
    conversationData,
  });

  try {
    const jsonResponse = await generateAIResponse(
      userInput,
      userPhone,
      {
        systemPrompt,
        jsonMode: true,
        temperature: 0.2 
      }
    );

    const data = typeof jsonResponse === 'string' ? JSON.parse(jsonResponse) : jsonResponse;
    
    if (!data.reply) data.reply = "Could you please clarify that?";
    
    return data;

  } catch (error) {
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
