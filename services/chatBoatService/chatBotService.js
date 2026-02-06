const { ChatBotModel } = require('../../models/chatBotModel/chatBotModel');
const { errorResponse } = require('../../utils/errorResponse');
const { Storage } = require("@google-cloud/storage");
const path = require('path');
const mime = require("mime-types");
const storage = new Storage({
    projectId: process.env.GCS_PROJECT_ID,
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

function safeStatSync(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return fs.statSync(filePath);
    } catch (e) {
        return null;
    }
}

function extFromContentType(contentType) {
    if (!contentType) return "";
    const ext = mime.extension(contentType);
    return ext ? `.${ext}` : "";
}

function ensurePathHasExt(p, ext) {
    if (!path.extname(p) && ext) return `${p}${ext}`;
    return p;
}

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

async function compressImage(inputPath, outputPath, originalExt) {
    try {
        const extNoDot = (originalExt || "").replace(".", "").toLowerCase();
        let format = extNoDot || "webp"; 
        if (!["jpg", "jpeg", "png", "webp", "tiff", "gif"].includes(format)) {
            format = "webp";
        }

        const desiredOutputPath = ensurePathHasExt(outputPath, `.${format}`);
        let pipeline = sharp(inputPath).rotate();

        if (format === "jpeg" || format === "jpg") {
            pipeline = pipeline.jpeg({ quality: 80 });
        } else if (format === "png") {
            pipeline = pipeline.png({ compressionLevel: 8, quality: 80 });
        } else if (format === "webp") {
            pipeline = pipeline.webp({ quality: 80 });
        } else {
            pipeline = pipeline.webp({ quality: 80 });
        }

        await pipeline.toFile(desiredOutputPath);

        const stats = safeStatSync(desiredOutputPath);
        return {
            size: stats ? stats.size : null,
            path: desiredOutputPath,
            ext: `.${format}`,
            contentType: mime.lookup(format) || "application/octet-stream",
        };
    } catch (err) {
        console.warn("⚠️ Image compression failed:", err.message);
        const stats = safeStatSync(inputPath);
        return {
        size: stats ? stats.size : null,
        path: inputPath,
        ext: path.extname(inputPath) || ".png",
        contentType: mime.lookup(path.extname(inputPath)) || "application/octet-stream",
        };
    }
}

async function compressAudio(inputPath, outputPath, originalExt) {
    return new Promise((resolve, reject) => {
        const ext = (originalExt && originalExt.replace(".", "")) || "mp3";
        const desiredOutputPath = ensurePathHasExt(outputPath, `.${ext}`);

        ffmpeg(inputPath)
        .noVideo()
        .audioBitrate("128k")
        .format(ext)
        .on("end", () => {
            const stats = safeStatSync(desiredOutputPath);
            resolve({
            size: stats ? stats.size : null,
            path: desiredOutputPath,
            ext: `.${ext}`,
            contentType: mime.lookup(ext) || "audio/mpeg",
            });
        })
        .on("error", (err) => reject(err))
        .save(desiredOutputPath);
    });
}

const compressVideo = async (inputPath, outputPath, maxBytes) => {
    const desiredOutputPath = ensurePathHasExt(outputPath, ".mp4");
    const runFfmpeg = (crfVal, scale) =>
        new Promise((resolve, reject) => {
        const ff = ffmpeg(inputPath)
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions([
            `-crf ${crfVal}`,
            "-preset veryfast",
            "-movflags +faststart",
            "-profile:v baseline",
            "-level 3.0",
            "-pix_fmt yuv420p",
            ]);
        if (scale) ff.videoFilters(`scale=${scale}`);
        ff.on("end", () => resolve())
            .on("error", (err) => reject(err))
            .save(desiredOutputPath);
        });

    try {
        let bestStats = safeStatSync(inputPath);
        let bestSize = bestStats ? bestStats.size : 0;
        let bestPath = inputPath;

        for (let crf = 24; crf <= 40; crf += 2) {
            await runFfmpeg(crf);
            const s = safeStatSync(desiredOutputPath);
            if (!s) continue;
            if (s.size < bestSize) {
                bestSize = s.size;
                bestPath = desiredOutputPath;
            }
            if (s.size <= maxBytes) break;
        }

        const scaleSteps = ["1280:-1", "854:-1", "640:-1"];
        let finalStats = safeStatSync(bestPath);
        if (finalStats && finalStats.size > maxBytes) {
            for (const scale of scaleSteps) {
                await runFfmpeg(32, scale);
                const s = safeStatSync(desiredOutputPath);
                if (s && s.size < bestSize) {
                bestSize = s.size;
                bestPath = desiredOutputPath;
                }
                if (s && s.size <= maxBytes) break;
            }
        }

        finalStats = safeStatSync(desiredOutputPath) || safeStatSync(bestPath);

        if (!finalStats) throw new Error("Video compression produced no output");

        if (finalStats.size > maxBytes) {
            console.warn(
                `⚠️ Video could not be reduced below limit (${(
                finalStats.size /
                1024 /
                1024
                ).toFixed(2)} MB > ${(maxBytes / 1024 / 1024).toFixed(
                2
                )} MB). Uploading best possible version.`
            );
        }

        return {
            size: finalStats.size,
            path: desiredOutputPath,
            ext: ".mp4",
            contentType: "video/mp4",
        };
    } catch (err) {
        console.warn("⚠️ Video compression failed:", err.message);
        const stats = safeStatSync(inputPath);
        return {
            size: stats ? stats.size : null,
            path: inputPath,
            ext: ".mp4",
            contentType: "video/mp4",
        };
    }
};

const compressDocument = async (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        const desiredOutputPath = ensurePathHasExt(outputPath, ".zip");
        const output = fs.createWriteStream(desiredOutputPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", () => {
            const stats = safeStatSync(desiredOutputPath);
            resolve({
                size: stats ? stats.size : null,
                path: desiredOutputPath,
                ext: ".zip",
                contentType: "application/zip",
            });
        });
        archive.on("error", (err) => reject(err));
        archive.pipe(output);
        archive.file(inputPath, { name: path.basename(inputPath) });
        archive.finalize();
    });
};

