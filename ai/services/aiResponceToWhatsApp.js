
const mongoose = require('mongoose');
const { ChatBotModel } = require("../../models/chatBotModel/chatBotModel");
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const aiResponceToWhatsApp = async (FlowId, userId, aiResponse) => {
    let preferenceData = null;
    const response = [];
    const type = aiResponse?.preference;

    try {
        if (mongoose.Types.ObjectId.isValid(FlowId) && mongoose.Types.ObjectId.isValid(userId)) {
            preferenceData = await ChatBotModel.findOne(
                {
                    _id: FlowId,
                    user: userId,
                    status: true,
                    "nodes.id": aiResponse?.nodeId,
                },
                {
                    nodes: { $elemMatch: { id: aiResponse?.nodeId } }
                }
            ).lean();
        }
    } catch (err) {
        console.error("❌ Error fetching preferenceData:", err);
    }

    preferenceData?.nodes?.forEach((node) => {
        node?.data?.inputs?.forEach((input) => {
            if (!input?.field) return;

            if (input?.field === 'replay') {
                // no-op
            } else if (input?.field === 'preference') {
                if (input?.type === "Slot" && Array.isArray(input?.slots)) {
                    const slotArray = [];

                    input?.slots.forEach((dateItem) => {
                        if (Array.isArray(dateItem?.slots) && dateItem.slots.length) {
                            dateItem.slots.forEach(({ id, start, end, interval, buffer }) => {
                                if (!id || !start || !end || !interval) {
                                    console.warn("⚠️ Skipping invalid slot:", { id, start, end, interval, buffer });
                                    return;
                                }

                                const startTime = new Date(start).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                    timeZone: userTimeZone,
                                }).replace(/^0/, "");

                                const endTime = new Date(end).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                    timeZone: userTimeZone,
                                });

                                const formattedDate = new Date(dateItem?.date).toLocaleDateString([], {
                                    month: "short",
                                    day: "2-digit",
                                });

                                slotArray.push({
                                    _id: `PS-${id}-${startTime}-${endTime}-${interval}-${buffer || 0}`,
                                    title: `${startTime} - ${endTime}, ${formattedDate}`,
                                });
                            });
                        }
                    });

                    if (slotArray.length) {
                        response.push({
                            optionsArray: {
                                mainTitle: "choose one of the common slots",
                                type: "list",
                                resp: slotArray,
                            },
                            isQuestion: true,
                        });
                    }
                } else {

                }
            }
        });
    });

    return response[0];
};

const createTimeSlots = (userOption, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
    if (!userOption || typeof userOption !== "string") {
        throw new Error("❌ Invalid userOption: must be a non-empty string");
    }

    const parts = userOption.split("-");
    if (parts.length < 6) {
        throw new Error("❌ Invalid userOption format, expected at least 6 parts separated by '-'");
    }

    const id = parts[1] || "NA";
    const startTime = parts[2];
    const endTime = parts[3];
    const interval = parseInt(parts[4], 10);
    const buffer = parseInt(parts[5] || "0", 10);

    if (!startTime || !endTime || Number.isNaN(interval)) {
        throw new Error("❌ startTime, endTime, and interval are required in userOption");
    }

    const slots = [];
    let idCounter = Date.now();

    // Convert "HH:mm" string to Date object
    const timeToDate = (timeStr) => {
        const [h, m] = timeStr.split(":").map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d;
    };

    // Format Date into localized 12-hour string
    const formatLocal = (date) => {
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone
        });
    };

    let current = new Date(timeToDate(startTime).getTime() + buffer * 60000);
    const end = timeToDate(endTime);

    while (current.getTime() + interval * 60000 <= end.getTime()) {
        const slotStart = formatLocal(current);
        const slotEnd = formatLocal(new Date(current.getTime() + interval * 60000));

        slots.push({
            id: `P-SL-${id}-[${slotStart}-${slotEnd}]`,
            slote: `${slotStart}-${slotEnd}`
        });

        // Move to next slot
        current = new Date(current.getTime() + (interval + buffer) * 60000);
    }

    console.log(JSON.stringify(slots), '✅ Generated slots');

    return {
        optionsArray: {
            mainTitle: "All available slots, choose one",
            type: "list",
            resp: slots.map(({ id, slote }) => ({ _id: id, title: slote })),
        },
        isQuestion: true
    };
};

module.exports = {
    aiResponceToWhatsApp,
    createTimeSlots,
};

