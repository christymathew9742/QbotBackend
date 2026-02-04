// const { google } = require('googleapis');
// const oauth2Client = require("../config/googleOAuth");
// const GoogleCalendarToken = require("../models/GoogleCalendarToken");
// const Slots = require('../models/Slots');

// const convertTo12Hour = (timeStr) => {
//     const [hour, min] = timeStr.split(':');
//     let h = parseInt(hour);
//     const ampm = h >= 12 ? 'PM' : 'AM';
//     h = h % 12;
//     h = h ? h : 12;
//     return `${h}:${min} ${ampm}`;
// };

// const parseSlotString = (slotString) => {
//     try {
//         const parts = slotString.split('_');
//         if (parts.length < 4) return null;

//         const startTimeStr = parts[1];
//         const endTimeStr = parts[2];
//         const dateTimestamp = parseInt(parts[3]);

//         const dateObj = new Date(dateTimestamp);
//         const dateInIndia = new Intl.DateTimeFormat('en-CA', {
//             timeZone: 'Asia/Kolkata',
//             year: 'numeric',
//             month: '2-digit',
//             day: '2-digit'
//         }).format(dateObj);

//         const startISO = `${dateInIndia}T${startTimeStr}:00+05:30`;
//         const endISO = `${dateInIndia}T${endTimeStr}:00+05:30`;
//         const endDateTime = new Date(endISO);

//         return {
//             startISO,
//             endISO,
//             endDateTime,
//             displayTime: `${convertTo12Hour(startTimeStr)} - ${convertTo12Hour(endTimeStr)}`,
//             uniqueId: parts[4] || slotString
//         };
//     } catch (error) {
//         console.error("Slot Parsing Error:", error);
//         return null;
//     }
// };

// const generateAuthUrl = (userId) => {
//     return oauth2Client.generateAuthUrl({
//         access_type: "offline",
//         prompt: "consent",
//         scope: [
//             "https://www.googleapis.com/auth/calendar",
//             "https://www.googleapis.com/auth/userinfo.email"
//         ],
//         state: userId.toString(),
//     });
// };

// const saveTokens = async (code, userId) => {
//     const { tokens } = await oauth2Client.getToken(code);
//     oauth2Client.setCredentials(tokens);

//     let userEmail = "";
//     try {
//         const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
//         const userInfo = await oauth2.userinfo.get();
//         userEmail = userInfo.data.email;
//     } catch (error) {
//         throw new Error("Failed to retrieve email from Google.");
//     }

//     const existingConnection = await GoogleCalendarToken.findOne({ email: userEmail });

//     if (existingConnection && existingConnection.userId.toString() !== userId.toString()) {
//         throw new Error(`The email ${userEmail} is already connected to another account.`);
//     }

//     return GoogleCalendarToken.findOneAndUpdate(
//         { userId },
//         {
//             accessToken: tokens.access_token,
//             refreshToken: tokens.refresh_token,
//             expiryDate: tokens.expiry_date,
//             email: userEmail
//         },
//         { upsert: true, new: true }
//     );
// };

// const createBookingEvent = async (userId, profileName, slotDoc, appointmentData, refId, businessProfile, language, timezone) => {
//     try {
//         const tokenData = await GoogleCalendarToken.findOne({ userId });
//         if (!tokenData) return null;

//         oauth2Client.setCredentials({
//             access_token: tokenData.accessToken,
//             refresh_token: tokenData.refreshToken
//         });

//         const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
//         const timeData = parseSlotString(slotDoc.slot);

//         if (!timeData) return null;

//         const eventBody = {
//             summary: `🗓️ ${appointmentData?.title || 'Client Consultation'}`,
//             location: businessProfile || 'NimbleMeet',
//             description: `
//                 <b>Client Details</b>
//                 --------------------------------
//                 👤 <b>Name:</b> ${profileName || 'Valued Client'}
//                 📞 <b>Phone:</b> ${slotDoc.whatsappNumber}
//                 💬 <b>Action:</b> <a href="https://wa.me/${slotDoc.whatsappNumber}">Click to Chat</a>

//                 <b>Appointment Info</b>
//                 --------------------------------
//                 📝 <b>Service:</b> ${appointmentData?.title || 'General Booking'}
//                 🆔 <b>Reference ID:</b> ${refId || timeData.uniqueId}
//                 ✅ <b>Status:</b> Confirmed

