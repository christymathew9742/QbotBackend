const WebSocket = require('ws');

let wss;

const initWebSocket = (server) => {
    wss = new WebSocket.Server({ server });
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

const sendToUser = ({type, status, userId}) => {
    broadcastNotification({
        type,
        status,
        userId,
    });
};

module.exports = {
    initWebSocket,
    sendToUser,
};

