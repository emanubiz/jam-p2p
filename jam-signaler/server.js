const WebSocket = require('ws');
const pino = require('pino');
const http = require('http');
const crypto = require('crypto');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB max per message
const MESSAGE_RATE_LIMIT = 50; // messages per second per connection
const HTTP_RATE_LIMIT = 100; // requests per second per IP
const MAX_ROOM_NAME_LENGTH = 64;
const MAX_NAME_LENGTH = 32;
// DoS guards: bound memory and keep the full-mesh topology sane.
const MAX_PEERS_PER_ROOM = process.env.MAX_PEERS_PER_ROOM
  ? parseInt(process.env.MAX_PEERS_PER_ROOM, 10)
  : 8;
const MAX_ROOMS = process.env.MAX_ROOMS ? parseInt(process.env.MAX_ROOMS, 10) : 500;
// CORS: lock down in production via ALLOWED_ORIGIN; defaults to '*' for local dev.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ICE server configuration (STUN/TURN). `urls` is always an array so the
// Rust client can deserialize it directly into webrtc-rs RTCIceServer.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
  {
    urls: ['turn:openrelay.metered.ca:80'],
    username: 'openrelayproject',
    credential: 'openrelay'
  },
];

const rooms = new Map(); // roomName -> Map(uuid -> ws)
const peers = new Map(); // ws -> { uuid, room }

// --- Rate limiting state ---
const httpRateMap = new Map(); // ip -> { count, windowStart }

function checkHttpRateLimit(ip) {
  const now = Date.now();
  let entry = httpRateMap.get(ip);
  if (!entry || now - entry.windowStart > 1000) {
    entry = { count: 0, windowStart: now };
    httpRateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= HTTP_RATE_LIMIT;
}

// Periodic cleanup of stale HTTP rate entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of httpRateMap) {
    if (now - entry.windowStart > 5000) httpRateMap.delete(ip);
  }
}, 10000);

// --- Message validation ---
const VALID_MESSAGE_TYPES = new Set(['Join', 'Leave', 'Offer', 'Answer', 'Ice']);

function validateMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!VALID_MESSAGE_TYPES.has(message.type)) return false;

  switch (message.type) {
    case 'Join':
      return (
        message.data &&
        typeof message.data.room === 'string' &&
        message.data.room.trim().length > 0 &&
        message.data.room.length <= MAX_ROOM_NAME_LENGTH &&
        // name is optional; if present it must be a bounded string
        (message.data.name === undefined ||
          (typeof message.data.name === 'string' &&
            message.data.name.length <= MAX_NAME_LENGTH))
      );
    case 'Leave':
      return true;
    case 'Offer':
    case 'Answer':
      return (
        message.data &&
        typeof message.data.target === 'string' &&
        typeof message.data.sdp === 'string'
      );
    case 'Ice':
      return (
        message.data &&
        typeof message.data.target === 'string' &&
        typeof message.data.candidate === 'string'
      );
    default:
      return false;
  }
}

// --- Peer cleanup helper ---
function removePeerFromRoom(ws, uuid, room) {
  if (!room || !rooms.has(room)) return;
  const roomPeers = rooms.get(room);
  roomPeers.delete(uuid);
  roomPeers.forEach((peerWs) => {
    if (peerWs.readyState === WebSocket.OPEN) {
      peerWs.send(JSON.stringify({ type: 'PeerLeft', data: { uuid } }));
    }
  });
  if (roomPeers.size === 0) rooms.delete(room);
  logger.info({ uuid, room }, 'Peer removed from room');
}

// --- HTTP server ---
const httpServer = http.createServer((req, res) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!checkHttpRateLimit(clientIp)) {
    res.writeHead(429);
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
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
      // Only expose an aggregate count — never the peer UUID list, which would
      // let any origin enumerate participants and target signaling at them.
      res.end(JSON.stringify({
        room: roomName,
        peerCount: room.size
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
        if (peer) {
          removePeerFromRoom(ws, peer.uuid, peer.room);
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
  wss.clients.forEach(ws => {
    ws.close(1001, 'Server shutting down');
  });
  rooms.clear();
  peers.clear();
  httpServer.close(() => {
    logger.info('HTTP server closed gracefully');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- WebSocket connection handler ---
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

    if (!validateMessage(message)) {
      logger.warn({ uuid: userUuid, type: message?.type }, 'Invalid message');
      return;
    }

    switch (message.type) {
      case 'Join': {
        const { room } = message.data;
        const name = typeof message.data.name === 'string' ? message.data.name : '';

        // Re-Join without an explicit Leave: drop the previous room membership
        // first, otherwise the old room keeps a ghost entry for this socket.
        if (currentRoom && currentRoom !== room) {
          removePeerFromRoom(ws, userUuid, currentRoom);
        }

        // Room-count cap (only relevant when creating a brand-new room).
        if (!rooms.has(room) && rooms.size >= MAX_ROOMS) {
          logger.warn({ room, rooms: rooms.size }, 'Room limit reached');
          ws.send(JSON.stringify({ type: 'Error', data: { message: 'Server room limit reached' } }));
          break;
        }
        if (!rooms.has(room)) rooms.set(room, new Map());
        const roomPeers = rooms.get(room);

        // Per-room peer cap (a re-Join for the same room is already a member).
        if (!roomPeers.has(userUuid) && roomPeers.size >= MAX_PEERS_PER_ROOM) {
          logger.warn({ room, peerCount: roomPeers.size }, 'Room is full');
          ws.send(JSON.stringify({ type: 'Error', data: { message: 'Room is full' } }));
          break;
        }

        currentRoom = room;
        ws.displayName = name;

        const peerList = Array.from(roomPeers, ([uuid, peerWs]) => ({
          uuid,
          name: peerWs.displayName || ''
        }));
        ws.send(JSON.stringify({ type: 'PeerList', data: { peers: peerList } }));

        roomPeers.forEach((peerWs) => {
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(JSON.stringify({ type: 'NewPeer', data: { uuid: userUuid, name } }));
          }
        });

        roomPeers.set(userUuid, ws);
        peers.set(ws, { uuid: userUuid, room });
        logger.info({ room, uuid: userUuid, name, peerCount: roomPeers.size }, 'Peer joined');
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
        removePeerFromRoom(ws, userUuid, currentRoom);
        currentRoom = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    removePeerFromRoom(ws, userUuid, currentRoom);
    peers.delete(ws);
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'WebSocket error');
  });
});

module.exports = { wss, httpServer };
