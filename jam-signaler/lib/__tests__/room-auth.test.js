'use strict';

const { createRoomToken, verifyRoomToken } = require('../room-auth');

describe('room-auth', () => {
  const secret = 'test-room-secret';

  test('createRoomToken returns exp and sig', () => {
    const token = createRoomToken('my-room', secret, 60);
    expect(typeof token.exp).toBe('number');
    expect(typeof token.sig).toBe('string');
    expect(token.sig.length).toBeGreaterThan(0);
  });

  test('verifyRoomToken accepts a freshly minted token', () => {
    const token = createRoomToken('jam', secret, 3600);
    expect(verifyRoomToken('jam', token, secret)).toBe(true);
  });

  test('verifyRoomToken rejects wrong room', () => {
    const token = createRoomToken('room-a', secret, 3600);
    expect(verifyRoomToken('room-b', token, secret)).toBe(false);
  });

  test('verifyRoomToken rejects expired token', () => {
    const token = { exp: Math.floor(Date.now() / 1000) - 10, sig: 'deadbeef' };
    expect(verifyRoomToken('room', token, secret)).toBe(false);
  });

  test('verifyRoomToken passes when secret is empty (auth disabled)', () => {
    expect(verifyRoomToken('any', null, '')).toBe(true);
  });
});
