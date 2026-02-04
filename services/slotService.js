const Slots = require("../models/Slots"); // Your Slot Model
const GoogleCalendarService = require("./googleCalendarService"); // The service we created

class SlotService {
    
    /**
     * Confirms a booking and syncs it to Google Calendar
     * @param {String} slotId - The MongoDB _id of the slot
     * @returns {Object} - The updated slot document
     */
    static async confirmBooking(slotId) {
        try {
            // 1. Find the slot and verify it exists
            const slot = await Slots.findById(slotId);
            if (!slot) {
                throw new Error("Slot not found");
            }

            // 2. Update status to 'booked' in MongoDB
            // We verify the current status to prevent double booking logic here if needed
            slot.status = 'booked';
            await slot.save();

            console.log(`✅ Slot ${slotId} marked as BOOKED in DB.`);

            // 3. TRIGGER GOOGLE SYNC (The Magic Step)
            // We try to sync. If it fails, we log it but don't stop the booking.
            try {
                const googleEventId = await GoogleCalendarService.syncSlotToCalendar(slot);
                
                if (googleEventId) {
                    slot.googleEventId = googleEventId;
                    await slot.save();
                    console.log(`📅 Google Calendar Sync Success: ${googleEventId}`);
                }
            } catch (syncError) {
                console.error("⚠️ Google Sync Failed (Booking still saved):", syncError.message);
                // Optional: You could add a flag like 'syncFailed: true' to retry later
            }

            return slot;

        } catch (error) {
            console.error("Error in confirmBooking:", error.message);
            throw error;
        }
    }
}

module.exports = SlotService;