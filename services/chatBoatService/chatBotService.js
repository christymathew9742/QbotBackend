const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const { errorResponse } = require('../../utils/errorResponse');
const { Storage } = require("@google-cloud/storage");
const path = require('path');
const storage = new Storage({
  keyFilename: path.join(process.cwd(), 'gcs-key.json'),
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

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
    
        if (status && status !== '') {
            filter.status = status === 'enabled';
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

//get Signed url for upload
const getSignedUrlForUpload = async (userId, filename, contentType) => {

    const objectKey = `temp/${userId}/${filename}`;
    const file = bucket.file(objectKey);
    const options = {
        version: "v4",
        action: "write",
        expires: Date.now() + 15 * 60 * 1000, 
        contentType,
    };

    const [uploadUrl] = await file.getSignedUrl(options);
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectKey}`;

    return {
        uploadUrl,
        publicUrl,
        key: objectKey, 
    };
};

//move file to permanent
const moveFileToPermanent = async (tempKey, userId, filename) => {
    try {
        if (!tempKey.startsWith(`temp/${userId}/`)) {
            console.warn(`Temp file does not belong to user ${userId}: ${tempKey}`);
            return null; 
        }

        const tempFile = bucket?.file(tempKey);
        const [exists] = await tempFile.exists();
        if (!exists) {
            return null;
        }

        let permanentKey = `createbots/${userId}/${filename}`;
        let permanentFile = bucket.file(permanentKey);
        let [permExists] = await permanentFile.exists();

        if (permExists) {
            const timestamp = Date.now();
            const fileParts = filename.split('.');
            const name = fileParts.slice(0, -1).join('.');
            const ext = fileParts[fileParts.length - 1];
            permanentKey = `createbots/${userId}/${name}_${timestamp}.${ext}`;
            permanentFile = bucket.file(permanentKey);
        }

        await tempFile.copy(permanentFile);
        await tempFile.delete();

        const permanentUrl = `https://storage.googleapis.com/${bucket.name}/${permanentKey}`;
        return { permanentKey, permanentUrl };

    } catch (error) {
        console.error(`Failed to move temp file to permanent: ${tempKey} → ${filename}`, error.message);
        return null;
    }
};

const deleteUploadFiles = async (fileKey, chatbotId, userId) => {
    if (!fileKey || (Array.isArray(fileKey) && fileKey.length === 0)) return;

    const keys = Array.isArray(fileKey) ? fileKey : [fileKey];

    try {
        await Promise.all(
            keys.map((key) => bucket.file(key).delete({ ignoreNotFound: true }))
        );
        await ChatBotModel.updateOne(
            { _id: chatbotId, user: userId },
            {
                $set: {
                    nodes: await ChatBotModel.findOne({ _id: chatbotId, user: userId })
                    .then((chatBot) => {
                        if (!chatBot) return [];
                        chatBot.nodes.forEach((node) => {
                            node.data.inputs.forEach((input) => {
                                if (input.fileData) {
                                    input.fileData = input.fileData.filter(
                                        (file) => !keys.includes(file.key)
                                    );
                                }
                            });
                        });
                        return chatBot.nodes;
                    }),
                },
            }
        );

        return { success: true };
    } catch (err) {
        console.warn("File delete error:", err.message);
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
    moveFileToPermanent,
};
