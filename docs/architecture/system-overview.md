# jam-p2p System Architecture

## Overview

jam-p2p is a real-time P2P audio jam application that enables musicians to collaborate over the internet with low-latency audio streaming. The application uses a hybrid desktop architecture: the Rust backend handles audio I/O, Opus codec, and WebRTC peer connections, while React provides the UI layer via Tauri v2.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     jam-gui (Frontend UI)                        │
│  React + Vite + Tauri v2                                         │
│  - App.tsx: Compositor for 7 extracted components               │
│  - useTauriEvents(): Custom hook for all Tauri event listeners  │
│  - ConnectionForm, PeerCard, VuMeter, SettingsPanel, etc.       │
│  - Tauri Commands → Rust backend (join, leave, volume, mute)    │
│  - Tauri Events ← Rust backend (peer-joined, peer-level, etc.)  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Tauri IPC (commands + events)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  src-tauri (Rust Backend)                        │
│  cpal + Opus + webrtc-rs + tokio-tungstenite                    │
│  - Audio capture (cpal) → mono downmix → ringbuffer              │
│  - Opus encoder → RTP packets → WebRTC tracks                   │
│  - WebRTC peer connections (full mesh)                          │
│  - Opus decoder ← RTP packets ← remote tracks                   │
│  - Audio mixer (ringbuffer per peer, tanh soft clipping)        │
│  - Output playback (cpal)                                        │
│  - WebSocket signaling client with reconnect                    │
│  - Graceful shutdown via watch channel                          │
│  - VU meter events throttled to ~15 Hz                          │
│  - Bitrate changes applied only when value differs              │
└───────────────────────────────┬─────────────────────────────────┘
                                │ WebSocket (ws://localhost:8080)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    jam-signaler (Signaling)                      │
│  Node.js + ws + pino                                             │
│  - Message routing (Join/Leave/Offer/Answer/ICE)                │
│  - Message structure validation (all 6 types)                   │
│  - Room management                                               │
│  - STUN/TURN server configuration                               │
│  - 30s heartbeat ping/pong                                       │
│  - WS rate limiting (50 msg/sec, 64KB max)                      │
│  - HTTP rate limiting (100 req/sec per IP)                      │
│  - HTTP API: /health, /ice-servers, /room/:name                  │
│  - Graceful shutdown (SIGTERM/SIGINT)                            │
└───────────────────────────────┬─────────────────────────────────┘
                                │ WebRTC (STUN/TURN + direct P2P)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    P2P Audio Mesh (WebRTC)                       │
│  - Full mesh topology: N*(N-1)/2 connections                    │
│  - STUN: stun.l.google.com:19302                                │
│  - TURN: openrelay.metered.ca:80 (openrelayproject)             │
│  - Audio via RTP tracks (Opus), not data channels               │
└─────────────────────────────────────────────────────────────────┘
```

## Rust Module Structure

| Module | Responsibility |
|---|---|
| `main.rs` | Entry point, Tauri setup, backend event loop with graceful shutdown |
| `audio.rs` | cpal I/O, Opus encoder thread (bitrate dedup, VU throttle), mixer, VU computation, 18 unit tests |
| `webrtc.rs` | PeerConnection creation, signal handler, track management, ICE error logging, VU throttle |
| `signaling.rs` | WebSocket client, reconnect with exponential backoff, shutdown-aware reader task |
| `state.rs` | Tauri state + 5 commands (join, leave, volume, bitrate, mute), English error messages |
| `messages.rs` | `SignalMessage` + `AppCommand` + `WsEvent` enums |
| `config.rs` | Constants (frame size, bitrate, EMA alpha, VU throttle, reconnect delays, ICE servers) |
| `logger.rs` | Tracing/logging initialization (stderr, env-filter) |

## Frontend Component Structure

```
App.tsx (compositor)
├── hooks/useTauriEvents.ts    — Manages 5 Tauri event listeners, returns { peers, localLevel, disconnected, ... }
├── components/ConnectionForm.tsx — Server + room inputs, connect button (React.memo)
├── components/StatusBar.tsx      — Status dot + text + quality badge (React.memo)
├── components/SettingsPanel.tsx  — Bitrate slider, collapsible (React.memo)
├── components/LocalMicCard.tsx   — Local mic VU meter (React.memo)
├── components/PeerCard.tsx        — Per-peer: name, volume slider, VU meter (React.memo)
│   └── components/VuMeter.tsx     — 20-bar LED-style level meter (React.memo)
```

## Graceful Shutdown Flow

```
Tauri window closes
        │
        ▼
main() sends shutdown_tx.send(true)
        │
        ▼
run_backend() select! receives shutdown signal
        │
        ├──► sig_client.leave()        — Send Leave to signaling server, close WS
        ├──► peer_manager.close_all()  — Close all PeerConnections, emit peer-left
        ├──► encoder_handle.shutdown() — Signal encoder thread via watch channel
        └──► mixer_sources.clear()     — Clear mixer state
        │
        ▼
Backend thread exits
```

The WS reader task also respects the shutdown signal via its own `tokio::select!` with `biased` priority, ensuring clean WebSocket teardown.

## Signaling Protocol

### WebSocket Messages

| Direction | Type | Payload |
|---|---|---|
| Server → Client | `Welcome` | `{ uuid, iceServers }` |
| Server → Client | `PeerList` | `{ peers: string[] }` |
| Server → Client | `NewPeer` | `{ uuid }` |
| Server → Client | `PeerLeft` | `{ uuid }` |
| Client → Server | `Join` | `{ room, name }` |
| Client → Server | `Leave` | — |
| Bidirectional | `Offer` | `{ target/from, sdp }` |
| Bidirectional | `Answer` | `{ target/from, sdp }` |
| Bidirectional | `Ice` | `{ target/from, candidate }` |

### HTTP API

| Endpoint | Method | Response |
|---|---|---|
| `/health` | GET | `{ status, rooms, peers, uptime }` |
| `/ice-servers` | GET | `{ iceServers: [...] }` |
| `/room/:name` | GET | `{ room, peerCount, peers: [...] }` |

## Audio Pipeline

```
Microphone ──► cpal input stream ──► mono downmix ──► ringbuffer (mic)
                                                          │
                                                   Opus encoder (20ms)
                                                          │
                                              RTP packets via WebRTC track
                                                          │
                                                   Remote peer receives

Remote track ──► RTP packets ──► Opus decoder ──► PCM samples
                                                        │
                                                ringbuffer (per peer)
                                                        │
                                                  Mixer (sum + tanh)
                                                        │
                                              cpal output stream ──► Speakers
```

### VU Meter Computation

```
PCM samples ──► RMS ──► 20 * log10(RMS) ──► normalize [-60dB, 0dB] → [0,1]
                                                      │
                                              EMA smoothing (α = 0.3)
                                                      │
                                              Throttle to ~15 Hz
                                                      │
                                              emit Tauri event
```

## Tauri Commands

| Command | Params | Returns | Notes |
|---|---|---|---|
| `join_room` | `{ room, name, server }` | `Result<(), String>` | Guard: already connected → error |
| `leave_room` | — | `Result<(), String>` | Guard: not connected → error |
| `set_volume` | `{ peer_id, vol }` | `Result<(), String>` | |
| `set_opus_bitrate` | `{ bitrate }` | `Result<(), String>` | |
| `set_muted` | `{ muted }` | `Result<(), String>` | Save/restore volumes |

## Tauri Events

| Event | Payload | When |
|---|---|---|
| `peer-joined` | `string` (peer ID) | PC state → Connected |
| `peer-left` | `string` (peer ID) | PC state → Disconnected OR PeerLeft signal |
| `peer-level` | `{ id: string, level: number }` | Decoded RTP (EMA smoothed, throttled ~15 Hz) |
| `local-level` | `{ level: number }` | Encoded frame (EMA smoothed, throttled ~15 Hz) |
| `disconnected` | — | WebSocket connection dropped |

## Technical Decisions

### WebRTC via Rust (not browser)
WebRTC peer connections are managed in the Rust backend via `webrtc-rs`, not in the browser. This provides lower latency, direct audio pipeline access via cpal, no browser sandbox limitations, and consistent behavior across platforms.

### RTP Tracks (not Data Channels)
Audio streams via RTP tracks using `TrackLocalStaticRTP`. RTP is designed for real-time media with built-in timing/sequencing, and integrates natively with the WebRTC media pipeline.

### Opus Codec
Opus in VoIP mode at 64 kbps default, 20ms frames. Opus is the standard for WebRTC audio, optimized for speech/music, with low latency and variable bitrate support.

### Full Mesh Topology
Every peer connects to every other peer. Simplest topology with the lowest latency (direct P2P). Suitable for small groups (2–6 peers).

### Soft Clipping (tanh)
The mixer uses `tanh()` for soft clipping instead of hard clipping. This prevents harsh distortion when multiple audio streams are summed, producing warmer sound.

### Graceful Shutdown via Watch Channel
A `tokio::sync::watch` channel signals shutdown from the main thread to the backend event loop and WS reader tasks. This ensures clean teardown of the encoder, peer connections, and signaling client.

### VU Meter Throttling
VU meter events are throttled to ~15 Hz (67ms intervals) to reduce Tauri IPC overhead without perceptible visual impact. CSS transitions handle the visual smoothing.

## Performance

### Mesh Scalability
- 2 peers: 1 connection
- 3 peers: 3 connections
- 5 peers: 10 connections
- N peers: N*(N-1)/2 connections

Full mesh becomes impractical above ~6–8 peers due to O(N²) bandwidth, CPU, and memory requirements.

### Latency Budget
- Audio capture buffer: 10–20ms
- Opus encoding: 20ms (frame size)
- Network RTT: 20–100ms (depending on distance)
- Opus decoding: < 1ms
- Mixer/output buffer: 10–20ms
- **Total**: ~60–160ms (acceptable for jam sessions)

## Security Considerations

- WebRTC encryption mandatory (DTLS-SRTP)
- Signaling server: rate limiting (WS + HTTP), message validation, room name validation
- CSP: `default-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline';`
- **Not yet implemented**: room authentication, WSS signaling (TLS), own TURN server

## CI/CD Pipeline

**Workflow**: `.github/workflows/build.yml`

**Triggers**: push to `main`, pull requests, tags `v*`, manual dispatch

**Platforms**:
- Linux (ubuntu-latest) → AppImage + .deb
- macOS Intel (macos-latest) → .dmg + .app
- macOS Apple Silicon (macos-latest) → .dmg + .app
- Windows (windows-latest) → .msi + .exe

**Release**: On `v*` tag, creates GitHub Release with all artifacts.

---

**Last Updated**: 2026-06-16
**Status**: Backend and frontend complete, ready for E2E testing and production hardening
