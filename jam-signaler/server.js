'use strict';

const WebSocket = require('ws');
const pino = require('pino');
const http = require('http');
const crypto = require('crypto');

const { validateMessage } = require('./lib/validation');
const { checkRateLimit, startRateLimitCleanup } = require('./lib/rate-limit');
const { removePeerFromRoom } = require('./lib/rooms');
const { createRoomToken, verifyRoomToken } = require('./lib/room-auth');
const { buildIceServers } = require('./lib/turn-credentials');

// ---------------------------------------------------------------------------
// Configuration (env-overridable, safe dev defaults)
// ---------------------------------------------------------------------------
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB max per message
const MESSAGE_RATE_LIMIT = 50; // messages per second per WS connection
const HTTP_RATE_LIMIT = 100; // requests per second per IP for the HTTP API
const WS_CONNECT_LIMIT_PER_IP = parseInt(process.env.WS_CONNECT_LIMIT_PER_IP, 10) || 10;
const MAX_ROOM_NAME_LENGTH = 64;
const MAX_NAME_LENGTH = 32;
// DoS guards: bound memory and keep the full-mesh topology sane.
const MAX_PEERS_PER_ROOM = process.env.MAX_PEERS_PER_ROOM
  ? parseInt(process.env.MAX_PEERS_PER_ROOM, 10)
  : 8;
const MAX_ROOMS = process.env.MAX_ROOMS ? parseInt(process.env.MAX_ROOMS, 10) : 500;
// CORS: lock down in production via ALLOWED_ORIGIN; defaults to '*' for local dev.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
// Optional room auth: when set, Join must carry a valid HMAC token from GET /room/:name/token.
const ROOM_AUTH_SECRET = process.env.ROOM_AUTH_SECRET || '';
// Optional own TURN (coturn REST): when TURN_SECRET is set, /ice-servers emits ephemeral creds.
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_URLS = process.env.TURN_URLS
  ? process.env.TURN_URLS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
// Dev fallback when no own TURN is configured.
const STATIC_TURN =
  TURN_SECRET.length > 0
    ? []
    : [
        {
          urls: ['turn:openrelay.metered.ca:80'],
          username: 'openrelayproject',
          credential: 'openrelay',
        },
      ];

function getIceServers() {
  return buildIceServers({
    turnUrls: TURN_URLS,
    turnSecret: TURN_SECRET,
    staticTurn: STATIC_TURN,
  });
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const rooms = new Map(); // roomName -> Map(uuid -> ws)
const peers = new Map(); // ws -> { uuid, room, displayName }

// Rate-limit stores. Stored at module scope so the periodic cleaner can sweep
// both maps in a single ticker.
const httpRateMap = new Map(); // ip -> { count, windowStart }
const wsRateMap = new Map();   // ip -> { count, windowStart }

function checkHttpRateLimit(ip) {
  return checkRateLimit(httpRateMap, ip, HTTP_RATE_LIMIT);
}

function checkWsConnectRateLimit(ip) {
  if (WS_CONNECT_LIMIT_PER_IP <= 0) return true;
  return checkRateLimit(wsRateMap, ip, WS_CONNECT_LIMIT_PER_IP);
}

// Single cleaner for both maps (every 10s, drop entries idle for 5s+).
startRateLimitCleanup([httpRateMap, wsRateMap]);

// ---------------------------------------------------------------------------
// HTTP server (health, ICE config, room info)
// ---------------------------------------------------------------------------
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

  // GET /room/:name/token — mint an HMAC room token (requires ROOM_AUTH_SECRET)
  const tokenMatch = req.url.match(/^\/room\/([^/]+)\/token$/);
  if (tokenMatch) {
    const roomName = decodeURIComponent(tokenMatch[1]);
    if (!ROOM_AUTH_SECRET) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Room auth not configured' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ token: createRoomToken(roomName, ROOM_AUTH_SECRET) }));
    return;
  }

  // GET /room/:name — room info
  const roomMatch = req.url.match(/^\/room\/([^/]+)$/);
  if (roomMatch) {
    const roomName = roomMatch[1];
    const room = rooms.get(roomName);
    if (room) {
      // Only expose an aggregate count — never the peer UUID list, which would
      // let any origin enumerate participants and target signaling at them.
      res.writeHead(200);
      res.end(JSON.stringify({ room: roomName, peerCount: room.size }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Room not found' }));
    }
    return;
  }

  if (req.url === '/ice-servers') {
    res.writeHead(200);
    res.end(JSON.stringify({ iceServers: getIceServers() }));
    return;
  }

  if (req.url === '/health') {
    let totalPeers = 0;
    rooms.forEach((r) => (totalPeers += r.size));
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'ok',
        rooms: rooms.size,
        peers: totalPeers,
        uptime: process.uptime(),
      })
    );
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({ server: httpServer });

// Heartbeat interval to detect dead connections (every 30s).
const HEARTBEAT_INTERVAL = 30000;

function startHeartbeat() {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        const peer = peers.get(ws);
        if (peer) removePeerFromRoom(ws, peer.uuid, peer.room, rooms, logger);
        peers.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL).unref();
}

