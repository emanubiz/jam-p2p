# Mesh Network Verification Plan — EMA-17

## Objective
Verify that jam-p2p mesh topology works correctly with multiple peers (3+ participants) for P2P audio streaming.

## Architecture Overview
- **Signaling Server**: `jam-signaler/server.js` — WebSocket-based, room-centric
- **Peer Connection Flow**:
  1. Client connects → receives `Welcome` with UUID + ICE servers
  2. Client sends `Join` with room name
  3. Server sends `PeerList` to new peer (existing peers)
  4. Server sends `NewPeer` to existing peers (new peer's UUID)
  5. Peers establish WebRTC connections via `Offer`/`Answer`/`Ice` messages

## Test Scenarios

### 1. Signaling Server Tests

#### 1.1 Single Peer Join
- **Action**: Connect and join room "test"
- **Expected**: Receive `Welcome` with UUID, then `PeerList` with empty array
- **Status**: ✅ PASS (verified 2026-04-28)

#### 1.2 Two-Peer Mesh
- **Action**: Peer A joins, Peer B joins
- **Expected**: 
  - Peer A receives `PeerList` with []
  - Peer B receives `PeerList` with [A's UUID]
  - Peer A receives `NewPeer` with B's UUID
- **Status**: ✅ PASS (verified 2026-04-28)

#### 1.3 Three-Peer Mesh
- **Action**: Peers A, B, C join same room
- **Expected**:
  - A: PeerList [], NewPeer B, NewPeer C
  - B: PeerList [A], NewPeer C
  - C: PeerList [A, B]
- **Status**: ✅ PASS (verified 2026-04-28)

#### 1.4 Five-Peer Mesh (Scalability Test)
- **Action**: 5 peers join same room
- **Expected**: All peers receive correct PeerList and NewPeer notifications
- **Measure**: Time to fully connect 5 peers
- **Status**: ✅ PASS (verified 2026-04-28, ~3574ms)
- **Result**: All 5 peers correctly receive PeerList with proper counts and NewPeer notifications

#### 1.5 Peer Disconnect
- **Action**: Peer leaves room
- **Expected**: Other peers notified via `PeerLeft`, room cleanup when empty
- **Status**: ✅ PASS (verified 2026-04-28)

#### 1.6 Offer/Answer/ICE Forwarding
- **Action**: Send WebRTC signaling messages between peers
- **Expected**: Messages correctly forwarded with `from` field added
- **Status**: ✅ PASS (verified 2026-04-28)

### 2. WebRTC Mesh Connectivity Tests

#### 2.1 Full Mesh Connections (3 peers)
- **Action**: Each peer creates RTCPeerConnection to all others
- **Expected**: 3 peers = 6 connections (2 per peer)
- **Verify**: All connections reach `connected` state
- **Status**: ✅ PASS (verified 2026-04-28)

#### 2.2 Full Mesh Connections (5 peers)
- **Action**: 5 peers create mesh
- **Expected**: 5 peers = 20 connections (4 per peer)
- **Status**: ✅ PASS (verified 2026-04-28)
- **Result**: All 20 connections established correctly. Full mesh topology verified.

### 3. Audio Quality Tests

#### 3.1 Audio Streaming (3 peers)
- **Action**: Peer A streams audio, B and C receive
- **Expected**: Audio flows from A → B, A → C via RTP tracks (Opus codec)
- **Measure**: Latency, audio dropouts, buffer health
- **Status**: ⏸ Pending — backend code complete (cpal + Opus + webrtc-rs), needs E2E test with actual audio devices and Tauri runtime
- **Note**: Audio uses RTP tracks (not data channels), Opus VoIP mode at configurable bitrate (default 64kbps)

#### 3.2 Multi-Source Audio (5 peers)
- **Action**: All 5 peers stream simultaneously
- **Expected**: All audio streams reach all destinations
- **Status**: ⏸ Pending

### 4. Scalability Limits

#### 4.1 Connection Count Impact
- **Test**: 2, 3, 5, 8, 10 peers
- **Measure**: 
  - Time to establish full mesh
  - Memory per peer connection
  - CPU usage during establishment
  - Signaling server load

#### 4.2 Bandwidth Estimation
- **Formula**: N peers × (N-1) connections × audio bitrate
- **Example**: 5 peers × 4 connections × 128kbps = 2560kbps total upload per peer

## Success Criteria

| Criterion | Status |
|---|---|
| 3-peer mesh establishes successfully (signaling + WebRTC flow) | ✅ Verified |
| 5-peer mesh establishes successfully (signaling + WebRTC flow) | ✅ Verified |
| Audio streaming between peers | ⏸ Pending (needs E2E with devices) |
| Latency < 150ms for 3-peer mesh | ⏸ Pending (needs E2E with devices) |
| Latency < 200ms for 5-peer mesh | ⏸ Pending (needs E2E with devices) |
| No connection failures in normal conditions | ✅ Verified (automated tests) |
| Graceful handling of peer disconnection | ✅ Verified (automated tests) |

## Test Environment
- **Signaling Server**: localhost:8080 (default)
- **ICE Servers**: Google STUN + OpenRelay TURN (configured in signaling and backend)
- **Frontend**: Tauri desktop app (browser mode for UI only)
- **OS**: Linux (primary), Windows/macOS (CI builds)

## Next Steps
1. ✅ Automated signaling server tests — COMPLETE
2. ✅ 3-peer mesh verification — COMPLETE
3. ✅ 5-peer mesh verification — COMPLETE
4. ⏸ Manual E2E audio test with 2+ Tauri instances — REQUIRES AUDIO DEVICES
5. Document E2E audio results

---

**Last Updated**: 2026-05-05
