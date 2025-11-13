const { google } = require("googleapis");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDER,
    process.env.GOOGLE_CALENDER_SE,
    "http://localhost:5001/oauth2callback",
);

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

function parseSlot(slotStr) {
    if (!slotStr.startsWith("P-SSL-")) return null;
    const match = slotStr.match(/\[(.*?)\]/);
    if (!match) return null;

    const [start, end] = match[1].split("-").map((t) => t.trim());
    return { start, end };
}

function toDateTime(date, timeStr) {
    const [time, meridian] = timeStr.split(" ");
    let [hours, minutes] = time.split(":").map(Number);

    if (meridian === "PM" && hours !== 12) hours += 12;
    if (meridian === "AM" && hours === 12) hours = 0;

    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
}

    async function bookSlot(slotCode, date) {
    const slot = parseSlot(slotCode);
    if (!slot) return null;

    const startDateTime = toDateTime(date, slot.start);
    const endDateTime = toDateTime(date, slot.end);

    // Step 1: Check if slot already booked
    const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: startDateTime,
        timeMax: endDateTime,
    });

    if (existing.data.items.length > 0) {
        return { status: "failed", message: "Slot already booked" };
    }

    // Step 2: Create event
    const event = {
        summary: `Booking: ${slotCode}`,
        start: { dateTime: startDateTime },
        end: { dateTime: endDateTime },
    };

    const res = await calendar.events.insert({
        calendarId: "primary",
        resource: event,
    });

    return { status: "success", link: res.data.htmlLink };
}

module.exports = { 
    bookSlot 
};
