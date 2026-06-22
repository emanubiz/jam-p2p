'use strict';

// In-process integration tests for the signaling server.
//
// Unlike the unit tests under lib/__tests__ (which exercise pure helpers with
// fake sockets), this suite boots the *real* server.js in-process and drives
// it with real `ws` clients over a TCP socket. It verifies the full wire
// contract: Welcome, room join + peer discovery, Offer/Answer/Ice relay,
// graceful Leave, hard disconnect, the per-room peer cap, and the HTTP API.
//
// These replace the standalone scripts under docs/testing/scripts for CI:
// they run as part of `npm test`, resolve `ws` from this package's own
// node_modules, and assert with jest instead of process exit codes.

// Configure the server before requiring it — server.js reads these at load.
process.env.PORT = '18080';
process.env.LOG_LEVEL = 'silent';
process.env.MAX_PEERS_PER_ROOM = '3'; // small cap so the "room full" path is testable
process.env.WS_CONNECT_LIMIT_PER_IP = '1000'; // effectively disable the per-IP connect cap:
// the suite opens many sockets from 127.0.0.1 in <1s, which would otherwise trip the limit.
// (Note: server.js does `parseInt(...) || 10`, so '0' would fall back to 10 — use a high value.)

const http = require('http');
const WebSocket = require('ws');

const { wss, httpServer, rooms, peers } = require('../server');

