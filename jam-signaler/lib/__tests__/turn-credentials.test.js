'use strict';

const { buildIceServers, generateTurnCredentials } = require('../turn-credentials');

describe('turn-credentials', () => {
  test('buildIceServers returns STUN-only when no TURN configured', () => {
    const servers = buildIceServers();
    expect(servers.length).toBe(2);
    expect(servers.every((s) => s.urls[0].startsWith('stun:'))).toBe(true);
  });

  test('buildIceServers adds dynamic TURN when secret and urls are set', () => {
    const servers = buildIceServers({
      turnSecret: 'turn-secret',
      turnUrls: ['turn:localhost:3478'],
    });
    const turn = servers.find((s) => s.urls[0].startsWith('turn:'));
    expect(turn).toBeDefined();
    expect(turn.username).toMatch(/^\d+:jam$/);
    expect(typeof turn.credential).toBe('string');
    expect(turn.credential.length).toBeGreaterThan(0);
  });

  test('generateTurnCredentials matches coturn REST format', () => {
    const { username, credential } = generateTurnCredentials('s3cr3t', 'user1', 3600);
    expect(username).toMatch(/^\d+:user1$/);
    expect(typeof credential).toBe('string');
  });
});
