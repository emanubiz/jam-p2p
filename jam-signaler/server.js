const WebSocket = require('ws');
const pino = require('pino');
const http = require('http');
const crypto = require('crypto');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB max per message
const MESSAGE_RATE_LIMIT = 50; // messages per second per connection

// ICE server configuration (STUN/TURN)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelay'
  },
];

const rooms = new Map(); // roomName -> Map(uuid -> ws)
const peers = new Map(); // ws -> { uuid, room }

// HTTP endpoint for room info and ICE config
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // GET /room/:name - room info
  const roomMatch = req.url.match(/^\/room\/([^/]+)$/);
  if (roomMatch) {
    const roomName = roomMatch[1];
    const room = rooms.get(roomName);
    if (room) {
      res.writeHead(200);
      res.end(JSON.stringify({
        room: roomName,
        peerCount: room.size,
        peers: Array.from(room.keys())
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Room not found' }));
    }
    return;
  }

  // GET /ice-servers - ICE configuration
  if (req.url === '/ice-servers') {
    res.writeHead(200);
    res.end(JSON.stringify({ iceServers: ICE_SERVERS }));
    return;
  }

  // GET /health - server health
  if (req.url === '/health') {
    let totalPeers = 0;
    rooms.forEach(r => totalPeers += r.size);
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      peers: totalPeers,
      uptime: process.uptime()
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocket.Server({ server: httpServer });

// Heartbeat interval to detect dead connections (every 30s)
const HEARTBEAT_INTERVAL = 30000;

function startHeartbeat() {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        const peer = peers.get(ws);
        if (peer && peer.room && rooms.has(peer.room)) {
          rooms.get(peer.room).delete(peer.uuid);
          if (rooms.get(peer.room).size === 0) rooms.delete(peer.room);
          logger.info({ uuid: peer.uuid, room: peer.room }, 'Dead peer cleaned up');
        }
        peers.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);
}

startHeartbeat();

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, 'Signaling server listening');
});

// Graceful shutdown handlers
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutdown requested, closing connections...');
  // Close all WebSocket connections with close code 1001 (going away)
  wss.clients.forEach(ws => {
    ws.close(1001, 'Server shutting down');
  });
  // Clear peer tracking maps
  rooms.clear();
  peers.clear();
  // Close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed gracefully');
    process.exit(0);
  });
  // Force kill if shutdown takes too long
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  let currentRoom = null;
  const userUuid = crypto.randomUUID();
  let messageCount = 0;
  let messageWindowStart = Date.now();

  ws.send(JSON.stringify({
    type: 'Welcome',
    data: {
      uuid: userUuid,
      iceServers: ICE_SERVERS
    }
  }));

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    // Rate limiting
    const now = Date.now();
    if (now - messageWindowStart > 1000) {
      messageCount = 0;
      messageWindowStart = now;
    }
    messageCount++;
    if (messageCount > MESSAGE_RATE_LIMIT) {
      logger.warn({ uuid: userUuid, count: messageCount }, 'Message rate limit exceeded');
      return ws.terminate();
    }

    // Message size check
    if (raw.length > MAX_MESSAGE_SIZE) {
      logger.warn({ uuid: userUuid, size: raw.length }, 'Message too large');
      return ws.terminate();
    }

    let message;
    try { message = JSON.parse(raw); } catch (err) { return; }

    switch (message.type) {
      case 'Join': {
        const { room } = message.data;
        if (!room || typeof room !== 'string' || room.trim().length === 0) {
          logger.warn({ uuid: userUuid }, 'Invalid room name in Join');
          return;
        }
        currentRoom = room;
        if (!rooms.has(room)) rooms.set(room, new Map());
        const roomPeers = rooms.get(room);

        const peerList = Array.from(roomPeers.keys());
        ws.send(JSON.stringify({ type: 'PeerList', data: { peers: peerList } }));

        roomPeers.forEach((peerWs) => {
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(JSON.stringify({ type: 'NewPeer', data: { uuid: userUuid } }));
          }
        });

        roomPeers.set(userUuid, ws);
        peers.set(ws, { uuid: userUuid, room });
        logger.info({ room, uuid: userUuid, peerCount: roomPeers.size }, 'Peer joined');
        break;
      }

      case 'Offer':
      case 'Answer':
      case 'Ice': {
        const targetUuid = message.data.target;
        const roomPeers = rooms.get(currentRoom);
        const targetWs = roomPeers?.get(targetUuid);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: message.type,
            data: { ...message.data, from: userUuid }
          }));
        } else {
          logger.warn({ targetUuid, currentRoom }, 'Target peer not found or not ready');
        }
        break;
      }

      case 'Leave': {
        if (currentRoom && rooms.has(currentRoom)) {
          rooms.get(currentRoom).delete(userUuid);
          rooms.get(currentRoom).forEach((peerWs) => {
            if (peerWs.readyState === WebSocket.OPEN) {
              peerWs.send(JSON.stringify({ type: 'PeerLeft', data: { uuid: userUuid } }));
            }
          });
          if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
          logger.info({ uuid: userUuid, room: currentRoom }, 'Peer left via Leave');
        }
        currentRoom = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(userUuid);
      rooms.get(currentRoom).forEach((peerWs) => {
        if (peerWs.readyState === WebSocket.OPEN) {
          peerWs.send(JSON.stringify({ type: 'PeerLeft', data: { uuid: userUuid } }));
        }
      });
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
      logger.info({ uuid: userUuid, room: currentRoom }, 'Peer disconnected');
    }
    peers.delete(ws);
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'WebSocket error');
  });
});

module.exports = { wss, httpServer };