const PORT = 18080;
const URL = `ws://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Test client helper
// ---------------------------------------------------------------------------
class Client {
  constructor() {
    this.ws = new WebSocket(URL);
    this.messages = [];
    this.uuid = null;
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      this.messages.push(msg);
      if (msg.type === 'Welcome') this.uuid = msg.data.uuid;
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  // Resolve with the first message of `type` that arrives (or has already
  // arrived). Rejects on timeout so a missing relay fails loudly.
  waitFor(type, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const found = this.messages.find((m) => m.type === type && !m._consumed);
      if (found) {
        found._consumed = true;
        return resolve(found);
      }
      const start = Date.now();
      const onMessage = (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === type) {
          this.ws.off('message', onMessage);
          clearInterval(timer);
          resolve(msg);
        }
      };
      const timer = setInterval(() => {
        if (Date.now() - start > timeout) {
          this.ws.off('message', onMessage);
          clearInterval(timer);
          reject(new Error(`Timeout waiting for "${type}"`));
        }
      }, 25);
      this.ws.on('message', onMessage);
    });
  }

  count(type) {
    return this.messages.filter((m) => m.type === type).length;
  }

  close() {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.on('close', resolve);
      this.ws.close();
    });
  }
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${PORT}${path}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll((done) => {
  if (httpServer.listening) return done();
  httpServer.once('listening', done);
});

afterEach(() => {
  // The server keeps in-memory state across connections; reset between tests
  // so cases don't leak peers/rooms into each other.
  rooms.clear();
  peers.clear();
});

afterAll((done) => {
  for (const client of wss.clients) client.terminate();
  wss.close(() => httpServer.close(done));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('handshake', () => {
  test('sends Welcome with a uuid and ICE servers on connect', async () => {
    const c = new Client();
    await c.ready;
    const welcome = await c.waitFor('Welcome');
    expect(typeof welcome.data.uuid).toBe('string');
    expect(welcome.data.uuid.length).toBeGreaterThan(0);
    expect(Array.isArray(welcome.data.iceServers)).toBe(true);
    expect(welcome.data.iceServers.length).toBeGreaterThan(0);
    await c.close();
  });
});

describe('room join and peer discovery', () => {
  test('first peer gets an empty PeerList; second peer sees the first', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.ready, b.ready]);
    await a.waitFor('Welcome');
    await b.waitFor('Welcome');

    a.send({ type: 'Join', data: { room: 'studio', name: 'Alice' } });
    const listA = await a.waitFor('PeerList');
    expect(listA.data.peers).toHaveLength(0);

    b.send({ type: 'Join', data: { room: 'studio', name: 'Bob' } });
    const listB = await b.waitFor('PeerList');
    expect(listB.data.peers).toHaveLength(1);
    expect(listB.data.peers[0]).toMatchObject({ uuid: a.uuid, name: 'Alice' });

    // Alice is notified of the newcomer.
    const newPeer = await a.waitFor('NewPeer');
    expect(newPeer.data).toMatchObject({ uuid: b.uuid, name: 'Bob' });

    await Promise.all([a.close(), b.close()]);
  });
});

describe('signaling relay', () => {
  test('routes Offer, Answer and Ice to the targeted peer, stamping `from`', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.ready, b.ready]);
    await a.waitFor('Welcome');
    await b.waitFor('Welcome');

    a.send({ type: 'Join', data: { room: 'relay', name: 'A' } });
    await a.waitFor('PeerList');
    b.send({ type: 'Join', data: { room: 'relay', name: 'B' } });
    await b.waitFor('PeerList');
    await a.waitFor('NewPeer');

    a.send({ type: 'Offer', data: { target: b.uuid, sdp: 'sdp-offer' } });
    const offer = await b.waitFor('Offer');
    expect(offer.data).toMatchObject({ from: a.uuid, sdp: 'sdp-offer' });

    b.send({ type: 'Answer', data: { target: a.uuid, sdp: 'sdp-answer' } });
    const answer = await a.waitFor('Answer');
    expect(answer.data).toMatchObject({ from: b.uuid, sdp: 'sdp-answer' });

    a.send({ type: 'Ice', data: { target: b.uuid, candidate: 'cand-1' } });
    const ice = await b.waitFor('Ice');
    expect(ice.data).toMatchObject({ from: a.uuid, candidate: 'cand-1' });

    await Promise.all([a.close(), b.close()]);
  });
});

describe('departure', () => {
  test('explicit Leave broadcasts PeerLeft to survivors', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.ready, b.ready]);
    await a.waitFor('Welcome');
    await b.waitFor('Welcome');

    a.send({ type: 'Join', data: { room: 'leave-room' } });
    await a.waitFor('PeerList');
    b.send({ type: 'Join', data: { room: 'leave-room' } });
    await b.waitFor('PeerList');
    await a.waitFor('NewPeer');

    b.send({ type: 'Leave', data: {} });
    const left = await a.waitFor('PeerLeft');
    expect(left.data).toEqual({ uuid: b.uuid });

    await Promise.all([a.close(), b.close()]);
  });

  test('hard disconnect (socket close) also broadcasts PeerLeft', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.ready, b.ready]);
    await a.waitFor('Welcome');
    await b.waitFor('Welcome');

    a.send({ type: 'Join', data: { room: 'drop-room' } });
    await a.waitFor('PeerList');
    b.send({ type: 'Join', data: { room: 'drop-room' } });
    await b.waitFor('PeerList');
    await a.waitFor('NewPeer');

    await b.close();
    const left = await a.waitFor('PeerLeft');
    expect(left.data).toEqual({ uuid: b.uuid });

    await a.close();
  });
});

describe('room capacity', () => {
  test('rejects the peer that exceeds MAX_PEERS_PER_ROOM with an Error', async () => {
    // Cap is 3 (set via env above). Fill it, then a 4th join is refused.
    const clients = [new Client(), new Client(), new Client(), new Client()];
    await Promise.all(clients.map((c) => c.ready));
    await Promise.all(clients.map((c) => c.waitFor('Welcome')));

    for (let i = 0; i < 3; i++) {
      clients[i].send({ type: 'Join', data: { room: 'full' } });
      await clients[i].waitFor('PeerList');
    }

    clients[3].send({ type: 'Join', data: { room: 'full' } });
    const err = await clients[3].waitFor('Error');
    expect(err.data.message).toMatch(/full/i);

    await Promise.all(clients.map((c) => c.close()));
  });
});

describe('robustness', () => {
  test('ignores malformed and invalid messages without dropping the connection', async () => {
    const c = new Client();
    await c.ready;
    await c.waitFor('Welcome');

    c.send('not json at all'); // raw string, JSON.parse fails server-side
    c.send({ type: 'Join', data: {} }); // missing room -> validation fails
    c.send({ type: 'Bogus', data: {} }); // unknown type

    // After garbage, a well-formed Join must still work.
    c.send({ type: 'Join', data: { room: 'survives' } });
    const list = await c.waitFor('PeerList');
    expect(list.data.peers).toHaveLength(0);

    await c.close();
  });
});

describe('HTTP API', () => {
  test('/health reports status and live counts', async () => {
    const res = await httpGet('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.rooms).toBe('number');
    expect(typeof res.body.peers).toBe('number');
  });

  test('/ice-servers returns the ICE configuration', async () => {
    const res = await httpGet('/ice-servers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.iceServers)).toBe(true);
    expect(res.body.iceServers[0].urls).toBeDefined();
  });

  test('/room/:name returns 404 for an unknown room', async () => {
    const res = await httpGet('/room/does-not-exist');
    expect(res.status).toBe(404);
  });
});
