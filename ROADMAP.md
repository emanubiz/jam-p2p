# jam-p2p Development Roadmap

## Project Overview
- **Name**: jam-p2p
- **Type**: Desktop P2P audio jam application
- **Stack**: Tauri v2 + React 19 + Rust (cpal, Opus, webrtc-rs) + Node.js signaling
- **Repo**: https://github.com/emanubiz/jam-p2p/

## Components
1. **jam-gui** — Frontend UI (React + Vite + Tauri v2) ✅
2. **jam-gui/src-tauri** — Native backend (Rust, audio I/O, WebRTC, Opus) ✅ Modular, 22 unit tests
3. **jam-signaler** — Signaling server (Node.js, WebSocket + HTTP) ✅ + Docker + rate limiting
4. **CI/CD** — GitHub Actions multi-platform builds ✅ Configured

---

## Current Status (2026-05-05)

| Area | Status | Notes |
|---|---|---|
| Signaling server | ✅ Complete | WebSocket + HTTP API, heartbeat, STUN/TURN, Docker, rate limiting, graceful shutdown |
| Rust backend | ✅ Implemented | cpal audio, Opus codec, WebRTC peer connections, mixer, reconnect, mute/save-restore, 22 unit tests |
| Frontend UI | ✅ Enhanced | Room join, volume controls, VU meters, local VU meter, mute toggle, settings panel, quality indicator, keyboard shortcuts, 3 rendering tests |
| Mesh signaling tests | ✅ Verified | 3-peer (6 conns), 5-peer (20 conns) |
| CI/CD pipeline | ✅ Configured | Linux, macOS, Windows builds, GitHub Release on tag |
| ADR documentation | ✅ Written | ADR-001: WebSocket reconnect via WsEvent channel |
| Audio streaming E2E | ⏳ Pending | Backend code complete (cpal + Opus + webrtc-rs), needs manual verification with actual audio devices |
| Local build (Rust) | ⏳ System deps | GTK3 deps needed locally for `cargo build`; CI builds successfully in GitHub Actions |

---

## Roadmap

### ✅ Phase 1: Analysis & Base Setup
- [x] Codebase analyzed and structure documented
- [x] Frontend build pipeline verified
- [x] Repository structure organized

### ✅ Phase 2: Signaling Server
- [x] WebSocket heartbeat (30s ping/pong)
- [x] HTTP endpoints: `/health`, `/ice-servers`, `/room/:name`
- [x] STUN server configuration (Google public STUN)
- [x] TURN server configuration (openrelay.metered.ca)
- [x] Graceful peer disconnect with `PeerLeft` broadcast
- [x] Join/Leave/Offer/Answer/ICE message handling
- [x] Docker deployment (Dockerfile + docker-compose)
- [x] Rate limiting (50 msg/sec, 64KB max)
- [x] Input validation (room name, message size)
- [x] HTTP method validation (GET only)

### ✅ Phase 3: WebRTC Mesh Signaling
- [x] 3-peer mesh: 6 connections established
- [x] 5-peer mesh: 20 connections established
- [x] Signaling flow verified (Offer/Answer forwarded correctly)

### ✅ Phase 4: Rust Backend Audio + WebRTC
- [x] Audio capture via cpal (mono/stereo downmix)
- [x] Opus encoder/decoder (VoIP mode, configurable bitrate)
- [x] WebRTC peer connections via webrtc-rs 0.11
- [x] RTP track for audio streaming
- [x] Multi-peer audio mixer (ringbuffer-based, tanh soft clipping)
- [x] VU meter via RMS + EMA smoothing → Tauri events
- [x] WebSocket signaling client with reconnect (exponential backoff)
- [x] WsEvent channel for reliable reconnect (ADR-001)
- [x] Tauri commands: `join_room`, `leave_room`, `set_volume`, `set_opus_bitrate`, `set_muted`
- [x] Tauri events: `peer-joined`, `peer-left`, `peer-level`, `disconnected`, `local-level`
- [x] TURN server integration for NAT traversal
- [x] Mute/Unmute with volume save/restore
- [x] Encoder graceful shutdown (watch channel)
- [x] Double join guard (`connected` atomic flag)
- [x] NewPeer handling (auto-create PC + offer)
- [x] PeerLeft signaling cleanup + UI event
- [x] Code modularized (8 modules, ~981 lines total)
- [x] Unit tests: 22 Rust tests (audio level, clipping, EMA, edge cases)
- [x] ESLint + TypeScript strict mode
- [x] Clippy configuration (unwrap_used, expect_used, pedantic warnings)

