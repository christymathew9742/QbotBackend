const express = require('express');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const chatBotRoutes = require('./routes/chatBotRoute/chatBotRoute');
const appointmentRoutes = require('./routes/appointmentRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes/whatsappRoutes');
const notificationRoutes = require('./routes/notificationRoutes')
const googleCalendarRoutes = require('./routes/googleCalendarRoutes');

const adminRoutes = require('./routes/adminRoutes');
const bodyParser = require('body-parser');
const cors = require('cors');
const errorHandler = require('./middlewares/errorHandler');
const connectDB = require('./config/db');
require('dotenv').config();

const app = express();

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ✅ CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://qbotassistance.vercel.app',
  'https://qbot-assistant.vercel.app',
  'https://www.quickbot.store',
  'https://quickbot.store',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use('/api/auth/google-login', (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

connectDB();

app.use('/api/auth', authRoutes);
app.use('/api/auth/google', googleCalendarRoutes);
app.use('/api/createbots', chatBotRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);


app.use(bodyParser.json());
app.use(errorHandler);

module.exports = app;
