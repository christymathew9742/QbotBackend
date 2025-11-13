const { errorResponse } = require('../../utils/errorResponse');
const chatBotService = require('../../services/chatBoatService/chatBotService')
const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');

// Create cahtBot data
const createChatBot = async (req, res, next) => {
    try {
        if (!req.user || !req.user.userId) {
            return next(errorResponse('User not authenticated', 401));
        }

        const userId = req.user.userId;
        const chatBotData = { ...req.body, user: userId };

        const botCount = await ChatBotModel.countDocuments({ user: userId });

        if (botCount >= 10) {
            const error ='Maximum chatbot limit (10) reached. Cannot create more.';
            res.status(400).json({ success: false, error});
            next(errorResponse(error));
            return;
        }

        const chatBotResponse = await chatBotService.createChatBot(chatBotData);

        if (!chatBotResponse) {
            return res.status(400).json({ success: false, message: 'ChatBot not found or unauthorized' });
        }

        res.status(201).json({ success: true, data: chatBotResponse, message:"Saved successfully." });
    } catch (error) {
        next(errorResponse(error));
        res.status(400).json({ success: true, message:"Failed to saveing." });
    }
};

// Get all chatBot for the authenticated user
const getAllChatBot = async (req, res, next) => {
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }

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
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }

    try {
            const chatBot = await chatBotService.getChatBotById(req.params.id, req.user.userId);
            if (!chatBot) {
                return res.status(400).json({ success: false, message: 'ChatBot not found' });
            }
        res.status(200).json({ success: true, data: chatBot });
    } catch (error) {
        next(error);
    }
};

// Update a chatBot if it belongs to the authenticated user
const updateChatBot = async (req, res, next) => {
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }

    try {
        const updatedChatBot = await chatBotService.updateChatBot(req.params.id, req.body, req.user.userId);

        if (!updatedChatBot) {
            return res.status(400).json({ success: false, message: 'ChatBot not found or unauthorized' });
        }

        res.status(200).json({ success: true, data: updatedChatBot, message: "Updated successfully." });
    } catch (error) {
        next(error);
        res.status(400).json({ success: false, message:"Failed to Updating." });
    }
};

// Delete a chatBot if it belongs to the authenticated user
const deleteChatBot = async (req, res, next) => {
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }

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

// get Signed url form uploads
const getSignedUrlForUpload = async (req, res, next) => {
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }

    const userId =  req.user.userId;
    try {
        const { filename, contentType } = req.query;
        const { uploadUrl, publicUrl, key } = await chatBotService.getSignedUrlForUpload(
            userId,
            filename,
            contentType,
        );

        return res.status(200).json({ uploadUrl, publicUrl, key });
    } catch (err) {
        console.error("GCS signed URL error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// save to permenent folder
const saveFileToPermenmt = async (req, res) => {
    if (!req.user || !req.user.userId) {
        return res.status(401).json({ success: false, message: "User not found" });
    }

    const tempKey = req?.query?.tempKey;
    const filename = req?.query?.filename;
    const userId = req.user.userId;

    if (!tempKey || !filename) return res.status(400).json({ success: false, message: "Missing tempKey or filename" });

    try {
        const movedFile = await chatBotService.moveFileToPermanent(tempKey, userId, filename);

        if (!movedFile) {
            return res.status(404).json({ success: false, message: "Temp file not found or could not be moved" });
        }
        const { permanentKey, permanentUrl } = movedFile;

        return res.status(200).json({ success: true, permanentKey, permanentUrl });
    } catch (err) {
        console.error("Move file error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// delete uploads file
const deleteUploadFiles = async (req, res) => {
    if (!req.user || !req.user.userId) {
        return next(errorResponse('user not responding ', 401));
    }
    const { fileKey, chatbotId } = req.body;

    try {
        await chatBotService.deleteUploadFiles(fileKey, chatbotId, req.user.userId);
        res.json({ success: true, message: "File deleted successfully" });
    } catch (err) {
        console.error("File delete error:", err);
        res.status(500).json({ success: false, message: "Failed to delete file", error: err.message });
    }
};

module.exports = {
  createChatBot, 
  getAllChatBot,
  getChatBotById,
  updateChatBot,
  deleteChatBot,
  getSignedUrlForUpload,
  deleteUploadFiles,
  saveFileToPermenmt,
};