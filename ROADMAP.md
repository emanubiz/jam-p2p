# jam-p2p Development Roadmap

## Project Overview

- **Name**: jam-p2p
- **Type**: Desktop P2P audio jam application for musicians
- **Stack**: Tauri v2 + React + Rust (cpal, Opus, webrtc-rs) + Node.js signaling
- **Repo**: https://github.com/emanubiz/jam-p2p/

## Current Status (2026-06-21)

| Area | Status | Notes |
|---|---|---|
| Signaling server | ✅ Complete | WebSocket + HTTP API, heartbeat, STUN/TURN, Docker, rate limiting (WS per-conn + per-IP connect + HTTP), message validation, graceful shutdown, DoS caps (peers/room, rooms), CORS env, name propagation, Error envelope, re-join leak fix. Split into `lib/` modules (`validation`, `rate-limit`, `rooms`) with **43 Jest unit tests** |
| Rust backend | ✅ Complete | cpal audio (forced Opus sample rate), Opus codec, WebRTC single-offerer mesh, RT-safe mixer (`parking_lot::Mutex`), bounded `mpsc::channel(N)`, `BytesMut` encoder pool, fault-tolerant reconnect, mute/save-restore, graceful shutdown, VU throttle, bitrate clamp+dedup, ICE servers sourced from Welcome, dead deps removed, 30 unit tests (23 audio + 7 serde wire protocol) |
| Frontend UI | ✅ Refactored | Component-based architecture (7 components + 2 hooks + per-component CSS), volume controls (debounced), VU meters, settings panel, **session analytics panel**, keyboard shortcuts, display name input, auto-reconnect with Cancel, server-error surfacing, **24 Vitest tests** (rendering + interaction + analytics) |
| Tooling | ✅ Fixed | ESLint migrated to v9 flat config (`eslint.config.mjs`) — the legacy `.eslintrc.json` would have failed the CI lint step |
| Mesh signaling tests | ✅ Verified | 3-peer (6 conns), 5-peer (20 conns) |
| CI/CD pipeline | ✅ Active | `.github/workflows/build.yml`: vitest + lint + cargo test/fmt/clippy/audit + signaling smoke + Linux/macOS(Intel+ARM)/Windows build matrix + GitHub Release on tag `v*` |
| ADR documentation | ✅ Written | ADR-001: WsEvent reconnect mechanism |
| Audio streaming E2E | ⏳ To test | Backend code complete; manual procedure written (`docs/testing/E2E-AUDIO-PROCEDURE.md`), execution pending |
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
- [~] Performance monitoring — basic per-session analytics shipped (`AnalyticsPanel`); live WebRTC `getStats()` (packet loss, jitter, RTT) still pending
- [ ] SFU topology option for >6 peers
- [ ] Benchmark suite (latency, CPU, memory)

### ✅ Phase 7.6: Audit Phase 2 — Completed (2026-06-18)
> All remaining audit items from the 2026-06-18 review are now fixed.
- [x] **Signal DoS caps**: `MAX_PEERS_PER_ROOM=8`, `MAX_ROOMS=500`, `MAX_NAME_LENGTH=32` — all env-configurable (`MAX_PEERS_PER_ROOM`, `MAX_ROOMS`)
- [x] **CORS lockdown**: `ALLOWED_ORIGIN` env var replaces the hardcoded `*` (defaults to `*` for local dev)
- [x] **Peer info leak closed**: `GET /room/:name` now returns only an aggregate `peerCount`; per-peer UUIDs are no longer enumerable cross-origin
- [x] **ICE single source of truth**: server's `Welcome.iceServers` overrides the Rust config defaults when present
- [x] **Server ICE urls are arrays**: always emitted as `urls: []` matching `webrtc-rs::RTCIceServer`
- [x] **Display name end-to-end**: ConnectionForm has a `Display Name` input (max 32 chars); `Join` sends `name.trim() || "Anonymous"`; server stores `displayName` and propagates it through `PeerList` (`[{uuid,name}]`) and `NewPeer` (`{uuid,name}`); UI labels each peer by name and falls back to `Musician <4-char-uuid>` when empty
- [x] **Re-Join leak fixed**: server calls `removePeerFromRoom` on a room change during Join, eliminating ghost peers after a swap
- [x] **`backend.connected` reset on disconnect**: `WsEvent::Disconnected` flips `backend.connected = false`, so manual rejoin after a permanently failed reconnect is accepted (was rejected with "Already connected")
- [x] **Idempotent `leave_room`**: removed the `!connected` guard so Cancel during auto-reconnect always succeeds; the flag is force-cleared even on backend error
- [x] **Reconnecting UI**: `StatusBar` has a `reconnecting` state; App.tsx renders a panel with spinner, `Reconnecting to <room>…`, and a Cancel button
- [x] **Server Error envelope**: new `Error { message }` variant flows from server (room full/limit reached) → `webrtc.rs` → `server-error` Tauri event → UI `error` state
- [x] **CI compile fixes**: `main.rs` loop returns `Result<()>`; `audio.rs` imports `TrackLocalWriter` so macOS/Windows/Linux build matrix can compile
- [x] **Tests**: 7 new Rust serde round-trip tests for the wire protocol; `App.test.tsx` adds Display Name label + `fireEvent.change` test
- [x] **Code quality**: shared `AppStatus` union across `App.tsx`/`ConnectionForm.tsx`; `PeerManager.names` cleaned on `PeerLeft`

