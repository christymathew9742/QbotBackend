// const { google } = require('googleapis');
// const oauth2Client = require("../config/googleOAuth");
// const GoogleCalendarToken = require("../models/GoogleCalendarToken");
// const Slots = require('../models/Slots');

// const parseSlotString = (slotString, timezone = 'Asia/Kolkata', language = 'en-US') => {
//     try {
//         const parts = slotString.split('_');
//         if (parts.length < 4) return null;

//         const startTimeStr = parts[1];
//         const endTimeStr = parts[2];
//         const dateTimestamp = parseInt(parts[3]);
//         const dateObj = new Date(dateTimestamp);
//         const isoFormatter = new Intl.DateTimeFormat('en-CA', { 
//             timeZone: timezone,
//             year: 'numeric',
//             month: '2-digit',
//             day: '2-digit'
//         });
//         const dateInTargetZone = isoFormatter.format(dateObj); 

//         const prettyFormatter = new Intl.DateTimeFormat(language, {
//             timeZone: timezone,
//             weekday: 'long',
//             year: 'numeric',
//             month: 'long',
//             day: 'numeric'
//         });
//         const prettyDate = prettyFormatter.format(dateObj);

//         const timeOptions = { hour: 'numeric', minute: 'numeric', timeZone: timezone };
//         const displayStart = new Date(`${dateInTargetZone}T${startTimeStr}:00`).toLocaleTimeString(language, timeOptions);
//         const displayEnd = new Date(`${dateInTargetZone}T${endTimeStr}:00`).toLocaleTimeString(language, timeOptions);
//         const startISO = `${dateInTargetZone}T${startTimeStr}:00`;
//         const endISO = `${dateInTargetZone}T${endTimeStr}:00`;

//         const endDateTime = new Date(endISO); 

//         return {
//             startISO,
//             endISO,
//             endDateTime,
//             startTimeStr, 
//             endTimeStr,
//             prettyDate,
//             displayTime: `${displayStart} - ${displayEnd}`,
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

//         const userTimeZone = timezone || 'Asia/Kolkata';
//         const userLanguage = language || 'en-US';

//         oauth2Client.setCredentials({
//             access_token: tokenData.accessToken,
//             refresh_token: tokenData.refreshToken
//         });

//         const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
//         const timeData = parseSlotString(slotDoc.slot, userTimeZone, userLanguage);

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
//             start: { 
//                 dateTime: timeData.startISO, 
//                 timeZone: userTimeZone 
//             },
//             end: { 
//                 dateTime: timeData.endISO, 
//                 timeZone: userTimeZone 
//             },
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

// --- Helper: Parse Slot String (Unchanged) ---
const parseSlotString = (slotString, timezone = 'Asia/Kolkata', language = 'en-US') => {
    try {
        const parts = slotString.split('_');
        if (parts.length < 4) return null;

        const startTimeStr = parts[1];
        const endTimeStr = parts[2];
        const dateTimestamp = parseInt(parts[3]);
        const dateObj = new Date(dateTimestamp);
        
        // Formatter for ISO date (YYYY-MM-DD) in target timezone
        const isoFormatter = new Intl.DateTimeFormat('en-CA', { 
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const dateInTargetZone = isoFormatter.format(dateObj); 

        // Formatter for Pretty Date (e.g., Monday, January 1st)
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

// --- Helper: Find or Create Calendar by Name (NEW) ---
const getOrCreateCalendarId = async (calendarClient, calendarName) => {
    try {
        // 1. List existing calendars to check if it already exists
        const calendarList = await calendarClient.calendarList.list({
            minAccessRole: 'owner'
        });

        const existingCalendar = calendarList.data.items.find(
            cal => cal.summary.toLowerCase() === calendarName.toLowerCase()
        );

        if (existingCalendar) {
            return existingCalendar.id;
        }

        // 2. If not found, create a new secondary calendar
        const newCalendar = await calendarClient.calendars.insert({
            resource: {
                summary: calendarName,
                timeZone: 'Asia/Kolkata' // Default creation timezone
            }
        });

        return newCalendar.data.id;

    } catch (error) {
        console.error("Error finding/creating calendar:", error.message);
        // Fallback to 'primary' if creation fails to prevent breaking the app
        return 'primary';
    }
};

// --- Auth Functions (Unchanged) ---
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

// --- Main: Create Booking (UPDATED) ---
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

        // --- DYNAMIC CALENDAR LOGIC START ---
        // Use appointmentData.title as the Department Name. Fallback to 'General' if missing.
        const departmentName = appointmentData?.title || 'General';
        
        // Get the specific Calendar ID for this department
        const targetCalendarId = await getOrCreateCalendarId(calendar, departmentName);
        // --- DYNAMIC CALENDAR LOGIC END ---

        const eventBody = {
            summary: `🗓️ ${appointmentData?.title || 'Client Consultation'}`,
            location: businessProfile || 'NimbleMeet',
            description: `
                <b>Client Details</b>
                --------------------------------
                👤 <b>Name:</b> ${profileName || 'Valued Client'}
                📞 <b>Phone:</b> ${slotDoc.whatsappNumber}
                🏢 <b>Dept:</b> ${departmentName}
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
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 15 },
                    { method: 'email', minutes: 60 },
                ],
            },
        };

        let response;

        // NOTE: When updating, we need to know the calendar ID. 
        // If your logic assumes 'primary' for old events, this update block might need adjustment.
        // For new dynamic calendars, we use targetCalendarId.
        
        if (slotDoc.googleEventId) {
            try {
                response = await calendar.events.update({
                    calendarId: targetCalendarId, // Use the dynamic ID
                    eventId: slotDoc.googleEventId,
                    resource: eventBody,
                });
            } catch (updateError) {
                delete eventBody.id;
                response = await calendar.events.insert({
                    calendarId: targetCalendarId,
                    resource: eventBody,
                });
            }
        } else {
            response = await calendar.events.insert({
                calendarId: targetCalendarId,
                resource: eventBody,
            });
        }
        
        // IMPORTANT: Return BOTH the event ID and the Calendar ID so you can save them.
        return { 
            eventId: response.data.id, 
            calendarId: targetCalendarId 
        };

    } catch (error) {
        console.error(`Calendar Sync Failed:`, error.message);
        return null;
    }
};

// --- Main: Delete Booking (UPDATED) ---
// Now requires calendarId because we don't know which department calendar it's in otherwise
const deleteBookingEvent = async (userId, googleEventId, calendarId = 'primary') => {
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
            calendarId: calendarId, // Must match where it was created
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