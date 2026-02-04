const createAIResponse = require('../../ai/services/aiServices');

const handleConversation = async (userData) => {
  try {
    const aiResponse = await createAIResponse(userData);

    if (aiResponse?.message) {
      return {
        resp: aiResponse?.message || "",
        type: 'text',
        FlowId: aiResponse?.FlowId || "",
        mainTitle: ''
      };
    };

    if (aiResponse?.optionsArray) {
      return aiResponse?.optionsArray;
    };

    return {
      resp: { message: `🤔 Sorry ${userData?.profileName} I got a bit mixed up. Let’s begin again!` },
      type: 'text',
      FlowId: '',
      mainTitle: ''
    };
    
  } catch (error) {
    console.error('Error in handling conversation:', error);
  }
};

module.exports = handleConversation;









