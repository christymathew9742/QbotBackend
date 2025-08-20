const WebSocket = require('ws');

let wss;

const initWebSocket = (server) => {
    wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        console.log('🔗 A new client connected');

        ws.on('message', (message) => {
            console.log(`📨 Received message: ${message}`);
            // Optional broadcast
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
        });

        ws.send(JSON.stringify({ message: 'Welcome to the WebSocket server' }));
    });
};

const broadcastNotification = (notification) => {
    if (!wss) return;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(notification));
        }
    });
};

const notifyAppointmentCreated = (appointmentData) => {
    broadcastNotification({
        type: 'appointment_created',
        appointmentId: appointmentData._id,
        message: `New appointment from ${appointmentData.whatsAppNumber}`,
        data: appointmentData,
    });
};

const notifyAppointmentUpdated = (appointmentData) => {
    broadcastNotification({
        type: 'appointment_updated',
        appointmentId: appointmentData._id,
        message: `Appointment updated`,
        data: appointmentData,
    });
};

module.exports = {
    initWebSocket,
    notifyAppointmentCreated,
    notifyAppointmentUpdated,
};

