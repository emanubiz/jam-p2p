# jam-p2p Development Roadmap

## Project Overview

- **Name**: jam-p2p
- **Type**: Desktop P2P audio jam application for musicians
- **Stack**: Tauri v2 + React + Rust (cpal, Opus, webrtc-rs) + Node.js signaling
- **Repo**: https://github.com/emanubiz/jam-p2p/

## Current Status (2026-06-18)

| Area | Status | Notes |
|---|---|---|
| Signaling server | ✅ Complete | WebSocket + HTTP API, heartbeat, STUN/TURN, Docker, rate limiting (WS + HTTP), message validation, graceful shutdown |
| Rust backend | ✅ Complete | cpal audio (forced Opus sample rate), Opus codec, WebRTC single-offerer mesh, RT-safe mixer, fault-tolerant reconnect, mute/save-restore, graceful shutdown, VU throttle, bitrate clamp+dedup, 23 unit tests |
| Frontend UI | ✅ Refactored | Component-based architecture (7 components + hook), volume controls, VU meters, settings panel, keyboard shortcuts, 5 rendering tests |
| Mesh signaling tests | ✅ Verified | 3-peer (6 conns), 5-peer (20 conns) |
| CI/CD pipeline | ✅ Configured | Linux, macOS (Intel + ARM), Windows builds, GitHub Release on tag |
| ADR documentation | ✅ Written | ADR-001: WsEvent reconnect mechanism |
| Audio streaming E2E | ⏳ To test | Backend code complete, needs manual verification |
| Local build (Rust) | ⏳ System deps | GTK3 deps needed locally; CI builds successfully |

## Completed Phases

### ✅ Phase 1: Analysis & Base Setup
- [x] Codebase analyzed and structure documented
- [x] Frontend build pipeline verified
- [x] Repository structure organized

### ✅ Phase 2: Signaling Server
- [x] WebSocket heartbeat (30s ping/pong)
- [x] HTTP endpoints: `/health`, `/ice-servers`, `/room/:name`
- [x] STUN server configuration (Google public STUN)
- [x] TURN server configuration (openrelay.metered.ca)
- [x] Graceful peer disconnect with PeerLeft broadcast
- [x] Join/Leave/Offer/Answer/Ice message handling
- [x] Docker deployment (Dockerfile + docker-compose)
- [x] Rate limiting (50 msg/sec WS, 100 req/sec HTTP, 64KB max)
- [x] Message structure validation (all 6 message types)
- [x] Input validation (room name length, message size)
- [x] HTTP method validation (GET only)
- [x] Extracted `removePeerFromRoom()` helper (deduplicated Leave/close handlers)
- [x] Graceful shutdown (SIGTERM/SIGINT)

### ✅ Phase 3: WebRTC Mesh Signaling
- [x] 3-peer mesh: 6 connections established
- [x] 5-peer mesh: 20 connections established
- [x] Signaling flow verified (Offer/Answer forwarded correctly)