> **Deferred to a future round** (still in Phase 9): signaling WSS, room authentication, own TURN server. These are deployment concerns, not block-level correctness.

### ✅ Phase 8: Compendium Hardening — Completed (2026-06-21)
> Implementation of the unified cross-analysis plan (`ANALISI_UNIFICATA.md`). Every
> item below maps to a P0–P3 priority from that document.
- [x] **P0.1 — CI/CD**: `.github/workflows/build.yml` created (vitest + lint + cargo test/fmt/clippy/audit + signaling smoke + 4-target Tauri build matrix + tagged GitHub Release)
- [x] **P0.2 — E2E audio**: manual verification procedure documented (`docs/testing/E2E-AUDIO-PROCEDURE.md`) — execution still pending hardware
- [x] **P0.3 — Doc alignment**: README/ROADMAP/system-overview reconciled with code (Tauri events, `peer-joined` object, `/room/:name`, test counts)
- [x] **P1.1 — Dead deps removed**: `url`, `uuid`, `once_cell`, `rand` dropped from `Cargo.toml`
- [x] **P1.2 — Repo hygiene**: `test_standalone/target/` untracked from git
- [x] **P1.3 — `.env.example`** completed (`MAX_PEERS_PER_ROOM`, `MAX_ROOMS`, `ALLOWED_ORIGIN`, `WS_CONNECT_LIMIT_PER_IP`)
- [x] **P1.4 — Italian comments** translated to English (`Dockerfile`, `logger.rs`)
- [x] **P1.5 — Bounded channels**: `mpsc::channel(256/64)` replaces `unbounded_channel` (backpressure)
- [x] **P2.1 — Signaling modularization**: `server.js` → `lib/{validation,rate-limit,rooms}.js`
- [x] **P2.5 — Frontend interaction tests**: 6 → 21 Vitest tests
- [x] **P2.6 — Signaling unit tests**: 43 Jest tests across the three `lib/` modules
- [x] **P2.7 — Per-IP WS connect rate limit**: `WS_CONNECT_LIMIT_PER_IP` (default 10/s)
- [x] **P3.1 — `parking_lot::Mutex`** for mixer + saved-volumes (true RT-safe `try_lock`)
- [x] **P3.3 — `BytesMut` encoder pool**: removes ~50 alloc/s on the encode hot path
- [x] **P3.4 — Debounced volume slider**: 50 ms optimistic debounce on `set_volume`
- [x] **P2.4 — Per-component CSS split**: `App.css` monolith → one CSS file per component
- [x] **Session analytics** (beyond the original plan): privacy-safe `useSessionAnalytics` hook + collapsible `AnalyticsPanel` (duration, live/peak participants, joins, reconnects) — no telemetry leaves the device
- [x] **ESLint v9 flat config** (`eslint.config.mjs`): fixes a CI-breaking lint step left by the eslint ^9 upgrade against a legacy `.eslintrc.json`

## Next Actions

1. **Push to GitHub** → trigger CI/CD pipeline, verify multi-platform builds
2. **E2E audio test** → `npm run tauri dev` with 2+ instances, verify audio streaming
3. **Manual latency measurement** → measure round-trip audio latency
4. **Own TURN server** (coturn) to replace openrelay for production
5. **WSS signaling** (TLS) for production deployment
6. **Room authentication** — password-protected rooms

---

**Last updated**: 2026-06-21
