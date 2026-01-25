const WebSocket = require('ws');
const pino = require('pino');
const crypto = require('crypto');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const wss = new WebSocket.Server({ port: PORT });
const rooms = new Map(); // roomName -> Map(uuid -> ws)

logger.info({ port: PORT }, 'Signaling server listening');

wss.on('connection', (ws) => {
    ws.isAlive = true;
    let currentRoom = null;
    const userUuid = crypto.randomUUID();

    // Manda l'ID assegnato al client appena si connette
    ws.send(JSON.stringify({ type: 'Welcome', data: { uuid: userUuid } }));

    ws.on('message', (raw) => {
        let message;
        try { message = JSON.parse(raw); } catch (err) { return; }

        switch (message.type) {
            case 'Join': {
                const { room } = message.data;
                currentRoom = room;
                if (!rooms.has(room)) rooms.set(room, new Map());
                const roomPeers = rooms.get(room);

                // 1. Invia la lista dei peer già presenti al nuovo arrivato
                const peerList = Array.from(roomPeers.keys());
                ws.send(JSON.stringify({ type: 'PeerList', data: { peers: peerList } }));

                // 2. Notifica gli altri che è entrato un nuovo peer
                roomPeers.forEach((peerWs) => {
                    peerWs.send(JSON.stringify({ type: 'NewPeer', data: { uuid: userUuid } }));
                });

                roomPeers.set(userUuid, ws);
                logger.info({ room, uuid: userUuid }, 'Peer joined');
                break;
            }

            case 'Offer':
            case 'Answer':
            case 'Ice': {
                const targetUuid = message.data.target;
                const roomPeers = rooms.get(currentRoom);
                const targetWs = roomPeers?.get(targetUuid);

                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    // Inoltra il segnale aggiungendo l'ID del mittente (from)
                    targetWs.send(JSON.stringify({
                        type: message.type,
                        data: { ...message.data, from: userUuid }
                    }));
                }
                break;
            }
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