//                 <i>Booked via NimbleMeet</i>
//             `,
//             start: { dateTime: timeData.startISO, timeZone: 'Asia/Kolkata' },
//             end: { dateTime: timeData.endISO, timeZone: 'Asia/Kolkata' },
//             colorId: '7',
//             reminders: {
//                 useDefault: false,
//                 overrides: [
//                     { method: 'popup', minutes: 15 },
//                     { method: 'email', minutes: 60 },
//                 ],
//             },
//         };

//         let response;

//         if (slotDoc.googleEventId) {
//             try {
//                 response = await calendar.events.update({
//                     calendarId: 'primary',
//                     eventId: slotDoc.googleEventId,
//                     resource: eventBody,
//                 });
//             } catch (updateError) {
//                 delete eventBody.id;
//                 response = await calendar.events.insert({
//                     calendarId: 'primary',
//                     resource: eventBody,
//                 });
//             }
//         } else {
//             response = await calendar.events.insert({
//                 calendarId: 'primary',
//                 resource: eventBody,
//             });
//         }
//         return response.data.id;

//     } catch (error) {
//         console.error(`Calendar Sync Failed:`, error.message);
//         return null;
//     }
// };

// const deleteBookingEvent = async (userId, googleEventId) => {
//     if (!googleEventId) return;

//     try {
//         const tokenData = await GoogleCalendarToken.findOne({ userId });
//         if (!tokenData) return;

//         oauth2Client.setCredentials({
//             access_token: tokenData.accessToken,
//             refresh_token: tokenData.refreshToken
//         });

//         const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

//         await calendar.events.delete({
//             calendarId: 'primary',
//             eventId: googleEventId
//         });
//     } catch (error) {
//         console.error("Failed to delete Google Event:", error.message);
//     }
// };

// const cleanupExpiredSlots = async () => {
//     try {
//         const allSlots = await Slots.find({});
//         const now = new Date();
//         const deletedIds = [];

//         for (const slotDoc of allSlots) {
//             const parsed = parseSlotString(slotDoc.slot);

//             if (parsed && parsed.endDateTime && parsed.endDateTime < now) {
//                 deletedIds.push(slotDoc._id);
//             }
//         }

//         if (deletedIds.length > 0) {
//             await Slots.deleteMany({ _id: { $in: deletedIds } });
//         }
//     } catch (error) {
//         console.error("Slot Cleanup Error:", error);
//     }
// };

// module.exports = {
//     generateAuthUrl,
//     saveTokens,
//     createBookingEvent,
//     deleteBookingEvent,
//     cleanupExpiredSlots
// };


const { google } = require('googleapis');
const oauth2Client = require("../config/googleOAuth");
const GoogleCalendarToken = require("../models/GoogleCalendarToken");
const Slots = require('../models/Slots');

