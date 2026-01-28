// const express = require("express");
// const router = express.Router();
// const authMiddleware = require("../middlewares/authMiddleware");

// const { 
//   connectCalendar, 
//   calendarCallback,
//   getCalendarStatus,
//   disconnectCalendar
// } = require("../controllers/googleCalendarController");

// router.get("/calendar/connect", authMiddleware, connectCalendar);
// router.get("/calendar/callback", calendarCallback);
// router.get("/calendar/status", authMiddleware, getCalendarStatus); 
// router.post("/calendar/disconnect", authMiddleware, disconnectCalendar);

// module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

// Import the controller functions directly
const { 
  connectCalendar, 
  calendarCallback,
  getCalendarStatus,
  disconnectCalendar
} = require("../controllers/googleCalendarController");

router.get("/calendar/connect", authMiddleware, connectCalendar);
router.get("/calendar/callback", calendarCallback);
router.get("/calendar/status", authMiddleware, getCalendarStatus); 
router.post("/calendar/disconnect", authMiddleware, disconnectCalendar);

module.exports = router;