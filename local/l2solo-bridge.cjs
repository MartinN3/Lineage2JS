const net = require('node:net');
const WebSocket = require('ws'); const WebSocketServer = WebSocket.Server;
for (const [listenPort, targetPort] of [[3106, 2106], [7778, 7777]]) {
    const server = new WebSocketServer({ host: '127.0.0.1', port: listenPort, maxPayload: 1024 * 1024 });
    server.on('connection', ws => {
        const tcp = net.connect({ host: '127.0.0.1', port: targetPort });
        ws.on('message', data => { if (Buffer.isBuffer(data)) tcp.write(data); else ws.close(1003); });
        tcp.on('data', data => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
        tcp.on('error', () => ws.close());
        tcp.on('close', () => ws.close());
        ws.on('error', () => tcp.destroy());
        ws.on('close', () => tcp.destroy());
    });
    server.on('listening', () => console.log(`127.0.0.1:${listenPort} -> 127.0.0.1:${targetPort}`));
}