const moveFileToPermanent = async (tempKey, userId, filename) => {
    try {
        if (!tempKey.startsWith(`temp/${userId}/`)) {
            console.warn(`Temp file does not belong to user ${userId}: ${tempKey}`);
            return null;
        }

        const tempFile = bucket.file(tempKey);
        const [exists] = await tempFile.exists();
        if (!exists) return null;

        const [metadata] = await tempFile.getMetadata().catch(() => [null]);
        const remoteContentType = metadata?.contentType || null;

        let ext = path.extname(filename)?.toLowerCase() || "";
        if (!ext && remoteContentType) {
            ext = extFromContentType(remoteContentType);
        }
        if (!ext) {
            ext = ".bin";
        }

        if (!filename.endsWith(ext)) filename = `${filename}${ext}`;

        const tempLocalPath = path.join(os.tmpdir(), `tempfile_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        await tempFile.download({ destination: tempLocalPath });

        const fileStat = safeStatSync(tempLocalPath);
        if (!fileStat) throw new Error("Downloaded file missing");

        const fileSize = fileStat.size;
        const maxBytes = (mb) => mb * 1024 * 1024;

        const isVideo = [".mp4", ".3gp", ".mov", ".mkv"].includes(ext);
        const isImage = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff"].includes(ext);
        const isAudio = [".mp3", ".wav", ".aac", ".ogg", ".m4a"].includes(ext);
        const isDoc = [".pdf", ".docx", ".xlsx", ".pptx"].includes(ext);

        const compressedPathBase = path.join(os.tmpdir(), `compressed_${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(filename, ext)}`);

        let finalLocalPath = tempLocalPath;
        let finalExt = ext;
        let finalContentType = remoteContentType || mime.lookup(ext) || "application/octet-stream";

        if (isVideo && fileSize > maxBytes(LIMITS.VIDEO_MB)) {
            const result = await compressVideo(tempLocalPath, compressedPathBase, maxBytes(LIMITS.VIDEO_MB));
            finalLocalPath = result.path;
            finalExt = result.ext;
            finalContentType = result.contentType || "video/mp4";
        } else if (isImage && fileSize > maxBytes(LIMITS.IMAGE_MB)) {
            const result = await compressImage(tempLocalPath, compressedPathBase, ext);
            finalLocalPath = result.path;
            finalExt = result.ext;
            finalContentType = result.contentType || mime.lookup(finalExt) || "image/*";
        } else if (isAudio && fileSize > maxBytes(LIMITS.AUDIO_MB)) {
            const result = await compressAudio(tempLocalPath, compressedPathBase, ext);
            finalLocalPath = result.path;
            finalExt = result.ext;
            finalContentType = result.contentType || mime.lookup(finalExt) || "audio/*";
        } else if (isDoc && fileSize > maxBytes(LIMITS.DOC_MB)) {
            const result = await compressDocument(tempLocalPath, compressedPathBase);
            finalLocalPath = result.path;
            finalExt = result.ext;
            finalContentType = result.contentType || "application/zip";
        } else {
            finalExt = path.extname(finalLocalPath) || ext;
            finalContentType = remoteContentType || mime.lookup(finalExt) || "application/octet-stream";
        }

        let baseName = path.basename(filename, ext);
        if (!baseName) baseName = `file_${Date.now()}`;
        let permanentFilename = `${baseName}${finalExt}`;

        let permanentKey = `createbots/${userId}/${permanentFilename}`;
        let permanentFile = bucket.file(permanentKey);
        const [permExists] = await permanentFile.exists();
        if (permExists) {
            const timestamp = Date.now();
            permanentFilename = `${baseName}_${timestamp}${finalExt}`;
            permanentKey = `createbots/${userId}/${permanentFilename}`;
            permanentFile = bucket.file(permanentKey);
        }

        await bucket.upload(finalLocalPath, {
            destination: permanentKey,
            resumable: false,
            gzip: true,
            metadata: {
                contentType: finalContentType,
                cacheControl: "public, max-age=31536000", // optional
            },
        });

        try { if (fs.existsSync(tempLocalPath)) await fs.promises.unlink(tempLocalPath); } catch (e) {}
        try { if (finalLocalPath !== tempLocalPath && fs.existsSync(finalLocalPath)) await fs.promises.unlink(finalLocalPath); } catch (e) {}

        await tempFile.delete().catch(() => { /* ignore */ });

        const permanentUrl = `https://storage.googleapis.com/${bucket.name}/${permanentKey}`;
        return { permanentKey, permanentUrl, contentType: finalContentType, filename: permanentFilename };
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
