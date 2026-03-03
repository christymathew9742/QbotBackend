const googleCalendarService = require("../services/googleCalendarService");
const GoogleCalendarToken = require("../models/GoogleCalendarToken");

const FRONTEND_URL = "https://qbot-assistant.vercel.app" // process.env.FRONTEND_URL || "http://localhost:3001";

exports.connectCalendar = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
        return res.status(401).json({ message: "User not authenticated" });
    }

    const authUrl = googleCalendarService.generateAuthUrl(req.user.userId);
    res.status(200).json({ url: authUrl });
  } catch (err) {
    console.error("Error generating auth URL:", err);
    res.status(500).json({ message: "Failed to generate Google Calendar link" });
  }
};

exports.calendarCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state; 

    if (!code || !userId) {
      console.error("Callback missing code or userId");
      return res.redirect(`${FRONTEND_URL}/general-settings?tab=0&status=error&message=Missing_Credentials`);
    }

    await googleCalendarService.saveTokens(code, userId);

    return res.redirect(`${FRONTEND_URL}/general-settings?tab=0&status=connected`);

  } catch (err) {
    console.error("Calendar Callback Error:", err.message);

    const errorMessage = encodeURIComponent(err.message || "Unknown_Error");
    return res.redirect(`${FRONTEND_URL}/general-settings?tab=0&status=disconnected&message=${errorMessage}`);
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
      email: tokenData.email || "Connected",
    });
  } catch (err) {
    console.error("Status Check Error:", err);
    res.status(500).json({ message: "Error checking calendar status" });
  }
};

exports.disconnectCalendar = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    await GoogleCalendarToken.findOneAndDelete({ userId: req.user.userId });
    res.status(200).json({ message: "Disconnected successfully" });
  } catch (err) {
    console.error("Disconnect Error:", err);
    res.status(500).json({ message: "Error disconnecting calendar" });
  }
};