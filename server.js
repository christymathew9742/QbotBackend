const app = require('./app');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws'); 

const PORT = process.env.PORT || 5001;

(async () => {
    try {
        
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

        if (!currentAdmin ) {
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

        // Start HTTP server
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

        // Start WebSocket server
        const wss = new WebSocket.Server({ server });
        wss.on('connection', (ws) => {
            console.log('🔗 A new client connected');
            ws.on('message', (message) => {
                console.log(`📨 Received message: ${message}`);
                wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
                });
            });
            ws.send('Welcome to the WebSocket server');
        });

    } catch (error) {
        console.error('❌ Server initialization failed:', error);
        process.exit(1);  
    }
})(); 
 




