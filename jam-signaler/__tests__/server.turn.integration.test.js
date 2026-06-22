'use strict';

// TURN REST integration: when TURN_SECRET is set, /ice-servers and Welcome must
// emit ephemeral coturn-compatible credentials instead of the openrelay fallback.
// Port 18082 avoids clashing with other in-process server suites.

process.env.PORT = '18082';
process.env.LOG_LEVEL = 'silent';
process.env.TURN_SECRET = 'integration-test-turn-secret';
process.env.TURN_URLS =
  'turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp';
process.env.WS_CONNECT_LIMIT_PER_IP = '1000';

jest.resetModules();

const http = require('http');
const WebSocket = require('ws');

const { wss, httpServer, rooms, peers } = require('../server');

const PORT = 18082;
const URL = `ws://localhost:${PORT}`;

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

describe('dynamic TURN (TURN_SECRET enabled)', () => {
  test('/ice-servers returns ephemeral credentials for configured TURN URLs', async () => {
    const res = await httpGet('/ice-servers');
    expect(res.status).toBe(200);
    const servers = res.body.iceServers;
    expect(Array.isArray(servers)).toBe(true);

    const turnEntries = servers.filter(
      (s) =>
        Array.isArray(s.urls) &&
        s.urls.some((u) => String(u).startsWith('turn:'))
    );
    expect(turnEntries.length).toBe(2);
    for (const entry of turnEntries) {
      expect(typeof entry.username).toBe('string');
      expect(entry.username).toMatch(/^\d+:jam$/);
      expect(typeof entry.credential).toBe('string');
      expect(entry.credential.length).toBeGreaterThan(0);
    }

    // Must not fall back to the public openrelay project.
    const openrelay = servers.some(
      (s) =>
        Array.isArray(s.urls) &&
        s.urls.some((u) => String(u).includes('openrelay'))
    );
    expect(openrelay).toBe(false);
  });

  test('Welcome includes the same dynamic TURN credentials', async () => {
    const ws = new WebSocket(URL);
    const welcome = await new Promise((resolve, reject) => {
      ws.on('open', () => {});
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'Welcome') {
          ws.close();
          resolve(msg);
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Welcome timeout')), 2000);
    });

    expect(Array.isArray(welcome.data.iceServers)).toBe(true);
    const turn = welcome.data.iceServers.find(
      (s) =>
        Array.isArray(s.urls) &&
        s.urls.some((u) => String(u).includes('127.0.0.1:3478'))
    );
    expect(turn).toBeDefined();
    expect(turn.username).toMatch(/^\d+:jam$/);
    expect(typeof turn.credential).toBe('string');
  });
});
