// const app = require('./app');
// const User = require('./models/User');
// const bcrypt = require('bcryptjs');
// const WebSocket = require('ws'); 

// const PORT = process.env.PORT || 5001;

// (async () => {
//     try {
        
//         const existingSuperAdmin = await User.findOne({ role: 'superadmin' });
//         const newEmail = process.env.SUPER_ADMIN_EMAIL;
//         const newUsername = 'Super Admin';
//         const newPassword = process.env.SUPER_ADMIN_PASSWORD;
//         let passwordMatch = false;

//         if (existingSuperAdmin?.password) {
//             passwordMatch = bcrypt.compareSync(newPassword, existingSuperAdmin?.password);
//         }

//         if (existingSuperAdmin && (existingSuperAdmin.email !== newEmail || !passwordMatch)) {
//             await User.deleteOne({ _id: existingSuperAdmin._id });
//             console.log('⚠️ Existing super admin deleted due to mismatch');
//         }

//         const currentAdmin = await User.findOne({ email: newEmail });

//         if (!currentAdmin ) {
//             const newAdmin = new User({
//                 username: newUsername,
//                 email: newEmail,
//                 password: newPassword,
//                 confirmPassword: newPassword,
//                 role: 'superadmin', 
//             });

//             await newAdmin.save();
//             console.log('✅ New super admin created');
//         }

//         // Start HTTP server
//         const server = app.listen(PORT, () => {
//             console.log(`🚀 Server running on port ${PORT}`);
//         });

//         // Start WebSocket server
//         const wss = new WebSocket.Server({ server });
//         wss.on('connection', (ws) => {
//             console.log('🔗 A new client connected');
//             ws.on('message', (message) => {
//                 console.log(`📨 Received message: ${message}`);
//                 wss.clients.forEach((client) => {
//                 if (client.readyState === WebSocket.OPEN) {
//                     client.send(message);
//                 }
//                 });
//             });
//             ws.send('Welcome to the WebSocket server');
//         });

//     } catch (error) {
//         console.error('❌ Server initialization failed:', error);
//         process.exit(1);  
//     }
// })(); 


const app = require('./app');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const AppointmentModal = require('./models/AppointmentModal');
const { initWebSocket } = require('./utils/notifications');

const PORT = process.env.PORT || 5001;

let wss; // Declare WebSocket server globally

// Main async function to start server
(async () => {
    try {
        // -------------------------
        // Super Admin Setup
        // -------------------------
        const existingSuperAdmin = await User.findOne({ role: 'superadmin' });
        const newEmail = process.env.SUPER_ADMIN_EMAIL;
        const newUsername = 'Super Admin';
        const newPassword = process.env.SUPER_ADMIN_PASSWORD;
        let passwordMatch = false;

        if (existingSuperAdmin?.password) {
            passwordMatch = bcrypt.compareSync(newPassword, existingSuperAdmin?.password);
        }

        if (existingSuperAdmin && (existingSuperAdmin.email !== newEmail || !passwordMatch)) {
            await User.deleteOne({ _id: existingSuperAdmin._id });
            console.log('⚠️ Existing super admin deleted due to mismatch');
        }

        const currentAdmin = await User.findOne({ email: newEmail });

        if (!currentAdmin) {
            const newAdmin = new User({
                username: newUsername,
                email: newEmail,
                password: newPassword,
                confirmPassword: newPassword,
                role: 'superadmin',
            });

            await newAdmin.save();
            console.log('✅ New super admin created');
        }

        // -------------------------
        // Start HTTP Server
        // -------------------------
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

        // -------------------------
        // Start WebSocket Server
        // -------------------------
        initWebSocket(server);
       
        // -------------------------
        // Optional: MongoDB Change Stream for automatic notifications
        // -------------------------
        /*
        const changeStream = AppointmentModal.watch();
        changeStream.on('change', async (change) => {
            if (change.operationType === 'insert') {
                notifyAppointmentCreated(change.fullDocument);
            } else if (change.operationType === 'update') {
                const doc = await AppointmentModal.findById(change.documentKey._id);
                notifyAppointmentUpdated(doc);
            }
        });
        */

    } catch (error) {
        console.error('❌ Server initialization failed:', error);
        process.exit(1);
    }
})();


// const app = require('./app');
// const User = require('./models/User');
// const bcrypt = require('bcryptjs');
// const WebSocket = require('ws');

// const PORT = process.env.PORT || 5001;

// // Keep map of userId → WebSocket connection
// const clients = new Map();

// // Declare sendToUser so we can set/export later
// let sendToUser = () => {};

// (async () => {
//   try {
//     // ---------- Super Admin bootstrap ----------
//     const existingSuperAdmin = await User.findOne({ role: 'superadmin' });
//     const newEmail = process.env.SUPER_ADMIN_EMAIL;
//     const newUsername = 'Super Admin';
//     const newPassword = process.env.SUPER_ADMIN_PASSWORD;
//     let passwordMatch = false;

//     if (existingSuperAdmin?.password) {
//       passwordMatch = bcrypt.compareSync(newPassword, existingSuperAdmin.password);
//     }

//     if (existingSuperAdmin && (existingSuperAdmin.email !== newEmail || !passwordMatch)) {
//       await User.deleteOne({ _id: existingSuperAdmin._id });
//       console.log('⚠️ Existing super admin deleted due to mismatch');
//     }

//     const currentAdmin = await User.findOne({ email: newEmail });
//     if (!currentAdmin) {
//       const newAdmin = new User({
//         username: newUsername,
//         email: newEmail,
//         password: newPassword,
//         confirmPassword: newPassword,
//         role: 'superadmin',
//       });
//       await newAdmin.save();
//       console.log('✅ New super admin created');
//     }

//     // ---------- Start HTTP server ----------
//     const server = app.listen(PORT, () => {
//       console.log(`🚀 Server running on port ${PORT}`);
//     });

//     // ---------- WebSocket setup ----------
//     const wss = new WebSocket.Server({ server });

//     wss.on('connection', (ws) => {
//       console.log('🔗 Client connected');

//       ws.on('message', (rawMessage) => {
//         try {
//           const msg = JSON.parse(rawMessage);

//           if (msg.type === 'REGISTER_USER') {
//             clients.set(msg.userId, ws);
//             ws.userId = msg.userId;
//             console.log(`✅ Registered WebSocket for user ${msg.userId}`);
//           }
//         } catch (err) {
//           console.error('❌ Invalid WS message:', rawMessage);
//         }
//       });

//       ws.on('close', () => {
//         if (ws.userId) {
//           clients.delete(ws.userId);
//           console.log(`❌ WebSocket closed for user ${ws.userId}`);
//         }
//       });

//       ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to WebSocket server' }));
//     });

//     // ---------- Define sendToUser ----------
//     sendToUser = (userId, data) => {
//       const client = clients.get(userId);
//       if (client && client.readyState === WebSocket.OPEN) {
//         client.send(JSON.stringify(data));
//       }
//     };

//     // Make available both ways:
//     app.set('sendToUser', sendToUser);

//   } catch (error) {
//     console.error('❌ Server initialization failed:', error);
//     process.exit(1);
//   }
// })();





 




