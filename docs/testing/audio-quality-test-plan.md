# Audio Streaming Quality Test Plan — EMA-21

## Objective
Test audio streaming quality in mesh topology with 3+ peers. Measure latency, check for dropouts, and verify audio quality.

## Prerequisites
- Signaling server running (tested in EMA-17 ✅)
- WebRTC mesh connections working (tested in EMA-16 ✅)
- Tauri app built and running (via `npm run tauri dev` or `npm run tauri build`)
- Audio input/output devices available

## Test Scenarios

### 1. Single Source, Multiple Receivers (3 peers)
**Setup:**
- Peer A: Audio source (microphone or test tone)
- Peer B: Receiver
- Peer C: Receiver

**Measurements:**
- Latency: A → B, A → C
- Audio quality at B and C
- Check for dropouts, artifacts

**Expected:**
- Latency < 150ms (acceptable for jam session)
- No audible dropouts
- Clear audio quality

**Status**: ⏸ Pending — requires E2E with actual audio devices

### 2. Multiple Sources (3 peers all streaming)
**Setup:**
- Peer A: Streaming audio
- Peer B: Streaming audio  
- Peer C: Streaming audio
- All peers receive audio from other 2 peers

**Measurements:**
- Aggregate bandwidth per peer
- CPU usage
- Audio quality for each stream
- Mixing quality at each peer

**Expected:**
- All streams audible simultaneously
- No stream starvation
- Mixing works correctly (tanh soft clipping)

**Status**: ⏸ Pending — requires E2E with actual audio devices

### 3. Scalability Test (5 peers)
**Setup:**
- 5 peers all streaming and receiving
- Each peer receives 4 audio streams

**Measurements:**
- Connection stability over 5 minutes
- Latency per stream
- CPU/memory usage
- Any stream disconnections

**Expected:**
- All 20 connections remain stable
- Latency remains acceptable (< 200ms)
- No peer disconnections due to overload

**Status**: ⏸ Pending — requires E2E with actual audio devices

### 4. Audio Level Metering
**Verify:**
- VU meters update correctly for each peer (remote)
- Local mic level shows in "MY INPUT" channel
- Remote peer levels show in their channels
- Level smoothing works (no jittery meters, EMA α=0.3)

**Status**: ⏸ Pending — requires E2E with actual audio devices

## Testing Approach

### Approach: Manual Testing with Tauri App
1. Build Tauri app: `cd jam-gui && npm run tauri build`
2. Run multiple instances (or use multiple machines)
3. Join same room
4. Play audio/mic from each peer
5. Observe mixing, levels, and latency

### Rust Backend Unit Tests (Available)
- ✅ 22 unit tests in `audio.rs` covering encoding, decoding, mixing logic
- ✅ Tests: audio levels, clipping, EMA smoothing, edge cases
- ⏸ E2E audio streaming requires manual verification

## Metrics to Collect

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Latency (one-way) | < 150ms | RTP timestamp analysis or manual clap test |
| Latency (round-trip) | < 300ms | Manual clap test |
| Audio dropouts | 0/min | Listen for gaps |
| CPU usage per peer | < 50% | htop/top or Task Manager |
| Memory per peer | < 200MB | Watch RSS or Task Manager |
| Bandwidth per stream | ~64-128kbps | iftop/nethogs or Resource Monitor |

## Current Status

| Item | Status |
|---|---|
| Signaling server | ✅ Tested and working |
| WebRTC mesh connectivity | ✅ Tested and working |
| Rust audio pipeline tests | ✅ 22 unit tests pass |
| E2E audio streaming | ⏸ Requires manual test with devices |
| Latency measurement | ⏸ Requires E2E |
| Mixing quality assessment | ⏸ Requires E2E |

## Recommended Next Steps

1. **Install system dependencies** for local Rust build (if running natively)
2. **Build Tauri app** with `npm run tauri build`
3. **Run 2+ instances** on same machine or different machines
4. **Join same room** and verify audio flows both directions
5. **Document results** — latency, quality, any issues

## Test Artifacts

- Test plan: `docs/testing/audio-quality-test-plan.md` (this file)
- Signaling tests: `docs/testing/scripts/test-mesh-signaling.js` ✅
- WebRTC mesh tests: `docs/testing/scripts/test-webrtc-mesh.js` ✅
- Rust unit tests: `jam-gui/src-tauri/src/audio.rs` (22 tests) ✅

## Technical Notes

- Audio pipeline: mic → cpal → mono downmix → ringbuffer → Opus encoder → RTP tracks → WebRTC → remote
- Remote: WebRTC track → RTP → Opus decoder → ringbuffer → mixer (sum + tanh) → cpal output → speakers
- VU meters: RMS → dBFS → normalized [-60dB, 0dB] → [0,1] → EMA smoothing (α=0.3)
- ICE servers: Google STUN + OpenRelay TURN (configured)
- Default Opus bitrate: 64kbps, VoIP mode, 20ms frames (configurable 16-192 kbps)
- Reconnect: exponential backoff 1s → 30s max
- Topology: full mesh (N*(N-1)/2 connections)

---

**Last Updated**: 2026-05-05
