'use strict';

const WebSocket = require('ws');

/**
 * Remove a peer from their current room and broadcast PeerLeft to the room
 * survivors. Centralized so the explicit `Leave` handler and the implicit
 * `close` handler cannot drift apart in their cleanup semantics.
 *
 * Idempotent: safe to call even if the peer is no longer in the room (a no-op).
 *
 * @param {WebSocket} ws  The departing socket (unused for cleanup, but kept
 *   for future per-socket bookkeeping).
 * @param {string} uuid  Server-issued UUID of the departing peer.
 * @param {string|null} room  Room name, or null if the peer was never joined.
 * @param {Map<string, Map<string, WebSocket>>} rooms  Room index.
 * @param {object} [logger]  Optional pino-style logger for the `info` event.
 */
function removePeerFromRoom(ws, uuid, room, rooms, logger) {
  if (!room || !rooms.has(room)) return false;
  const roomPeers = rooms.get(room);
  // Only broadcast if the peer was actually a member of this room. This makes
  // the helper idempotent — repeated calls for the same (uuid, room) pair
  // don't generate duplicate PeerLeft messages for the survivors.
  if (!roomPeers.delete(uuid)) return false;
  const peerLeft = JSON.stringify({ type: 'PeerLeft', data: { uuid } });
  roomPeers.forEach((peerWs) => {
    if (peerWs.readyState === WebSocket.OPEN) {
      peerWs.send(peerLeft);
    }
  });
  if (roomPeers.size === 0) rooms.delete(room);
  if (logger) logger.info({ uuid, room }, 'Peer removed from room');
  return true;
}

module.exports = { removePeerFromRoom };
