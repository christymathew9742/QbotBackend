const createAIResponse = require('../../ai/services/aiServices');

const handleConversation = async (userData) => {
  console.log(userData,'userData')
  try {
    const aiResponse = await createAIResponse(userData);

    if (aiResponse?.message) {
      return {
        resp: aiResponse.message,
        type: 'text'
      };
    };

    if (aiResponse?.optionsArray) {
      return {
        resp: aiResponse.optionsArray.items,
        type: 'list',
        mainTitle: aiResponse.optionsArray.mainTitle,
      }
    };
    return {
      resp: '🙏Please try again in a little while.',
      type: 'text'
    };
    
  } catch (error) {
    console.error('Error in handling conversation:', error);
    return {
      resp: 'An unexpected error occurred.',
      type: 'text'
    };
  }
};

module.exports = handleConversation;




