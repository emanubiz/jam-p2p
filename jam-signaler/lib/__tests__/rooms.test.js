'use strict';

const { removePeerFromRoom } = require('../rooms');

// Minimal WebSocket stand-in (only the fields rooms.js touches).
function fakeWs(open = true) {
  const sent = [];
  return {
    readyState: open ? 1 : 3, // 1 = OPEN, 3 = CLOSED
    send(msg) {
      sent.push(msg);
    },
    _sent: sent,
  };
}

describe('removePeerFromRoom', () => {
  test('is a no-op when room is null', () => {
    const rooms = new Map();
    const ws = fakeWs();
    removePeerFromRoom(ws, 'uuid', null, rooms);
    expect(rooms.size).toBe(0);
    expect(ws._sent.length).toBe(0);
  });

  test('is a no-op when room does not exist', () => {
    const rooms = new Map();
    const ws = fakeWs();
    removePeerFromRoom(ws, 'uuid', 'ghost', rooms);
    expect(rooms.size).toBe(0);
  });

  test('removes the peer and broadcasts PeerLeft to survivors', () => {
    const rooms = new Map();
    const survivor = fakeWs();
    rooms.set('studio', new Map([['uuid', fakeWs()], ['survivor-id', survivor]]));

    removePeerFromRoom(fakeWs(), 'uuid', 'studio', rooms);

    expect(rooms.get('studio').has('uuid')).toBe(false);
    expect(rooms.get('studio').has('survivor-id')).toBe(true);
    expect(survivor._sent.length).toBe(1);
    expect(JSON.parse(survivor._sent[0])).toEqual({
      type: 'PeerLeft',
      data: { uuid: 'uuid' },
    });
  });

  test('drops the room entirely when last peer leaves', () => {
    const rooms = new Map();
    const only = fakeWs();
    rooms.set('studio', new Map([['uuid', only]]));

    removePeerFromRoom(fakeWs(), 'uuid', 'studio', rooms);

    expect(rooms.has('studio')).toBe(false);
    expect(only._sent.length).toBe(0); // No one to broadcast to.
  });

  test('does not broadcast to a peer whose socket is closed', () => {
    const rooms = new Map();
    const closedPeer = fakeWs(false);
    const openPeer = fakeWs();
    rooms.set(
      'studio',
      new Map([
        ['uuid', fakeWs()],
        ['closed-id', closedPeer],
        ['open-id', openPeer],
      ])
    );

    removePeerFromRoom(fakeWs(), 'uuid', 'studio', rooms);

    expect(closedPeer._sent.length).toBe(0);
    expect(openPeer._sent.length).toBe(1);
  });

  test('idempotent: second call for the same uuid is a no-op', () => {
    const rooms = new Map();
    const survivor = fakeWs();
    rooms.set('studio', new Map([['uuid', fakeWs()], ['survivor-id', survivor]]));

    removePeerFromRoom(fakeWs(), 'uuid', 'studio', rooms);
    survivor._sent.length = 0;

    removePeerFromRoom(fakeWs(), 'uuid', 'studio', rooms);
    expect(rooms.get('studio').has('uuid')).toBe(false);
    expect(survivor._sent.length).toBe(0);
  });
});