startHeartbeat();

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, 'Signaling server listening');
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutdown requested, closing connections...');
  wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
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

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  // Per-IP handshake rate limit. Without this, a single attacker can open
  // thousands of WS connections per second (each with its own message budget)
  // and amplify the per-connection MESSAGE_RATE_LIMIT into a global DoS.
  // 1013 is RFC 6455 "try again later".
  if (!checkWsConnectRateLimit(clientIp)) {
    logger.warn({ ip: clientIp }, 'WS connection rate limit exceeded');
    ws.close(1013, 'Too many connections');
    return;
  }

  ws.isAlive = true;
  let currentRoom = null;
  const userUuid = crypto.randomUUID();
  let messageCount = 0;
  let messageWindowStart = Date.now();
  // Display name is per-socket state, but we keep it in `peers` (not as a
  // monkey-patched `ws.displayName`) to avoid touching library-owned objects.
  let displayName = '';

  ws.send(
    JSON.stringify({
      type: 'Welcome',
      data: { uuid: userUuid, iceServers: getIceServers() },
    })
  );

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    // --- Rate limit (per-connection) ---
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

    if (raw.length > MAX_MESSAGE_SIZE) {
      logger.warn({ uuid: userUuid, size: raw.length }, 'Message too large');
      return ws.terminate();
    }

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (!validateMessage(message)) {
      logger.warn({ uuid: userUuid, type: message && message.type }, 'Invalid message');
      return;
    }

    switch (message.type) {
      case 'Join': {
        const { room } = message.data;
        displayName = typeof message.data.name === 'string' ? message.data.name : '';

        if (
          ROOM_AUTH_SECRET &&
          !verifyRoomToken(room, message.data.token, ROOM_AUTH_SECRET)
        ) {
          ws.send(
            JSON.stringify({
              type: 'Error',
              data: { message: 'Invalid or missing room token' },
            })
          );
          break;
        }

        // Re-Join without an explicit Leave: drop the previous room membership
        // first, otherwise the old room keeps a ghost entry for this socket.
        if (currentRoom && currentRoom !== room) {
          removePeerFromRoom(ws, userUuid, currentRoom, rooms, logger);
        }

        // Room-count cap (only relevant when creating a brand-new room).
        if (!rooms.has(room) && rooms.size >= MAX_ROOMS) {
          logger.warn({ room, rooms: rooms.size }, 'Room limit reached');
          ws.send(
            JSON.stringify({ type: 'Error', data: { message: 'Server room limit reached' } })
          );
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

        const peerList = Array.from(roomPeers, ([uuid, peerWs]) => ({
          uuid,
          name: peers.get(peerWs)?.displayName || '',
        }));
        ws.send(JSON.stringify({ type: 'PeerList', data: { peers: peerList } }));

        const newPeerMsg = JSON.stringify({
          type: 'NewPeer',
          data: { uuid: userUuid, name: displayName },
        });
        roomPeers.forEach((peerWs) => {
          if (peerWs.readyState === WebSocket.OPEN) peerWs.send(newPeerMsg);
        });

        roomPeers.set(userUuid, ws);
        peers.set(ws, { uuid: userUuid, room, displayName });
        logger.info(
          { room, uuid: userUuid, name: displayName, peerCount: roomPeers.size },
          'Peer joined'
        );
        break;
      }

      case 'Offer':
      case 'Answer':
      case 'Ice': {
        const targetUuid = message.data.target;
        const roomPeers = rooms.get(currentRoom);
        const targetWs = roomPeers && roomPeers.get(targetUuid);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: message.type,
              data: { ...message.data, from: userUuid },
            })
          );
        } else {
          logger.warn({ targetUuid, currentRoom }, 'Target peer not found or not ready');
        }
        break;
      }

      case 'Leave': {
        removePeerFromRoom(ws, userUuid, currentRoom, rooms, logger);
        currentRoom = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    removePeerFromRoom(ws, userUuid, currentRoom, rooms, logger);
    peers.delete(ws);
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'WebSocket error');
  });
});

module.exports = { wss, httpServer, rooms, peers };
