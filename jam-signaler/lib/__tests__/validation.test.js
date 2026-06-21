'use strict';

const { validateMessage } = require('../validation');

describe('validateMessage', () => {
  describe('structural guards', () => {
    test('rejects null', () => {
      expect(validateMessage(null)).toBe(false);
    });

    test('rejects undefined', () => {
      expect(validateMessage(undefined)).toBe(false);
    });

    test('rejects non-object primitives', () => {
      expect(validateMessage(42)).toBe(false);
      expect(validateMessage('Join')).toBe(false);
      expect(validateMessage(true)).toBe(false);
    });

    test('rejects unknown type tag', () => {
      expect(validateMessage({ type: 'Hack' })).toBe(false);
      expect(validateMessage({ type: 'Error' })).toBe(false); // Error is server→client only
      expect(validateMessage({ type: 'Welcome' })).toBe(false);
    });

    test('rejects missing type tag', () => {
      expect(validateMessage({ data: {} })).toBe(false);
      expect(validateMessage({})).toBe(false);
    });
  });

  describe('Join', () => {
    test('accepts a well-formed Join with just a room', () => {
      expect(validateMessage({ type: 'Join', data: { room: 'studio' } })).toBe(true);
    });

    test('accepts a Join with room + name', () => {
      expect(
        validateMessage({ type: 'Join', data: { room: 'studio', name: 'Alice' } })
      ).toBe(true);
    });

    test('rejects Join with empty room', () => {
      expect(validateMessage({ type: 'Join', data: { room: '' } })).toBe(false);
      expect(validateMessage({ type: 'Join', data: { room: '   ' } })).toBe(false);
    });

    test('rejects Join without data field', () => {
      expect(validateMessage({ type: 'Join' })).toBe(false);
    });

    test('rejects Join without room', () => {
      expect(validateMessage({ type: 'Join', data: {} })).toBe(false);
      expect(validateMessage({ type: 'Join', data: { name: 'Alice' } })).toBe(false);
    });

    test('rejects Join with non-string room', () => {
      expect(validateMessage({ type: 'Join', data: { room: 42 } })).toBe(false);
      expect(validateMessage({ type: 'Join', data: { room: null } })).toBe(false);
    });

    test('rejects Join with name longer than 32 chars', () => {
      const longName = 'A'.repeat(33);
      expect(validateMessage({ type: 'Join', data: { room: 'r', name: longName } })).toBe(
        false
      );
    });

    test('accepts Join with name of exactly 32 chars', () => {
      const maxName = 'A'.repeat(32);
      expect(validateMessage({ type: 'Join', data: { room: 'r', name: maxName } })).toBe(
        true
      );
    });

    test('rejects Join with non-string name', () => {
      expect(validateMessage({ type: 'Join', data: { room: 'r', name: 42 } })).toBe(false);
    });

    test('rejects Join with room longer than 64 chars', () => {
      const longRoom = 'A'.repeat(65);
      expect(validateMessage({ type: 'Join', data: { room: longRoom } })).toBe(false);
    });
  });

  describe('Leave', () => {
    test('accepts a bare Leave', () => {
      expect(validateMessage({ type: 'Leave' })).toBe(true);
    });

    test('accepts Leave even with extra fields (they are ignored)', () => {
      expect(validateMessage({ type: 'Leave', data: {} })).toBe(true);
    });
  });

  describe('Offer / Answer', () => {
    test.each([
      ['Offer', { type: 'Offer', data: { target: 'p', sdp: 'v=0...' } }],
      ['Answer', { type: 'Answer', data: { target: 'p', sdp: 'v=0...' } }],
    ])('accepts a well-formed %s', (_, msg) => {
      expect(validateMessage(msg)).toBe(true);
    });

    test.each(['Offer', 'Answer'])('rejects %s without target', (type) => {
      expect(validateMessage({ type, data: { sdp: 'x' } })).toBe(false);
    });

    test.each(['Offer', 'Answer'])('rejects %s without sdp', (type) => {
      expect(validateMessage({ type, data: { target: 'p' } })).toBe(false);
    });

    test.each(['Offer', 'Answer'])('rejects %s with empty target', (type) => {
      expect(validateMessage({ type, data: { target: '', sdp: 'x' } })).toBe(false);
    });

    test.each(['Offer', 'Answer'])('rejects %s with empty sdp', (type) => {
      expect(validateMessage({ type, data: { target: 'p', sdp: '' } })).toBe(false);
    });
  });

  describe('Ice', () => {
    test('accepts a well-formed Ice', () => {
      expect(
        validateMessage({ type: 'Ice', data: { target: 'p', candidate: '...' } })
      ).toBe(true);
    });

    test('rejects Ice without candidate', () => {
      expect(validateMessage({ type: 'Ice', data: { target: 'p' } })).toBe(false);
    });

    test('rejects Ice with empty candidate', () => {
      expect(
        validateMessage({ type: 'Ice', data: { target: 'p', candidate: '' } })
      ).toBe(false);
    });
  });
});
