'use strict';

// Room-auth integration tests boot a *fresh* server instance with ROOM_AUTH_SECRET
// set. Uses jest.resetModules() so env vars are picked up before server.js loads.
// Port 18081 avoids clashing with server.integration.test.js (18080).

process.env.PORT = '18081';
process.env.LOG_LEVEL = 'silent';
process.env.ROOM_AUTH_SECRET = 'integration-test-room-auth-secret';
process.env.WS_CONNECT_LIMIT_PER_IP = '1000';

jest.resetModules();

const http = require('http');
const WebSocket = require('ws');

const { wss, httpServer, rooms, peers } = require('../server');

const PORT = 18081;
const URL = `ws://localhost:${PORT}`;
const SECRET = process.env.ROOM_AUTH_SECRET;

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
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      })
      .on('error', reject);
  });
}

beforeAll((done) => {
  if (httpServer.listening) return done();
  httpServer.once('listening', done);
});

afterEach(() => {
  rooms.clear();
  peers.clear();
});

afterAll((done) => {
  for (const client of wss.clients) client.terminate();
  wss.close(() => httpServer.close(done));
});

describe('room auth (ROOM_AUTH_SECRET enabled)', () => {
  test('GET /room/:name/token returns a signed token', async () => {
    const res = await httpGet('/room/secure-studio/token');
    expect(res.status).toBe(200);
    expect(typeof res.body.token.exp).toBe('number');
    expect(typeof res.body.token.sig).toBe('string');
    expect(res.body.token.sig.length).toBeGreaterThan(0);
  });

  test('Join without token is rejected with Error', async () => {
    const c = new Client();
    await c.ready;
    await c.waitFor('Welcome');

    c.send({ type: 'Join', data: { room: 'secure-studio', name: 'Alice' } });
    const err = await c.waitFor('Error');
    expect(err.data.message).toMatch(/token/i);

    // Must not receive PeerList — join failed.
    await expect(c.waitFor('PeerList', 500)).rejects.toThrow(/Timeout/);

    await c.close();
  });

  test('Join with valid token succeeds and peer discovery works', async () => {
    const tokenRes = await httpGet('/room/jam/token');
    expect(tokenRes.status).toBe(200);

    const a = new Client();
    const b = new Client();
    await Promise.all([a.ready, b.ready]);
    await Promise.all([a.waitFor('Welcome'), b.waitFor('Welcome')]);

    a.send({
      type: 'Join',
      data: { room: 'jam', name: 'Alice', token: tokenRes.body.token },
    });
    const listA = await a.waitFor('PeerList');
    expect(listA.data.peers).toHaveLength(0);

    const tokenB = (await httpGet('/room/jam/token')).body.token;
    b.send({ type: 'Join', data: { room: 'jam', name: 'Bob', token: tokenB } });
    const listB = await b.waitFor('PeerList');
    expect(listB.data.peers).toHaveLength(1);
    expect(listB.data.peers[0]).toMatchObject({ uuid: a.uuid, name: 'Alice' });

    await Promise.all([a.close(), b.close()]);
  });

  test('Join with token for wrong room is rejected', async () => {
    const tokenRes = await httpGet('/room/room-a/token');
    const c = new Client();
    await c.ready;
    await c.waitFor('Welcome');

    c.send({
      type: 'Join',
      data: { room: 'room-b', name: 'Intruder', token: tokenRes.body.token },
    });
    const err = await c.waitFor('Error');
    expect(err.data.message).toMatch(/token/i);

    await c.close();
  });
});