const parseSlotString = (slotString, timezone = 'Asia/Kolkata', language = 'en-US') => {
    try {
        const parts = slotString.split('_');
        if (parts.length < 4) return null;

        const startTimeStr = parts[1];
        const endTimeStr = parts[2];
        const dateTimestamp = parseInt(parts[3]);
        const dateObj = new Date(dateTimestamp);
        const isoFormatter = new Intl.DateTimeFormat('en-CA', { 
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const dateInTargetZone = isoFormatter.format(dateObj); 

        const prettyFormatter = new Intl.DateTimeFormat(language, {
            timeZone: timezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const prettyDate = prettyFormatter.format(dateObj);

        const timeOptions = { hour: 'numeric', minute: 'numeric', timeZone: timezone };
        const displayStart = new Date(`${dateInTargetZone}T${startTimeStr}:00`).toLocaleTimeString(language, timeOptions);
        const displayEnd = new Date(`${dateInTargetZone}T${endTimeStr}:00`).toLocaleTimeString(language, timeOptions);
        const startISO = `${dateInTargetZone}T${startTimeStr}:00`;
        const endISO = `${dateInTargetZone}T${endTimeStr}:00`;

        const endDateTime = new Date(endISO); 

        return {
            startISO,
            endISO,
            endDateTime,
            startTimeStr, 
            endTimeStr,
            prettyDate,
            displayTime: `${displayStart} - ${displayEnd}`,
            uniqueId: parts[4] || slotString
        };
    } catch (error) {
        console.error("Slot Parsing Error:", error);
        return null;
    }
};

const generateAuthUrl = (userId) => {
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/userinfo.email"
        ],
        state: userId.toString(),
    });
};

const saveTokens = async (code, userId) => {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let userEmail = "";
    try {
        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const userInfo = await oauth2.userinfo.get();
        userEmail = userInfo.data.email;
    } catch (error) {
        throw new Error("Failed to retrieve email from Google.");
    }

    const existingConnection = await GoogleCalendarToken.findOne({ email: userEmail });

    if (existingConnection && existingConnection.userId.toString() !== userId.toString()) {
        throw new Error(`The email ${userEmail} is already connected to another account.`);
    }

    return GoogleCalendarToken.findOneAndUpdate(
        { userId },
        {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiryDate: tokens.expiry_date,
            email: userEmail
        },
        { upsert: true, new: true }
    );
};

const createBookingEvent = async (userId, profileName, slotDoc, appointmentData, refId, businessProfile, language, timezone) => {
    try {
        const tokenData = await GoogleCalendarToken.findOne({ userId });
        if (!tokenData) return null;

        const userTimeZone = timezone || 'Asia/Kolkata';
        const userLanguage = language || 'en-US';

        oauth2Client.setCredentials({
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const timeData = parseSlotString(slotDoc.slot, userTimeZone, userLanguage);

        if (!timeData) return null;

        const eventBody = {
            summary: `🗓️ ${appointmentData?.title || 'Client Consultation'}`,
            location: businessProfile || 'NimbleMeet',
            description: `
                <b>Client Details</b>
                --------------------------------
                👤 <b>Name:</b> ${profileName || 'Valued Client'}
                📞 <b>Phone:</b> ${slotDoc.whatsappNumber}
                💬 <b>Action:</b> <a href="https://wa.me/${slotDoc.whatsappNumber}">Click to Chat</a>

                <b>Appointment Info</b>
                --------------------------------
                📝 <b>Service:</b> ${appointmentData?.title || 'General Booking'}
                🆔 <b>Reference ID:</b> ${refId || timeData.uniqueId}
                ✅ <b>Status:</b> Confirmed

                <i>Booked via NimbleMeet</i>
            `,
            start: { 
                dateTime: timeData.startISO, 
                timeZone: userTimeZone 
            },
            end: { 
                dateTime: timeData.endISO, 
                timeZone: userTimeZone 
            },
            colorId: '7',
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 15 },
                    { method: 'email', minutes: 60 },
                ],
            },
        };

        let response;

        if (slotDoc.googleEventId) {
            try {
                response = await calendar.events.update({
                    calendarId: 'primary',
                    eventId: slotDoc.googleEventId,
                    resource: eventBody,
                });
            } catch (updateError) {
                delete eventBody.id;
                response = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: eventBody,
                });
            }
        } else {
            response = await calendar.events.insert({
                calendarId: 'primary',
                resource: eventBody,
            });
        }
        return response.data.id;

    } catch (error) {
        console.error(`Calendar Sync Failed:`, error.message);
        return null;
    }
};

const deleteBookingEvent = async (userId, googleEventId) => {
    if (!googleEventId) return;

    try {
        const tokenData = await GoogleCalendarToken.findOne({ userId });
        if (!tokenData) return;

        oauth2Client.setCredentials({
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        await calendar.events.delete({
            calendarId: 'primary',
            eventId: googleEventId
        });
    } catch (error) {
        console.error("Failed to delete Google Event:", error.message);
    }
};

const cleanupExpiredSlots = async () => {
    try {
        const allSlots = await Slots.find({});
        const now = new Date();
        const deletedIds = [];

        for (const slotDoc of allSlots) {
            const parsed = parseSlotString(slotDoc.slot);

            if (parsed && parsed.endDateTime && parsed.endDateTime < now) {
                deletedIds.push(slotDoc._id);
            }
        }

        if (deletedIds.length > 0) {
            await Slots.deleteMany({ _id: { $in: deletedIds } });
        }
    } catch (error) {
        console.error("Slot Cleanup Error:", error);
    }
};

module.exports = {
    generateAuthUrl,
    saveTokens,
    createBookingEvent,
    deleteBookingEvent,
    cleanupExpiredSlots
};
