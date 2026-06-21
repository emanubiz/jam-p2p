# jam-p2p System Architecture

## Overview

jam-p2p is a real-time P2P audio jam application that enables musicians to collaborate over the internet with low-latency audio streaming. The application uses a hybrid desktop architecture: the Rust backend handles audio I/O, Opus codec, and WebRTC peer connections, while React provides the UI layer via Tauri v2.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     jam-gui (Frontend UI)                        │
│  React + Vite + Tauri v2                                         │
│  - App.tsx: Compositor for 6 extracted components + 1 custom hook               │
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
| `audio.rs` | cpal I/O, forced Opus-compatible sample rate (48/24/16/12/8 kHz), Opus encoder thread (bitrate clamp + dedup, VU throttle), real-time-safe mixer (`try_lock`), VU computation, 23 unit tests |
| `webrtc.rs` | PeerConnection creation, signal handler (single-offerer mesh), track management, ICE error logging, VU throttle |
| `signaling.rs` | WebSocket client, reconnect with exponential backoff that survives failed retries, shutdown-aware reader task |
| `state.rs` | Tauri state + 5 commands (join, leave, volume, bitrate, mute), English error messages |
| `messages.rs` | `SignalMessage` + `AppCommand` + `WsEvent` enums |
| `config.rs` | Constants (frame size, bitrate, EMA alpha, VU throttle, reconnect delays, ICE servers) |
| `logger.rs` | Tracing/logging initialization (stderr, env-filter) |

## Frontend Component Structure

```
App.tsx (compositor)
├── hooks/useTauriEvents.ts    — Manages 7 Tauri event listeners, returns { peers, localLevel, disconnected, reconnected, serverError, ... }
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
| Server → Client | `PeerList` | `{ peers: [{ uuid, name }] }` |
| Server → Client | `NewPeer` | `{ uuid, name }` |
| Server → Client | `PeerLeft` | `{ uuid }` |
| Server → Client | `Error` | `{ message }` (room full / limit reached) |
| Client → Server | `Join` | `{ room, name }` |
| Client → Server | `Leave` | — |
| Bidirectional | `Offer` | `{ target/from, sdp }` |
| Bidirectional | `Answer` | `{ target/from, sdp }` |
| Bidirectional | `Ice` | `{ target/from, candidate }` |

**Offer direction (glare avoidance):** for any pair of peers exactly one side
offers — the **joining** peer offers to everyone in its `PeerList`, and existing
peers answer when the offer arrives. `NewPeer` is purely informational: existing
peers do **not** offer back, otherwise both sides would offer simultaneously
(glare), each would drop the other's offer via the `contains_key` guard, and no
answer would ever be produced.

### HTTP API

| Endpoint | Method | Response |
|---|---|---|
| `/health` | GET | `{ status, rooms, peers, uptime }` |
| `/ice-servers` | GET | `{ iceServers: [...] }` |
| `/room/:name` | GET | `{ room, peerCount }` (no per-peer UUIDs — privacy) |

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
| `join_room` | `{ room, name, server }` | `Result<(), String>` | Guard: already connected → "Already connected to a room. Leave first." |
| `leave_room` | — | `Result<(), String>` | Idempotent — safe to call during auto-reconnect; force-clears `connected` flag |
| `set_volume` | `{ peer_id, vol }` | `Result<(), String>` | |
| `set_opus_bitrate` | `{ bitrate }` | `Result<(), String>` | Value in bits/s (UI converts kbps → bits/s); clamped 8–256 kbps in the encoder |
| `set_muted` | `{ muted }` | `Result<(), String>` | Save/restore volumes |

## Tauri Events

| Event | Payload | When |
|---|---|---|
| `peer-joined` | `{ id: string, name: string }` | PC state → Connected |
| `peer-left` | `string` (peer ID) | PC state → Disconnected OR PeerLeft signal |
| `peer-level` | `{ id: string, level: number }` | Decoded RTP (EMA smoothed, throttled ~15 Hz) |
| `local-level` | `{ level: number }` | Encoded frame (EMA smoothed, throttled ~15 Hz) |
| `connected` | — | (Re)connected to signaling server (after `Welcome`); flips `connected` flag back to true |
| `disconnected` | — | WebSocket connection dropped; resets `connected` flag so the next `join_room` is accepted |
| `server-error` | `string` | Server-side error (room full / limit reached) — shown in the UI error box |

## Technical Decisions

### WebRTC via Rust (not browser)
WebRTC peer connections are managed in the Rust backend via `webrtc-rs`, not in the browser. This provides lower latency, direct audio pipeline access via cpal, no browser sandbox limitations, and consistent behavior across platforms.

### RTP Tracks (not Data Channels)
Audio streams via RTP tracks using `TrackLocalStaticRTP`. RTP is designed for real-time media with built-in timing/sequencing, and integrates natively with the WebRTC media pipeline.

### Opus Codec
Opus in VoIP mode at 64 kbps default, 20ms frames. Opus is the standard for WebRTC audio, optimized for speech/music, with low latency and variable bitrate support. The UI slider is in **kbps** and is converted to **bits/s** before reaching the encoder; the encoder additionally clamps the value to a safe range (8–256 kbps).

### Sample Rate Selection
Opus only accepts 8/12/16/24/48 kHz. The default device config is often 44.1 kHz, which would make Opus init fail and silently produce no audio. `init_audio()` therefore inspects the f32 sample-rate ranges advertised by **both** the input and output devices and picks the highest Opus-valid rate common to both (preferring 48 kHz). The encoder, decoder, and both cpal streams all share that single rate, so there is no input/output mismatch (which would pitch-shift playback). If no common Opus rate exists, startup fails loudly instead of running broken.

### Full Mesh Topology
Every peer connects to every other peer. Simplest topology with the lowest latency (direct P2P). Suitable for small groups (2–6 peers).

### Soft Clipping (tanh)
The mixer uses `tanh()` for soft clipping instead of hard clipping. This prevents harsh distortion when multiple audio streams are summed, producing warmer sound.

### Real-Time-Safe Mixing
The cpal output callback runs on a real-time audio thread and must never block. It acquires the per-peer mixer map with `try_lock()` (not `lock()`); if the map is momentarily held elsewhere it outputs the already-zero-filled silence for that callback rather than stalling and causing an xrun. The encoder thread no longer touches that mutex at all — it fills frames straight from the mic ring buffer — which removes the lock contention that previously starved playback.

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

**Last Updated**: 2026-06-21
**Status**: CI/CD active (`.github/workflows/build.yml`), documentation aligned with code (peer-joined payload, 7 Tauri event listeners, 30+6 tests, /room/:name peerCount-only), `mpsc::channel(N)` bounded channels pending (see ROADMAP).

> **2026-06-18 — critical-fix pass:** forced Opus-compatible sample rate (no more silent no-audio on 44.1 kHz devices), bitrate slider kbps→bits/s conversion + encoder clamp, single-offerer mesh (glare fix), reconnect loop that survives failed retries, and a real-time-safe (`try_lock`) mixer. Remaining audit items (signaling auth, WSS, per-room peer caps, room enumeration via CORS) are tracked in `ROADMAP.md`.

> **2026-06-21 — CI/CD + alignment pass:** added `.github/workflows/build.yml` (vitest + cargo test + signaling smoke + cross-platform Tauri build matrix + GitHub Release on tag), aligned README/ROADMAP/system-overview with code reality (peer-joined payload object, 7 Tauri event listeners including `connected`/`reconnected`/`server-error`, 30 Rust + 6 frontend tests, /room/:name returns `{room, peerCount}` only).
