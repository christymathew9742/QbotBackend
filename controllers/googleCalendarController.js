const googleCalendarService = require("../services/googleCalendarService");
const GoogleCalendarToken = require("../models/GoogleCalendarToken");

exports.connectCalendar = async (req, res) => {
  try {
    const authUrl = googleCalendarService.generateAuthUrl(req.user.userId);
    res.status(200).json({ url: authUrl });
  } catch (err) {
    console.error("Error generating auth URL:", err);
    res.status(500).json({ message: "Failed to connect Google Calendar" });
  }
};

exports.calendarCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state;

    if (!code || !userId) {
      return res.status(400).send("Invalid request: Missing code or state");
    }

    await googleCalendarService.saveTokens(code, userId);

    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";

    res.redirect(`${FRONTEND_URL}/general-settings?tab=0&status=connected`);
  } catch (err) {
    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";

    res.redirect(`${FRONTEND_URL}/general-settings?tab=0&status=disconnected`);
  }
};

exports.getCalendarStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
       return res.status(401).json({ message: "Unauthorized" });
    }

    const tokenData = await GoogleCalendarToken.findOne({ userId: req.user.userId });
    
    if (!tokenData) {
      return res.status(200).json({ isConnected: false, email: ""});
    }

    res.status(200).json({ 
      isConnected: true, 
      email: tokenData.email || "",
    });
  } catch (err) {
    console.error("Status Check Error:", err);
    res.status(500).json({ message: "Error checking status" });
  }
};

exports.disconnectCalendar = async (req, res) => {
  try {
    await GoogleCalendarToken.findOneAndDelete({ userId: req.user.userId });
    res.status(200).json({ message: "Disconnected successfully" });
  } catch (err) {
    console.error("Disconnect Error:", err);
    res.status(500).json({ message: "Error disconnecting" });
  }
};