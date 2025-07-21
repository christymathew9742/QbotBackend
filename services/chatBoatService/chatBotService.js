const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const { errorResponse } = require('../../utils/errorResponse');

// Creating a new ChatBot with unique title validation
const createChatBot = async (chatBotData) => {
    try {
        const existingBot = await ChatBotModel.findOne({ title: chatBotData.title });
        if (existingBot) {
            chatBotData.title = `${chatBotData.title}-${Date.now()}`;
        }

        const chatBot = new ChatBotModel(chatBotData);
        if (!chatBot) {
            throw errorResponse('ChatBot not found', 404);
        }
        return await chatBot.save();
    } catch (error) {
        throw new Error(`Error creating ChatBot: ${error.message}`);
    }
};

// Getting all ChatBots with pagination, search, status
const getAllChatBot = async (userId, page = 1, limit = 10, search = '', status = null) => {

    try {
        const filter = { user: userId };
        search = search.trim();
        
        if (search) {
            filter.title = { $regex: search, $options: 'i' };
        }
    
        if (status && status !== 'null') {
            filter.status = status === 'true';
        }
    
        const skip = (page - 1) * limit;
    
        const bots = await ChatBotModel.find(filter)
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 });
    
        const total = await ChatBotModel.countDocuments(filter);
    
        return {
            data: bots,
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
        };
    } catch (error) {
        throw new Error(`Error fetching ChatBots: ${error.message}`);
    }    
};

// Getting a single ChatBot by ID for a specific user
const getChatBotById = async (id, userId) => {
    try {
        const chatBot = await ChatBotModel.findOne({ _id: id, user: userId });
        if (!chatBot) {
            throw errorResponse('ChatBot not found', 404);
        }
        return chatBot;
    } catch (error) {
        throw new Error(`Error fetching ChatBot: ${error.message}`);
    }
};

// Updating a ChatBot with unique title validation
const updateChatBot = async (id, chatBotData, userId) => {
    try {
        if (chatBotData.title) {
            const existingBot = await ChatBotModel.findOne({
                title: chatBotData.title,
                _id: { $ne: id },
            });
            if (existingBot) {
                chatBotData.title = `${chatBotData.title}-${Date.now()}`;
            }
        }

        const updatedChatBot = await ChatBotModel.findOneAndUpdate(
            { _id: id, user: userId },
            chatBotData,
            {
                new: true,
                runValidators: true,
            }
        );
        if (!updatedChatBot) {
            throw errorResponse('ChatBot not found', 404);
        }
        return updatedChatBot;
    } catch (error) {
        throw new Error(`Error updating ChatBot: ${error.message}`);
    }
};

// Deleting a ChatBot for a specific user
const deleteChatBot = async (id, userId) => {
    try {
        const chatBot = await ChatBotModel.findOneAndDelete({ _id: id, user: userId });
        if (!chatBot) {
            throw errorResponse('ChatBot not found', 404);
        }
        return 'ChatBot deleted successfully';
    } catch (error) {
        throw errorResponse(error.message || 'Error deleting ChatBot', error.status || 500);
    }
};

module.exports = {
    createChatBot,
    getAllChatBot,
    getChatBotById,
    updateChatBot,
    deleteChatBot,
};
