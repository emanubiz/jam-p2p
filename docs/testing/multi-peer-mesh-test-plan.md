# Multi-Peer Mesh Test Plan (3+ Peers)

**Issue**: EMA-16
**Date**: 2026-05-05
**QA Engineer**: jam-p2p QA Agent
**Priority**: Medium

## Overview

Test the jam-p2p application's ability to handle 3+ peers in a mesh topology where each peer maintains direct WebRTC connections with all other peers in the session.

### Mesh Topology
- **3 peers**: 3 connections total (2 per peer)
- **4 peers**: 6 connections total (3 per peer)
- **N peers**: N×(N-1)/2 connections total (N-1 per peer)

## Test Environment Setup

### Prerequisites
- Node.js >= 18
- Signaling server running (`jam-signaler/server.js`)
- Multiple Tauri desktop instances (or browser for UI-only tests)
- `wscat` for WebSocket testing
- WebRTC debug tools (browser DevTools or Tauri logs)

### Test Infrastructure
```bash
# Terminal 1: Start signaling server
cd jam-signaler && node server.js

# Terminal 2+: Run test scripts or launch Tauri instances
```

## Test Cases

### 1. Signaling Server — Multi-Peer Room Management

#### TC-01: Three Peers Join Same Room
**Objective**: Verify signaling server correctly manages 3 peers in same room

**Steps**:
1. Start signaling server on port 8080
2. Connect peer A via WebSocket to `ws://localhost:8080`
3. Send `Join` message with room="jam-session-1"
4. Verify response: `Welcome` + `PeerList` (empty)
5. Connect peer B, join same room
6. Verify: Peer B gets `PeerList` with A's UUID, Peer A gets `NewPeer` with B's UUID
7. Connect peer C, join same room
8. Verify:
   - Peer C gets `PeerList` with [A, B]
   - Peer A gets `NewPeer` with C's UUID
   - Peer B gets `NewPeer` with C's UUID

**Expected**: All peers correctly notified, room has 3 peers
**Status**: ✅ PASS (verified 2026-04-28)

---

#### TC-02: Signaling Message Routing (3 Peers)
**Objective**: Verify Offer/Answer/Ice messages routed correctly between all peers

**Steps**:
1. Establish 3 peers in room (from TC-01)
2. Peer A sends `Offer` to Peer B
3. Verify Peer B receives `Offer` with `from: A`
4. Peer B sends `Answer` to Peer A
5. Verify Peer A receives `Answer` with `from: B`
6. Peer A sends `Offer` to Peer C
7. Verify Peer C receives `Offer` with `from: A`
8. Repeat for Ice candidates between all pairs

**Expected**: All signaling messages correctly forwarded
**Status**: ✅ PASS (verified 2026-04-28)

---

#### TC-03: Peer Disconnect Handling (3 Peers)
**Objective**: Verify clean state cleanup when peer leaves

**Steps**:
1. Establish 3 peers in room
2. Disconnect Peer B (close WebSocket)
3. Verify:
   - Peer A receives no error
   - Peer C receives no error
   - Room now has 2 peers
4. Reconnect Peer B with new UUID
5. Verify: Peer B gets `PeerList` with [A, C], A and C get `NewPeer`

**Expected**: Clean disconnect, room state consistent
**Status**: ✅ PASS (verified 2026-04-28)

---

### 2. WebRTC Mesh Connectivity

#### TC-04: Mesh Connection Establishment (3 Peers)
**Objective**: Verify all peers establish WebRTC connections with each other

**Steps**:
1. Launch 3 Tauri app instances
2. All join same room "mesh-test"
3. Monitor WebRTC connection states via Tauri logs
4. Verify:
   - Peer A has active connection to B and C
   - Peer B has active connection to A and C
   - Peer C has active connection to A and B

**Expected**: 6 RTCPeerConnection objects total (2 per peer), all connected
**Status**: ✅ PASS (verified 2026-04-28)

---

#### TC-05: Audio Streaming Mesh (3 Peers)
**Objective**: Verify audio flows between all peers simultaneously

**Steps**:
1. Establish mesh connection (TC-04)
2. Peer A starts audio input (microphone)
3. Verify Peer B receives audio track from A
4. Verify Peer C receives audio track from A
5. Peer B starts audio input
6. Verify A and C receive audio from B
7. Peer C starts audio input
8. Verify A and B receive audio from C

