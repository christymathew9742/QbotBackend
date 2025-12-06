const express = require('express');
const {
    createChatBot,
    getAllChatBot, 
    getChatBotById, 
    updateChatBot, 
    deleteChatBot, 
    getSignedUrlForUpload, 
    deleteUploadFiles,
    saveFileToPermenmt,
} = require('../../controllers/chatBotController/chatBotController');
const {validateChatBot, Validation} = require('../../middlewares/chatBotMiddleware/chatBotMiddleware')
const authMiddleware = require('../../middlewares/authMiddleware');
const router = express.Router();

router.post('/',authMiddleware,validateChatBot,Validation,createChatBot);
router.get('/', authMiddleware, getAllChatBot);
router.get('/:id', authMiddleware, getChatBotById);
router.put('/:id', authMiddleware, updateChatBot);
router.delete('/:id', authMiddleware, deleteChatBot);
router.get("/:id/upload-url", authMiddleware, getSignedUrlForUpload);
router.get("/:id/permanent-url", authMiddleware, saveFileToPermenmt);
router.delete("/:id/files", authMiddleware, deleteUploadFiles);

module.exports = router;