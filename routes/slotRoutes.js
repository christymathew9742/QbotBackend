const express = require("express");
const router = express.Router();
const slotController = require("../controllers/slotController");
const authMiddleware = require("../middlewares/authMiddleware"); // Optional: Protect this route

// Route: POST /api/slots/book
router.post("/book", authMiddleware, slotController.bookSlot);

module.exports = router;