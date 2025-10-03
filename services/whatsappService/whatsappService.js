const createAIResponse = require('../../ai/services/aiServices');

const handleConversation = async (userData) => {
  try {
    const aiResponse = await createAIResponse(userData);

    if (aiResponse?.message) {
      return {
        resp: aiResponse?.message,
        type: 'text',
        mainTitle: ''
      };
    };

    if (aiResponse?.optionsArray) {
      console.log(aiResponse.optionsArray.resp,aiResponse?.optionsArray?.type,aiResponse?.optionsArray?.mainTitle,'aiResponseaiResponseaiResponseaiResponse')
      return aiResponse?.optionsArray;
      // return {
      //   resp: aiResponse?.optionsArray?.items,
      //   type: aiResponse?.optionsArray?.type?.toLowerCase(),
      //   mainTitle: aiResponse?.optionsArray?.mainTitle,
      // }
    };

    return {
      resp: '🙏Please try again in a little while.',
      type: 'text',
      mainTitle: ''
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




