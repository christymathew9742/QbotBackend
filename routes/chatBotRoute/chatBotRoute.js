const express = require('express');
const {createChatBot, getAllChatBot, getChatBotById, updateChatBot, deleteChatBot} = require('../../controllers/chatBotController/chatBotController');
const {validateChatBot, Validation} = require('../../middlewares/chatBotMiddleware/chatBotMiddleware')
const authMiddleware = require('../../middlewares/authMiddleware');
const router = express.Router();

router.post('/',authMiddleware,validateChatBot,Validation,createChatBot);
router.get('/', authMiddleware,getAllChatBot);
router.get('/:id', authMiddleware,getChatBotById);
router.put('/:id', authMiddleware,validateChatBot, Validation, updateChatBot);
router.delete('/:id', authMiddleware,deleteChatBot);

module.exports = router;