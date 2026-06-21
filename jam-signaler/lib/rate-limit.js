'use strict';

// Per-IP sliding-window rate limiter for the HTTP API and for WS handshakes.
// Each map entry stores a { count, windowStart } pair and is automatically
// reclaimed by a single periodic cleaner (see startRateLimitCleanup).

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 1000;
const DEFAULT_MAX_AGE_MS = 5000;
const DEFAULT_CLEANUP_INTERVAL_MS = 10000;

/**
 * Sliding-window per-key rate limit. Returns true if the request is allowed
 * (under the cap), false if it should be rejected.
 *
 * @param {Map<string, {count: number, windowStart: number}>} store
 * @param {string} key  The rate-limit key (typically a client IP).
 * @param {number} limit  Max requests allowed within the window.
 * @param {number} windowMs  Window size in ms.
 */
function checkRateLimit(store, key, limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS) {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
    store.set(key, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

function startRateLimitCleanup(
  stores,
  intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS
) {
  setInterval(() => {
    const now = Date.now();
    for (const store of stores) {
      for (const [key, entry] of store) {
        if (now - entry.windowStart > maxAgeMs) store.delete(key);
      }
    }
  }, intervalMs).unref();
}

module.exports = {
  checkRateLimit,
  startRateLimitCleanup,
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_MS,
};
