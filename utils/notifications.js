const WebSocket = require('ws');

let wss;

function heartbeat() {
    this.isAlive = true;
}

const initWebSocket = (server) => {
    wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', heartbeat);
        ws.on('message', (message) => {
            console.log(`📨 Received message: ${message}`);
        });

        ws.send(JSON.stringify({ message: 'Welcome to the WebSocket server' }));
    });

    const interval = setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping(); 
        });
    }, 30000);

    wss.on('close', function close() {
        clearInterval(interval);
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

