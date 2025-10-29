const createAIResponse = require('../../ai/services/aiServices');

const handleConversation = async (userData) => {
  try {
    const aiResponse = await createAIResponse(userData);

    console.log(aiResponse,'aiResponseaiResponseaiResponse')

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




// const createAIResponse = require('../../ai/services/aiServices');
// const handleConversation = async (userData) => {
//   try {
//     const aiResponse = await createAIResponse(userData);
    
//     if (!aiResponse || typeof aiResponse !== 'object') {
//       return {
//         resp: '🙏Please try again in a little while.',
//         type: 'text',
//         mainTitle: ''
//       };
//     }

//     const { message, optionsArray } = aiResponse;
//     let normalizedMessage = '';
//     if (Array.isArray(message)) {
//       normalizedMessage = message.join(', ').trim(); 
//     } else if (typeof message === 'string') {
//       normalizedMessage = message.trim();
//     }

//     if (normalizedMessage && optionsArray && Array.isArray(optionsArray.resp) && optionsArray.resp.length) {
//       return [
//         {
//           resp: normalizedMessage,
//           type: 'text',
//           mainTitle: optionsArray.mainTitle || ''
//         },
//         {
//           resp: optionsArray.resp,
//           type: optionsArray.type || '',
//           mainTitle: optionsArray.mainTitle || ''
//         }
//       ];
//     }

//     if (normalizedMessage && (!optionsArray || !Array.isArray(optionsArray.resp) || !optionsArray.resp.length)) {
//       return {
//         resp: normalizedMessage,
//         type: 'text',
//         mainTitle: ''
//       };
//     }

//     if (!normalizedMessage && optionsArray && Array.isArray(optionsArray.resp) && optionsArray.resp.length) {
//       return {
//         resp: optionsArray.resp,
//         type: optionsArray.type || '',
//         mainTitle: optionsArray.mainTitle || ''
//       };
//     }

//     return {
//       resp: '🙏Please try again in a little while.',
//       type: 'text',
//       mainTitle: ''
//     };

//   } catch (error) {
//     console.error('Error in handleConversation:', error);
//     return {
//       resp: 'An unexpected error occurred.',
//       type: 'text',
//       mainTitle: ''
//     };
//   }
// };

// module.exports = handleConversation;









