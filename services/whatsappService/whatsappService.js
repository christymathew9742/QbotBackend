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



// const CHUNK_SIZE = 10;
// const createAIResponse = require('../../ai/services/aiServices');

// function paginateOptions(optionsArray, page = 1) {
//   const { resp = [], mainTitle = "", type = "list" } = optionsArray || {};

//   if (type !== "list") return optionsArray; // no pagination needed

//   // If total options <= 10, send as-is
//   if (resp.length <= CHUNK_SIZE) {
//     return {
//       mainTitle,
//       type,
//       resp
//     };
//   }

//   const totalPages = Math.ceil(resp.length / CHUNK_SIZE);

//   // Compute slice size dynamically to account for nav buttons
//   let sliceSize = CHUNK_SIZE;
//   const navButtons = [];
//   if (page > 1) navButtons.push({ _id: `PREV_PAGE_${page - 1}`, title: "⬅️ Back" });
//   if (page < totalPages) navButtons.push({ _id: `NEXT_PAGE_${page + 1}`, title: "➡️ Next" });

//   // Ensure total items including nav buttons <= 10
//   sliceSize = CHUNK_SIZE - navButtons.length;
//   const start = (page - 1) * sliceSize;
//   const chunk = resp.slice(start, start + sliceSize);

//   return {
//     mainTitle: `${mainTitle} (Page ${page}/${totalPages})`,
//     type,
//     resp: [...chunk, ...navButtons]
//   };
// }

// const handleConversation = async (userData) => {
//   try {
//     const aiResponse = await createAIResponse(userData);

//     // Text message
//     if (aiResponse?.message) {
//       return {
//         resp: aiResponse.message,
//         type: 'text',
//         mainTitle: ''
//       };
//     }

//     // Options list
//     if (aiResponse?.optionsArray) {
//       const { resp = [] } = aiResponse.optionsArray;

//       // If total options <= 10, send as-is
//       if (resp.length <= CHUNK_SIZE) {
//         return {
//           mainTitle: aiResponse.optionsArray.mainTitle || '',
//           type: 'list',
//           resp
//         };
//       }

//       // Determine page number
//       let page = 1;
//       if (userData.userOption?.startsWith("NEXT_PAGE_")) {
//         page = parseInt(userData.userOption.split("_")[2], 10);
//       } else if (userData.userOption?.startsWith("PREV_PAGE_")) {
//         page = parseInt(userData.userOption.split("_")[2], 10);
//       }

//       return paginateOptions(aiResponse.optionsArray, page);
//     }

//     // fallback
//     return {
//       resp: '🙏Please try again in a little while.',
//       type: 'text',
//       mainTitle: ''
//     };

//   } catch (error) {
//     console.error('Error in handling conversation:', error);
//     return {
//       resp: 'An unexpected error occurred.',
//       type: 'text'
//     };
//   }
// };

// module.exports = handleConversation;







