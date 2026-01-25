const WebSocket = require('ws');
const pino = require('pino');
const crypto = require('crypto');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const wss = new WebSocket.Server({ port: PORT });
const rooms = new Map(); // roomName -> Map(uuid -> ws)

logger.info({ port: PORT }, 'Signaling server listening');

// Simple heartbeat to detect dead peers
function noop() {}
function heartbeat() { this.isAlive = true; }

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    let currentRoom = null;
    const userUuid = crypto.randomUUID();

    ws.send(JSON.stringify({ type: 'Welcome', data: { uuid: userUuid } }));

    ws.on('message', (raw) => {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (err) {
            logger.warn({ err: String(err), raw }, 'Invalid JSON message');
            return ws.send(JSON.stringify({ type: 'Error', data: { message: 'Invalid JSON' } }));
        }

        if (!message.type || !message.data) {
            return ws.send(JSON.stringify({ type: 'Error', data: { message: 'Malformed message' } }));
        }

        try {
            switch (message.type) {
                case 'Join': {
                    const { room, name, password } = message.data;
                    if (!room || !name) return ws.send(JSON.stringify({ type: 'Error', data: { message: 'room/name required' } }));

                    // Simple room password check (optional): set ROOM_PASSWORD env var to require it
                    if (process.env.ROOM_PASSWORD) {
                        if (!password || password !== process.env.ROOM_PASSWORD) {
                            logger.info({ ip: req.socket.remoteAddress, room, uuid: userUuid }, 'Auth failed');
                            return ws.send(JSON.stringify({ type: 'AuthFailed', data: { message: 'Invalid room password' } }));
                        }
                    }

                    currentRoom = room;
                    if (!rooms.has(room)) rooms.set(room, new Map());
                    const roomPeers = rooms.get(room);

                    // send peer list
                    const peerList = Array.from(roomPeers.keys());
                    ws.send(JSON.stringify({ type: 'PeerList', data: { peers: peerList } }));

                    // notify others
                    roomPeers.forEach((peerWs, pid) => {
                        try { peerWs.send(JSON.stringify({ type: 'NewPeer', data: { uuid: userUuid } })); } catch (e) { logger.warn({ err: String(e), pid }, 'Notify peer failed'); }
                    });

                    roomPeers.set(userUuid, ws);
                    logger.info({ name, room, uuid: userUuid }, 'Peer joined');
                    break;
                }

                case 'Offer':
                case 'Answer':
                case 'Ice': {
                    if (!currentRoom) return ws.send(JSON.stringify({ type: 'Error', data: { message: 'Not joined' } }));
                    const targetUuid = message.data.target;
                    const targetWs = rooms.get(currentRoom)?.get(targetUuid);
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        const forward = { ...message, data: { ...message.data, from: userUuid } };
                        targetWs.send(JSON.stringify(forward));
                    } else {
                        logger.debug({ targetUuid, currentRoom }, 'Target not found for signaling');
                    }
                    break;
                }

                case 'Ping':
                    ws.send(JSON.stringify({ type: 'Pong' }));
                    break;

                default:
                    ws.send(JSON.stringify({ type: 'Error', data: { message: 'Unknown message type' } }));
            }
        } catch (err) {
            logger.error({ err: String(err), message }, 'Unhandled message error');
            ws.send(JSON.stringify({ type: 'Error', data: { message: 'Server error' } }));
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(userUuid);
            if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
            logger.info({ uuid: userUuid, room: currentRoom }, 'Peer left');
        }
    });
});

// periodic ping to clients
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(noop);
    });
}, 30_000);

wss.on('close', () => clearInterval(interval));