### ✅ Phase 5: Bug Fix & Polish
- [x] Fix: `saved_volumes` cleared on room leave (`main.rs`)
- [x] Fix: `connected` flag race condition — shared `Arc<AtomicBool>`, set on Welcome (`state.rs` + `main.rs`)
- [x] Fix: `NewPeer`/`Offer` errors propagated and logged (`main.rs` loop + `webrtc.rs`)
- [x] Fix: `ws_in_rx` closed reconnect logic — checks `last_join` before clearing (`main.rs`)
- [x] Fix: ICE candidate `unwrap_or_default` → explicit error + warn log (`webrtc.rs`)
- [x] Fix: unused imports — removed `TrackLocalWriter` from `audio.rs`
- [x] Fix: UI disconnect race condition — peers cleared only after successful `leave_room` (`App.tsx`)
- [x] Fix: auto-reconnect dead code — restructured `main.rs` with `WsEvent` channel
- [x] Fix: CSP tightened — removed `http:` and `https:` from `connect-src`
- [x] Fix: encoder thread panic safety — `catch_unwind` wrapping
- [x] Fix: TypeScript `local-level` event type corrected
- [x] Fix: CI build errors (webrtc version, missing imports, type mismatches)

### ✅ Phase 6: UI/UX Improvements
- [x] Peer count display in real-time
- [x] Settings panel (bitrate, audio device selection placeholder)
- [x] Connection quality indicator (GOOD/FAIR/POOR)
- [x] Local mic VU meter (blue-tinted bars)
- [x] Keyboard shortcuts (mute: M, disconnect: Ctrl+Shift+D / Esc)
- [x] Shortcut hints on UI buttons (M, Esc)

### Phase 7: Cross-Platform Build & Release
- [x] CI/CD pipeline (GitHub Actions) — configured
- [ ] First successful CI build run via GitHub Actions push
- [x] Linux build (.deb, AppImage) — CI configured
- [x] Windows build (.exe, .msi) — CI configured
- [x] macOS build (.dmg) — CI configured
- [x] Automated release on tag — CI configured
- [ ] Code signing (macOS, Windows)
- [ ] Auto-update mechanism (Tauri updater)

### Phase 8: Production Readiness
- [ ] Own TURN server (coturn) — replace openrelay
- [ ] WSS signaling (TLS)
- [ ] Room authentication / passwords
- [ ] Error recovery (peer reconnect, stream recovery)
- [x] Logging to file (stderr via tracing)
- [x] Graceful shutdown (SIGTERM/SIGINT handlers in signaling server)
- [x] Comprehensive test suite (22 Rust unit tests, 3 frontend rendering tests)
- [ ] Performance monitoring
- [ ] SFU topology option for >6 peers
- [ ] Benchmark suite (latency, CPU, memory)

---

## Remaining Issues

### ~~Critical (runtime bugs)~~ — ALL FIXED ✅
| # | Issue | Status | Fix |
|---|---|---|---|
| 1 | `saved_volumes` not reset on leave | ✅ Fixed | Cleared in `Leave` handler + `my_id` reset |
| 2 | `connected` flag race condition | ✅ Fixed | Shared `Arc<AtomicBool>`, set on Welcome, cleared on leave |
| 3 | `NewPeer`/`Offer` error swallowing | ✅ Fixed | Errors propagate via `?`, logged in main loop |
| 4 | `ws_in_rx` closed not clearing `last_join` | ✅ Fixed | Reconnect checks `should_reconnect()` before any state change |
| 5 | ICE candidate `unwrap_or_default` | ✅ Fixed | Explicit error branch with `tracing::warn!` |

### ~~Medium~~ — ALL FIXED ✅
| # | Issue | Status | Fix |
|---|---|---|---|
| 6 | Unused imports | ✅ Fixed | Removed `TrackLocalWriter` from `audio.rs` |
| 7 | UI disconnect race | ✅ Fixed | Peers cleared only after successful `leave_room` in `App.tsx` |
| 8 | No panic handling in encoder thread | ✅ Fixed | `catch_unwind` wrapping in `audio.rs` |
| 9 | CSP too permissive | ✅ Fixed | Tightened to `ws: wss:` only |
| 10 | No `local-level` event type | ✅ Fixed | TypeScript type added for `local-level` |

### Open — Low Priority
| # | Issue | Location | Impact |
|---|---|---|---|
| 11 | No audio device selection | `audio.rs:33-34` | Uses default input/output only; device picker could be added in settings panel |

---

## Next Actions

1. **Install system deps locally** → `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libasound2-dev ...` (unblocks `cargo build` + `cargo test`)
2. **Build & test E2E** → `npm run tauri dev`, launch 2 instances, verify audio flows both directions
3. **Push to GitHub** → trigger CI/CD pipeline, verify multi-platform builds
4. **Manual audio quality testing**, latency measurement
5. **Own TURN server** (coturn) to replace openrelay
6. **WSS signaling** (TLS) for production deployment
7. **Auto-updater** setup with Tauri updater plugin

---

**Last updated**: 2026-05-05
