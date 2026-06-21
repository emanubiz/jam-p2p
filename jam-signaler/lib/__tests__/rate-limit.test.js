'use strict';

const { checkRateLimit, startRateLimitCleanup } = require('../rate-limit');

describe('checkRateLimit', () => {
  let store;
  beforeEach(() => {
    store = new Map();
  });

  test('allows the first request', () => {
    expect(checkRateLimit(store, '1.2.3.4', 100)).toBe(true);
  });

  test('allows up to the limit (default 100)', () => {
    for (let i = 0; i < 99; i++) checkRateLimit(store, '1.2.3.5', 100);
    expect(checkRateLimit(store, '1.2.3.5', 100)).toBe(true);
  });

  test('rejects the request that exceeds the limit', () => {
    for (let i = 0; i < 100; i++) checkRateLimit(store, '1.2.3.6', 100);
    expect(checkRateLimit(store, '1.2.3.6', 100)).toBe(false);
  });

  test('tracks different keys independently', () => {
    for (let i = 0; i < 100; i++) checkRateLimit(store, 'a', 100);
    expect(checkRateLimit(store, 'a', 100)).toBe(false);
    expect(checkRateLimit(store, 'b', 100)).toBe(true);
  });

  test('window resets after the configured window expires', async () => {
    // 30 ms window so the whole test is fast.
    const win = 30;
    for (let i = 0; i < 5; i++) checkRateLimit(store, 'x', 5, win);
    expect(checkRateLimit(store, 'x', 5, win)).toBe(false);

    await new Promise((r) => setTimeout(r, win + 20));
    expect(checkRateLimit(store, 'x', 5, win)).toBe(true);
  });

  test('custom limit honored', () => {
    expect(checkRateLimit(store, 'k', 3)).toBe(true);
    expect(checkRateLimit(store, 'k', 3)).toBe(true);
    expect(checkRateLimit(store, 'k', 3)).toBe(true);
    expect(checkRateLimit(store, 'k', 3)).toBe(false);
  });
});

describe('startRateLimitCleanup', () => {
  test('reclaims stale entries from passed-in stores', async () => {
    const store = new Map();
    checkRateLimit(store, 'a', 100);
    checkRateLimit(store, 'b', 100);
    expect(store.size).toBe(2);

    // Schedule a cleanup with a tiny max-age so the entries are stale by the
    // time the cleaner fires, then trigger it manually via the captured
    // callback. We mock setInterval to capture without actually scheduling.
    const origSetInterval = global.setInterval;
    let captured = null;
    global.setInterval = (cb, ms) => {
      captured = cb;
      return { unref() {} };
    };
    try {
      startRateLimitCleanup([store], 1000, 0);
    } finally {
      global.setInterval = origSetInterval;
    }
    expect(typeof captured).toBe('function');

    // Force entries to be older than `maxAge` by rewinding their windowStart.
    for (const entry of store.values()) entry.windowStart -= 1;

    captured();
    expect(store.size).toBe(0);
  });
});
