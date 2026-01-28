const SlotService = require("../services/slotService");

// API Endpoint to manually confirm a booking
exports.bookSlot = async (req, res) => {
    try {
        const { slotId } = req.body; // Expecting { "slotId": "696e..." }

        if (!slotId) {
            return res.status(400).json({ success: false, message: "Slot ID is required" });
        }

        // Call the service we just made
        const updatedSlot = await SlotService.confirmBooking(slotId);

        return res.status(200).json({
            success: true,
            message: "Slot booked and synced successfully",
            data: updatedSlot
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};