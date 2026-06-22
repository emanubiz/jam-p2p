'use strict';

const crypto = require('crypto');

const DEFAULT_TURN_TTL_SEC = 86400;

/**
 * Generate ephemeral TURN REST credentials (coturn-compatible).
 * username = `${expiry}:${userId}`; credential = HMAC-SHA1(secret, username).
 *
 * @param {string} secret
 * @param {string} [userId]
 * @param {number} [ttlSec]
 * @returns {{ username: string, credential: string, expiry: number }}
 */
function generateTurnCredentials(secret, userId = 'jam', ttlSec = DEFAULT_TURN_TTL_SEC) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiry };
}

/**
 * Build ICE server entries, optionally with dynamic TURN credentials.
 *
 * @param {{ turnUrls?: string[], turnSecret?: string, staticTurn?: object[] }} opts
 * @returns {object[]}
 */
function buildIceServers({ turnUrls = [], turnSecret = '', staticTurn = [] } = {}) {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
  ];

  if (turnSecret && turnUrls.length > 0) {
    const creds = generateTurnCredentials(turnSecret);
    for (const url of turnUrls) {
      servers.push({
        urls: [url],
        username: creds.username,
        credential: creds.credential,
      });
    }
    return servers;
  }

  if (staticTurn.length > 0) {
    servers.push(...staticTurn);
  }

  return servers;
}

module.exports = {
  generateTurnCredentials,
  buildIceServers,
  DEFAULT_TURN_TTL_SEC,
};