### ✅ Phase 4: Rust Backend Audio + WebRTC
- [x] Audio capture via cpal (mono/stereo downmix)
- [x] Opus encoder/decoder (VoIP mode, configurable bitrate)
- [x] WebRTC peer connections via webrtc-rs
- [x] RTP track for audio streaming
- [x] Multi-peer audio mixer (ringbuffer-based, tanh soft clipping)
- [x] VU meter via RMS + EMA smoothing → Tauri events
- [x] WebSocket signaling client with reconnect (exponential backoff)
- [x] Tauri commands: join_room, leave_room, set_volume, set_opus_bitrate, set_muted
- [x] Tauri events: peer-joined, peer-left, peer-level, local-level, disconnected
- [x] TURN server integration for NAT traversal
- [x] Mute/Unmute with volume save/restore
- [x] Encoder graceful shutdown (watch channel)
- [x] Double join guard (`connected` AtomicBool)
- [x] NewPeer handling (informational; existing peers answer the newcomer's offer)
- [x] PeerLeft signaling (cleanup + UI event)
- [x] Code modularized (8 modules)
- [x] Unit tests (23 tests: audio level computation + Opus sample-rate selection)
- [x] ESLint + TypeScript strict mode
- [x] Clippy configuration

### ✅ Phase 5: Bug Fix & Polish
- [x] Fix: `saved_volumes` cleared on room leave
- [x] Fix: `connected` flag race condition — shared `Arc<AtomicBool>`
- [x] Fix: `NewPeer`/`Offer` errors propagated and logged
- [x] Fix: `ws_in_rx` closed reconnect logic
- [x] Fix: ICE candidate error handling — explicit `tracing::warn!`
- [x] Fix: unused imports removed
- [x] Fix: UI disconnect race condition
- [x] Fix: encoder thread panic handling (`catch_unwind`)
- [x] Fix: CSP tightened

### ✅ Phase 6: UI/UX Improvements
- [x] Peer count display in real-time
- [x] Room badge with name and participant count
- [x] Settings panel (bitrate slider, 16–192 kbps)
- [x] Connection quality badge
- [x] Local mic VU meter
- [x] Keyboard shortcuts (M=mute, Esc=disconnect, Ctrl+Shift+D)
- [x] Component decomposition (7 components + custom hook)
- [x] `React.memo` on peer-facing components
- [x] Optimistic volume slider updates
- [x] Waiting-for-peers pulse animation
- [x] View transition animations (fadeIn, slideUp)
- [x] CSS duplicate keyframes removed

### ✅ Phase 7: Performance & Reliability
- [x] VU meter event throttling (50 Hz → ~15 Hz)
- [x] Opus bitrate set only on change (was every 20ms frame)
- [x] ICE candidate error logging (was silently discarded)
- [x] `close_all` emits `peer-left` for each peer (UI cleanup)
- [x] Graceful backend shutdown (watch channel → encoder + signaling + peers)
- [x] WS reader task with shutdown-aware `tokio::select!`
- [x] Italian error messages → English
- [x] HTTP rate limiting (100 req/sec per IP)

### ✅ Phase 7.5: Critical Audit Fixes (2026-06-18)
- [x] **Audio**: force an Opus-compatible sample rate (8/12/16/24/48 kHz) shared by both devices — previously the device default (often 44.1 kHz) made Opus init fail and produced *silent* no-audio while the UI showed "connected"
- [x] **Audio**: bitrate slider now converts kbps → bits/s and the encoder clamps to 8–256 kbps — previously moving the slider sent e.g. `64` bits/s and collapsed quality
- [x] **WebRTC**: single-offerer mesh — only the joining peer offers (existing peers answer on `NewPeer`/`Offer`); removes the double-offer glare that left connections stuck with no answer
- [x] **Reconnect**: `connect()` re-emits `WsEvent::Disconnected` on a failed *reconnect* so exponential backoff keeps retrying instead of giving up after one failed attempt (see ADR-001 amendment)
- [x] **Real-time audio**: output callback uses `try_lock` (never blocks the RT thread); encoder no longer locks the shared mixer mutex, removing playback-starving contention
- [x] **Tests**: 5 new unit tests for Opus sample-rate selection (`pick_common_opus_rate`)

## Remaining Work

### Phase 8: Cross-Platform Build & Release
- [ ] First successful CI build run (needs GitHub repo push)
- [ ] Linux build (.deb, AppImage) — CI configured
- [ ] Windows build (.exe, .msi) — CI configured
- [ ] macOS build (.dmg) — CI configured
- [ ] Automated release on tag — CI configured
- [ ] Code signing (macOS, Windows)
- [ ] Auto-update mechanism (Tauri updater)

### Phase 9: Production Readiness
- [ ] Own TURN server (coturn) — replace openrelay
- [ ] WSS signaling (TLS)
- [ ] Room authentication / passwords
- [ ] Error recovery (peer reconnect, stream recovery)
- [ ] Audio device selection (input/output picker)
- [ ] Performance monitoring
- [ ] SFU topology option for >6 peers
- [ ] Benchmark suite (latency, CPU, memory)

### Phase 9.1: Remaining Audit Items (from 2026-06-18 review)
> Identified during the critical-fix audit but **not yet fixed** — tracked here.
- [ ] **Security**: `GET /room/:name` + `Access-Control-Allow-Origin: *` let any website enumerate room peer UUIDs → restrict CORS and/or gate room info behind auth
- [ ] **Security**: signaling has no authentication — anyone can join any room (eavesdrop/inject); pairs with WSS + room passwords above
- [ ] **Reliability**: `backend.connected` is never reset to `false` on WS drop → after a failed reconnect the UI is stuck "disconnected" and manual rejoin is rejected with "Already connected"
- [ ] **Signaling**: re-`Join` without `Leave` leaks the previous room membership (ghost peer until heartbeat) — remove peer from its old room on a new Join
- [ ] **DoS**: no cap on peers-per-room or total rooms → unbounded memory; add limits
- [ ] **Cleanup**: server-provided `iceServers` (in `Welcome`) are ignored by the Rust client, which hardcodes them in `config.rs` — wire one source of truth
- [ ] **Cleanup**: `name` is plumbed through `Join` but the server ignores it and the UI hardcodes `"user"` — add a name input or drop the field

## Next Actions

1. **Push to GitHub** → trigger CI/CD pipeline, verify multi-platform builds
2. **E2E audio test** → `npm run tauri dev` with 2+ instances, verify audio streaming
3. **Manual latency measurement** → measure round-trip audio latency
4. **Own TURN server** (coturn) to replace openrelay for production
5. **WSS signaling** (TLS) for production deployment
6. **Room authentication** — password-protected rooms

---

**Last updated**: 2026-06-18
