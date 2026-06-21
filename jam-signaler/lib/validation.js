'use strict';

// Wire-protocol validation. The shapes here are part of the contract with
// the Rust client (`jam-gui/src-tauri/src/messages.rs`) — if any of these
// conditions change, the server and client will silently fail to negotiate.

const VALID_MESSAGE_TYPES = new Set(['Join', 'Leave', 'Offer', 'Answer', 'Ice']);

const MAX_ROOM_NAME_LENGTH = 64;
const MAX_NAME_LENGTH = 32;

function isNonEmptyString(value, maxLength) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isOptionalString(value, maxLength) {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

/**
 * Validate a parsed WS message. Returns true iff the message is a well-formed
 * instance of one of the 5 wire types we accept. Anything else is rejected
 * before any handler runs (so malformed JSON-parse errors are also rejected
 * upstream at the JSON.parse boundary).
 */
function validateMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!VALID_MESSAGE_TYPES.has(message.type)) return false;

  switch (message.type) {
    case 'Join':
      return Boolean(
        message.data &&
          isNonEmptyString(message.data.room, MAX_ROOM_NAME_LENGTH) &&
          isOptionalString(message.data.name, MAX_NAME_LENGTH)
      );
    case 'Leave':
      return true;
    case 'Offer':
    case 'Answer':
      return Boolean(
        message.data &&
          typeof message.data.target === 'string' &&
          message.data.target.length > 0 &&
          typeof message.data.sdp === 'string' &&
          message.data.sdp.length > 0
      );
    case 'Ice':
      return Boolean(
        message.data &&
          typeof message.data.target === 'string' &&
          message.data.target.length > 0 &&
          typeof message.data.candidate === 'string' &&
          message.data.candidate.length > 0
      );
    default:
      return false;
  }
}

module.exports = {
  validateMessage,
  VALID_MESSAGE_TYPES,
  MAX_ROOM_NAME_LENGTH,
  MAX_NAME_LENGTH,
};
