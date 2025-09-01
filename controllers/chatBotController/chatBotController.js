const { errorResponse } = require('../../utils/errorResponse');
const chatBotService = require('../../services/chatBoatService/chatBotService')

// Create cahtBot data
const createChatBot = async (req, res, next) => {
    try {
        if (!req.user || !req.user.userId) {
            return next(errorResponse('user not responding ', 401));
        }
        
        const chatBotData = req.body;
        chatBotData.user = req.user.userId;

        const chatBotResponse = await chatBotService.createChatBot(chatBotData);
        res.status(201).json({ success: true, data: chatBotResponse });
    } catch (error) {
        next(error);
    }
};

// Get all chatBot for the authenticated user
const getAllChatBot = async (req, res, next) => {
    try {
        const { page, limit, search, status } = req.query;
        const chatBots = await chatBotService.getAllChatBot(req.user.userId, page, limit, search, status);
        res.status(200).json({ success: true, ...chatBots });
    } catch (error) {
        next(error);
    }
};

// Get a specific chatBot by ID for the authenticated user
const getChatBotById = async (req, res, next) => {
    try {
            const chatBot = await chatBotService.getChatBotById(req.params.id, req.user.userId);
            if (!chatBot) {
                return res.status(404).json({ success: false, message: 'ChatBot not found' });
            }
        res.status(200).json({ success: true, data: chatBot });
    } catch (error) {
        next(error);
    }
};

// Update a chatBot if it belongs to the authenticated user
const updateChatBot = async (req, res, next) => {
    try {
        const updatedChatBot = await chatBotService.updateChatBot(req.params.id, req.body, req.user.userId);
        if (!updatedChatBot) {
            return res.status(404).json({ success: false, message: 'ChatBot not found or unauthorized' });
        }
        res.status(200).json({ success: true, data: updatedChatBot });
    } catch (error) {
        next(error);
    }
};

// Delete a chatBot if it belongs to the authenticated user
const deleteChatBot = async (req, res, next) => {
    try {
        const message = await chatBotService.deleteChatBot(req.params.id, req.user.userId);
        if (!message) {
            return res.status(404).json({ success: false, message: 'ChatBot not found or unauthorized' });
        }
        res.status(200).json({ success: true, message });
    } catch (error) {
        next(error);
    }
};

module.exports = {
  createChatBot, 
  getAllChatBot,
  getChatBotById,
  updateChatBot,
  deleteChatBot,
};