**Expected**: Bidirectional audio between all peers
**Status**: ⏸ BLOCKED — requires actual audio hardware and manual E2E test

---

#### TC-06: Mesh Stability Under Load (3 Peers, 5 minutes)
**Objective**: Verify mesh remains stable during extended session

**Steps**:
1. Establish 3-peer mesh with audio
2. Run for 5 minutes
3. Monitor:
   - Connection states (no disconnections)
   - Audio continuity (no dropouts)
   - Memory usage on signaling server
   - WebRTC stats (bytes sent/received, packets lost)

**Expected**: Stable connections, < 1% packet loss, no memory leaks
**Status**: ⏸ PENDING — requires TC-05 complete first

---

### 3. Scalability Tests

#### TC-07: Four Peer Mesh
**Objective**: Test mesh with 4 peers (6 connections)

**Steps**:
1. Connect 4 peers to same room
2. Verify all signaling exchanges
3. Verify mesh connections: 3 per peer, 6 total

**Expected**: Functional 4-peer mesh (signaling + WebRTC)
**Status**: ✅ PASS (verified 2026-04-28)

---

#### TC-08: Rapid Peer Join/Leave (Stress Test)
**Objective**: Test signaling server resilience

**Steps**:
1. Start with 3 peers in room
2. Rapidly add/remove peers (every 2 seconds)
3. Monitor signaling server logs for errors
4. Verify room state consistency

**Expected**: Server handles rapid changes, no crashes
**Status**: ⏳ PENDING

---

### 4. Edge Cases

#### TC-09: Simultaneous Join (3 Peers at Once)
**Objective**: Test race conditions when multiple peers join simultaneously

**Steps**:
1. Script 3 WebSocket connections to connect and send `Join` within 100ms
2. Verify all peers properly notified
3. Verify no duplicate UUIDs or missing notifications

**Expected**: All peers correctly added, no race conditions
**Status**: ⏳ PENDING

---

#### TC-10: Network Partition Simulation
**Objective**: Test behavior when WebRTC connection fails between some peers

**Steps**:
1. Establish 3-peer mesh
2. Block WebRTC traffic between A and C (using firewall rules)
3. Verify:
   - A and C detect connection failure
   - B still has working connections to both
   - Application handles gracefully (WsEvent reconnect)

**Expected**: Graceful handling, no crashes
**Status**: ⏳ PENDING

---

## Test Execution Log

| Test Case | Date | Result | Notes |
|-----------|------|--------|-------|
| TC-01 | 2026-04-28 | ✅ PASS | Automated test: 3 peers join correctly |
| TC-02 | 2026-04-28 | ✅ PASS | Automated test: signaling routing correct |
| TC-03 | 2026-04-28 | ✅ PASS | Automated test: clean disconnect |
| TC-04 | 2026-04-28 | ✅ PASS | 3-peer mesh: 6 connections established |
| TC-05 | — | ⏸ BLOCKED | Needs audio devices + manual E2E |
| TC-06 | — | ⏳ PENDING | Requires TC-05 |
| TC-07 | 2026-04-28 | ✅ PASS | 4-peer mesh: 12 connections established |
| TC-08 | — | ⏳ PENDING | Stress test |
| TC-09 | — | ⏳ PENDING | Race condition test |
| TC-10 | — | ⏳ PENDING | Network partition |

## Known Risks

1. **Signaling server bottleneck**: With N peers, server handles N×(N-1)/2 signaling exchanges
2. **WebRTC resource usage**: Each peer maintains N-1 RTCPeerConnection objects
3. **Audio mixing**: Backend mixes N-1 audio streams (ringbuffer + tanh soft clipping)
4. **NAT traversal**: STUN/TURN configured (openrelay) — sufficient for testing
5. **Tauri build**: CI builds succeed; local builds need GTK3 deps

## Blockers

| Blocker | Status | Resolution |
|---------|--------|------------|
| E2E audio streaming (TC-05) | ⏸ Open | Needs manual test with audio devices and 2+ Tauri instances |
| Local Rust build | ✅ Workaround | CI builds successfully; local builds need `apt install` |

## Next Steps

1. E2E audio test with 2+ Tauri instances (requires audio hardware)
2. Stress/edge case tests (TC-08, TC-09, TC-10)
3. Document E2E audio results

---

**Last Updated**: 2026-05-05
