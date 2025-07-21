const express = require('express');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const chatBotRoute = require('./routes/chatBotRoute/chatBotRoute')
const whatsappRoutes = require('./routes/whatsappRoutes/whatsappRoutes');
const adminRoutes = require('./routes/adminRoutes');

const bodyParser = require('body-parser');
const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'https://qbotassistance.vercel.app', 'https://qbot-assistant.vercel.app'];

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
const cors = require('cors');

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

connectDB();

app.use('/api/auth', authRoutes);   
app.use('/api/createbots', chatBotRoute),
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/admin', adminRoutes);

app.use(bodyParser.json());
app.use(errorHandler);

module.exports = app;



























 
