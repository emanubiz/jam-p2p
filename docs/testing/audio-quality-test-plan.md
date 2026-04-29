# Audio Streaming Quality Test Plan - EMA-21

## Objective
Test audio streaming quality in mesh topology with 3+ peers. Measure latency, check for dropouts, and verify audio quality.

## Prerequisites
- Signaling server running (tested in EMA-17 ✅)
- WebRTC mesh connections working (tested in EMA-20 ✅)
- Either:
  - Tauri app built and running (jam-gui)
  - Or browser-based test environment with WebRTC support

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
- Mixing works correctly

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

### 4. Audio Level Metering
**Verify:**
- VU meters update correctly for each peer
- Local mic level shows in "You" channel
- Remote peer levels show in their channels
- Level smoothing works (no jittery meters)

## Testing Approach

### Option A: Manual Testing with Tauri App
1. Build Tauri app: `cd jam-gui && npm run tauri build`
2. Run multiple instances (if supported) or use multiple machines
3. Join same room
4. Play audio/mic from each peer
5. Observe mixing, levels, and latency

### Option B: Browser Testing (if WebRTC exposed)
1. Expose WebRTC connections to browser UI
2. Use WebAudio API to generate test tones
3. Measure latency using RTP timestamps
4. Check audio element output

### Option C: Rust Backend Unit Tests
1. Create mock audio streams in Rust
2. Test encoding/decoding pipeline
3. Verify Opus encoder/decoder works
4. Test mixing logic with synthetic audio

## Metrics to Collect

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Latency (one-way) | < 150ms | RTP timestamp analysis |
| Latency (round-trip) | < 300ms | Manual clap test |
| Audio dropouts | 0/min | Listen for gaps |
| CPU usage per peer | < 50% | htop/top |
| Memory per peer | < 200MB | Watch RSS |
| Bandwidth per stream | ~128kbps | iftop/nethogs |

## Current Status

❌ **Cannot complete fully** - requires either:
1. Tauri app with multi-instance support, OR
2. Browser-based testing environment, OR  
3. Rust unit tests for audio pipeline

## Recommended Next Steps

1. **Immediate**: Create Rust unit tests for audio pipeline (encoding, decoding, mixing)
2. **Short term**: Set up manual testing with Tauri app on multiple machines
3. **Long term**: Automate audio quality tests with WebAudio API

## Test Artifacts

- Test plan: `docs/testing/audio-quality-test-plan.md` (this file)
- Signaling tests: `docs/testing/scripts/test-mesh-signaling.js` ✅
- WebRTC signaling tests: `docs/testing/scripts/test-webrtc-mesh.js` ✅

## Notes

- Audio pipeline: mic → cpal → mono downmix → ringbuffer → Opus encoder → RTP tracks → WebRTC → remote
- Remote: WebRTC track → RTP → Opus decoder → ringbuffer → mixer (sum + tanh soft clipping) → cpal output → speakers
- VU meters: RMS → dBFS → normalized [-60dB, 0dB] → [0,1] → EMA smoothing (α=0.3)
- ICE servers: Google STUN (stun.l.google.com:19302) + OpenRelay TURN (openrelay.metered.ca:80)
- Default Opus bitrate: 64kbps, VoIP mode, 20ms frames
- Reconnect: exponential backoff 1s → 30s max
- Topology: full mesh (N*(N-1)/2 connections)
