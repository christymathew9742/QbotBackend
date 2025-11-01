const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const { errorResponse } = require('../../utils/errorResponse');
const { Storage } = require("@google-cloud/storage");
const path = require('path');
const storage = new Storage({
  keyFilename: path.join(process.cwd(), 'gcs-key.json'),
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const os = require("os");
const ffmpegPath = require("ffmpeg-static");
const archiver = require("archiver");
const sharp = require("sharp");

ffmpeg.setFfmpegPath(ffmpegPath);

const LIMITS = {
    IMAGE_MB: parseFloat(process.env.IMG_LIMIT_MB) || 2,
    VIDEO_MB: parseFloat(process.env.VID_LIMIT_MB) || 10,
    AUDIO_MB: parseFloat(process.env.AUD_LIMIT_MB) || 10,
    DOC_MB: parseFloat(process.env.DOC_LIMIT_MB) || 10,
};


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

async function compressImage(inputPath, outputPath) {
    try {
        await sharp(inputPath)
        .rotate()
        .toFormat("webp", { quality: 80 })
        .toFile(outputPath);
        return fs.statSync(outputPath).size;
    } catch (err) {
        console.warn("⚠️ Image compression failed:", err.message);
        return fs.statSync(inputPath).size;
    }
}

async function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
        .audioBitrate("128k")
        .save(outputPath)
        .on("end", () => resolve(fs.statSync(outputPath).size))
        .on("error", reject);
    });
}

const compressVideo = async (inputPath, outputPath, maxBytes) => {
    let crf = 24;
    let compressedSize = fs.statSync(inputPath).size;
    while (compressedSize > maxBytes && crf <= 40) {
        await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                "-vcodec libx264",
                `-crf ${crf}`,
                "-preset veryfast",
                "-movflags +faststart",
            ])
            .save(outputPath)
            .on("end", resolve)
            .on("error", reject);
        });
        compressedSize = fs.statSync(outputPath).size;
        if (compressedSize > maxBytes) crf += 2;
        else break;
    }
    return compressedSize;
}

const compressDocument = async (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver("zip", { zlib: { level: 9 } });
        output.on("close", () => resolve(fs.statSync(outputPath).size));
        archive.on("error", reject);
        archive.pipe(output);
        archive.file(inputPath, { name: path.basename(inputPath) });
        archive.finalize();
    });
}

const moveFileToPermanent = async (tempKey, userId, filename) => {
    try {
        if (!tempKey.startsWith(`temp/${userId}/`)) {
            console.warn(`Temp file does not belong to user ${userId}: ${tempKey}`);
            return null;
        }

        const tempFile = bucket.file(tempKey);
        const [exists] = await tempFile.exists();
        if (!exists) return null;

        const tempLocalPath = path.join(os.tmpdir(), filename);
        await tempFile.download({ destination: tempLocalPath });
        let ext = path.extname(filename)?.toLowerCase() || '';
        if (!ext && tempKey) ext = path.extname(tempKey)?.toLowerCase() || '';
        if (!ext) ext = '.png'; 
        if (!filename.endsWith(ext)) filename = `${filename}${ext}`;

        const fileSize = fs.statSync(tempLocalPath).size;
        const maxBytes = (mb) => mb * 1024 * 1024;
        let finalLocalPath = tempLocalPath;

        const isVideo = [".mp4", "3gp"].includes(ext);
        const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
        const isAudio = [".mp3", ".wav", ".aac", ".ogg", ".m4a"].includes(ext);
        const isDoc = [".pdf", ".docx", ".xlsx", ".pptx"].includes(ext);

        const compressedPath = path.join(os.tmpdir(), `compressed_${filename}`);

        if (isVideo && fileSize > maxBytes(LIMITS.VIDEO_MB)) {
            await compressVideo(tempLocalPath, compressedPath, maxBytes(LIMITS.VIDEO_MB));
            finalLocalPath = compressedPath;
        } else if (isImage && fileSize > maxBytes(LIMITS.IMAGE_MB)) {
            await compressImage(tempLocalPath, compressedPath);
            finalLocalPath = compressedPath;
        } else if (isAudio && fileSize > maxBytes(LIMITS.AUDIO_MB)) {
            await compressAudio(tempLocalPath, compressedPath);
            finalLocalPath = compressedPath;
        } else if (isDoc && fileSize > maxBytes(LIMITS.DOC_MB)) {
            await compressDocument(tempLocalPath, compressedPath);
            finalLocalPath = compressedPath;
        }

        if (!path.extname(finalLocalPath)) {
            const newPath = `${finalLocalPath}${ext}`;
            try {
                fs.renameSync(finalLocalPath, newPath);
                finalLocalPath = newPath;
            } catch (renameErr) {
                console.warn(`⚠️ Failed to rename file with extension: ${renameErr.message}`);
            }
        }

        let permanentKey = `createbots/${userId}/${filename}`;
        let permanentFile = bucket.file(permanentKey);
        const [permExists] = await permanentFile.exists();

        if (permExists) {
            const timestamp = Date.now();
            const baseName = path.basename(filename, ext || '');
            permanentKey = `createbots/${userId}/${baseName}_${timestamp}${ext}`;
            permanentFile = bucket.file(permanentKey);
        }

        await bucket.upload(finalLocalPath, {
            destination: permanentKey,
            resumable: false,
            gzip: true,
        });

        await fs.promises.unlink(tempLocalPath).catch(() => {});
        if (finalLocalPath !== tempLocalPath && fs.existsSync(finalLocalPath)) {
            await fs.promises.unlink(finalLocalPath).catch(() => {});
        }

        await tempFile.delete();

        const permanentUrl = `https://storage.googleapis.com/${bucket.name}/${permanentKey}`;
        return { permanentKey, permanentUrl };

    } catch (error) {
        console.error(`❌ Failed to move temp file: ${error.message}`);
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
