'use strict';

const crypto = require('crypto');

const DEFAULT_TOKEN_TTL_SEC = 3600;

/**
 * Create an HMAC room token. Payload is `exp\\0room` to avoid delimiter
 * collisions in room names.
 *
 * @param {string} room
 * @param {string} secret
 * @param {number} [ttlSec]
 * @returns {{ exp: number, sig: string }}
 */
function createRoomToken(room, secret, ttlSec = DEFAULT_TOKEN_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', secret).update(`${exp}\0${room}`).digest('hex');
  return { exp, sig };
}

/**
 * Verify a room token with constant-time signature comparison.
 * Returns true when `secret` is empty (auth disabled).
 *
 * @param {string} room
 * @param {{ exp?: number, sig?: string } | null | undefined} token
 * @param {string} secret
 * @returns {boolean}
 */
function verifyRoomToken(room, token, secret) {
  if (!secret) return true;
  if (!token || typeof token.exp !== 'number' || typeof token.sig !== 'string') {
    return false;
  }
  if (token.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${token.exp}\0${room}`)
    .digest('hex');
  if (token.sig.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(token.sig, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = {
  createRoomToken,
  verifyRoomToken,
  DEFAULT_TOKEN_TTL_SEC,
};
