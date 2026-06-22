# Changelog

All notable changes to Jam P2P are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### CI — fix Tauri release build (audiopus_sys CMake) (2026-06-22)

- Set `CMAKE_POLICY_VERSION_MINIMUM=3.5` for bundled libopus build on GitHub Actions
  (macOS/Windows runners with CMake 4.x).
- Add `docs/process/CODE-SIGNING.md` with platform signing guidance.

### Audio device listing + P0.5 smoke script (2026-06-22)

- **P3 (partial):** `list_audio_devices` Tauri command; SettingsPanel shows active
  input/output (read-only; runtime device switch not yet implemented).
- **P0.5:** PowerShell smoke script `docs/testing/scripts/p0.5-secure-dev-smoke.ps1`
  for secure-dev docker stack (health, token mint, Caddy HTTPS, TURN creds).
- **Tests:** Rust **36** (+1 device enumeration).

### Backend refactor + branch protection (2026-06-22)

- **P3 (partial):** extract `run_backend` from `main.rs` into `backend.rs` with
  `BackendSession` and dedicated handlers for app commands, WS inbound, and reconnect.
- **Process:** enable branch protection on `main` (3 required CI checks, enforce admins).
- **P0:** E2E audio on real hardware marked **DEFERRED** per owner decision.

### P0.5 secure path — TURN integration + dev stack (2026-06-22)

- **TURN REST integration tests:** `/ice-servers` and Welcome emit ephemeral coturn
  credentials when `TURN_SECRET` is set (no openrelay fallback).
- **Secure dev stack:** `docker-compose.secure-dev.yml` + `Caddyfile.secure-dev` for
  WSS/auth/TURN on Windows (coturn with port mapping, Caddy `tls internal`).
- **Docs:** `docs/testing/P0.5-SECURE-PATH-PROCEDURE.md`, `docs/process/BRANCH-PROTECTION.md`.
- **Tests:** signaler **69** (+2 TURN integration).

### Room auth integration + RTT fallback (2026-06-22)

- **P0.5 (partial):** in-process integration tests for `ROOM_AUTH_SECRET` — Join without
  token returns `Error`; valid token from `GET /room/:name/token` allows peer discovery.
- **RTT stats:** fall back to nominated ICE `candidate-pair` RTT when
  `RemoteInboundRTP.round_trip_time` is unset (common in webrtc-rs).
- **Tests:** signaler **67** (+4 room-auth integration).

### Audio encoder — mpsc RTP decoupling (2026-06-22)

- **Decoupled encode from network send:** the Opus encoder thread now pushes
  encoded frames into a bounded `tokio::sync::mpsc` channel (32 slots ≈ 640 ms);
  a dedicated async task calls `track.write_rtp().await`. Replaces the interim
  `rt.block_on(write_rtp)` fix (B3), eliminating per-frame blocking on slow sends.
- **E2E audio status:** infrastructure prerequisites verified; bidirectional playback
  steps remain pending — see `docs/testing/E2E-AUDIO-RESULTS-2026-06-22.md`.

### Adaptive jitter buffer + WebRTC stats analytics (2026-06-22)

- **Adaptive jitter buffer:** per-peer `AdaptiveJitterBuffer` replaces bare FIFO ring
  buffers in the mixer; dynamic watermark from RTP timestamp jitter (RFC 3550).
- **WebRTC getStats():** backend polls stats every 2 s; `session-stats` / `peer-stats`
  events feed RTT, packet loss, and byte counters into `AnalyticsPanel`.
- **Tests:** Rust **35** (+5 jitter buffer); frontend **25** (+1 analytics panel).

### WebRTC signal handler refactor (2026-06-22)

- Extracted `handle_peer_list`, `handle_incoming_offer`, `handle_incoming_answer`, and
  `handle_incoming_ice` from `PeerManager::handle_signal` for readability (P3 partial).

### Network hardening — WSS, room auth, own TURN (2026-06-22)

- **Room authentication (opt-in):** `ROOM_AUTH_SECRET` enables HMAC tokens via
  `GET /room/:name/token`; Join verifies signature before admitting peers. Frontend
  fetches token automatically; Rust wire protocol extended with optional `token` field.
- **Dynamic TURN credentials:** when `TURN_SECRET` + `TURN_URLS` are set, Welcome and
  `/ice-servers` emit coturn-compatible REST credentials instead of static openrelay.
- **WSS/TLS:** `tokio-tungstenite` built with `native-tls` for `wss://` clients;
  `jam-signaler/Caddyfile` + `docker-compose.prod.yml` terminate TLS via Caddy reverse
  proxy to the Node signaler.
- **Tests:** +10 Jest (room-auth, turn-credentials, validation token cases); signaling
  total **63** (53 + 10).

### CI pipeline repair + signaling integration tests (2026-06-22)

The CI had been **red on every commit**. Three independent breakages were diagnosed
from the run logs and fixed, plus two latent failures that were masked behind them.

#### Fixed (CI)
- **Signaling job failed at "Setup Node.js"**: `.gitignore` excluded
  `jam-signaler/package-lock.json`, so it was absent from the CI checkout — both
  `cache: npm` and `npm ci` require a committed lockfile. The lockfile is now tracked.
- **Rust job failed at `cargo fmt --check`**: `audio.rs` and `main.rs` were not
  formatted. Ran `cargo fmt --all`.
- **Build matrix used the retired `macos-13` (Intel) runner** (GitHub removed it in
  Dec 2025; Apple dropped x86_64). Dropped the Intel target — Apple Silicon only.
- **Latent: `cargo clippy` would have errored** on an invalid `clippy.toml` key
  (`allow-attributes-without-reason` is a lint, not a config option). Removed it.
- **Latent: `cargo test --lib` finds no targets** — tests live in the binary crate's
  modules, and the crate has no lib target. Changed to `cargo test --bins`.
- Removed two CI steps that ran `docs/testing/scripts/*.js` directly: they `require('ws')`
  from a directory where it isn't installed (would fail once Node setup was fixed) and
  are now redundant with the in-process jest integration tests.

#### Added
- **Signaling integration tests** (`jam-signaler/__tests__/server.integration.test.js`):
  10 jest tests that boot the real `server.js` in-process and drive it with `ws` clients —
  Welcome handshake, room join + peer discovery (`PeerList`/`NewPeer` with names),
  Offer/Answer/Ice relay (with server-stamped `from`), graceful `Leave` and hard-disconnect
  `PeerLeft`, the per-room cap (`Error`), malformed-message robustness, and the HTTP API
  (`/health`, `/ice-servers`, `/room/:name` 404). Signaling test total: **53** (43 unit + 10).

#### Changed
- Bumped CI actions to `actions/checkout@v5` / `actions/setup-node@v5` and Node 20 → 22
  (the v4 actions and Node 20 are deprecated on current runners).
- `jam-signaler` test script now passes `--forceExit` (the in-process server keeps handles
  open after the suite; this guarantees a clean exit instead of a hang).

---

This entry covers the **compendium hardening** work (local commits `ab55f2b`→`265edcd`)
plus the follow-up audit, session analytics, and documentation pass. It implements the
plan in `ANALISI_UNIFICATA.md` (formerly `COMPENDIO.md`).

### Added
- **CI/CD pipeline** (`.github/workflows/build.yml`): frontend (vitest + lint + typecheck),
  Rust (`cargo fmt`/`clippy -D warnings`/`test`/`audit`), signaling smoke (Jest + 3-peer
  mesh + `/health` & `/ice-servers`), cross-platform Tauri build matrix
  (Linux `.deb`/`.AppImage`/`.rpm`, macOS Intel + Apple Silicon `.dmg`, Windows
  `.msi`/`.exe`), and a tagged (`v*`) GitHub Release job.
- **Session analytics** (frontend): `useSessionAnalytics` hook + collapsible
  `AnalyticsPanel` showing session duration, live/peak participants, cumulative joins,
  and reconnects. Fully client-side — no telemetry, persistence, or network of its own.
- **Signaling unit tests**: 43 Jest tests across `lib/validation`, `lib/rate-limit`,
  and `lib/rooms`.
- **Frontend tests**: expanded from 6 → 24 Vitest tests — interaction tests in
  `App.test.tsx` (connect/join, error surfacing, mute toggle, disconnect, bitrate
  change) plus `AnalyticsPanel.test.tsx` (duration formatting, stats, collapsed state).
- **Per-IP WebSocket connect rate limit** (`WS_CONNECT_LIMIT_PER_IP`, default 10/s) to
  prevent connection-flood amplification of the per-connection message budget.
- **E2E audio verification procedure** (`docs/testing/E2E-AUDIO-PROCEDURE.md`).
- **`.env.example`** now documents `MAX_PEERS_PER_ROOM`, `MAX_ROOMS`, `ALLOWED_ORIGIN`,
  and `WS_CONNECT_LIMIT_PER_IP`.
- **`ANALISI_UNIFICATA.md`**: single merged analysis (Opus + Composer + MiniMax +
  compendium + direct re-verification + commit audit).

### Changed
- **Signaling server modularized**: `server.js` split into `lib/validation.js`,
  `lib/rate-limit.js`, and `lib/rooms.js`; `server.js` is now a thin orchestrator.
- **Real-time-safe mixer**: `std::sync::Mutex` → `parking_lot::Mutex` for the mixer map
  and saved volumes (lockless fast-path `try_lock`, no `PoisonError`).
- **Bounded channels**: internal `mpsc::unbounded_channel` → `mpsc::channel(256/64)` for
  backpressure (`SignalMessage`, WS in/out, `WsEvent`, `AppCommand`).
- **Encoder allocation**: per-frame `Bytes::copy_from_slice` → reused `BytesMut` pool
  (`split().freeze()`), removing ~50 alloc/s on the encode hot path.
- **Volume slider**: backend `set_volume` IPC now debounced 50 ms (UI stays optimistic).
- **CSS**: monolithic `App.css` split into one CSS file per component.
- **Documentation aligned with code**: README protocol table (`PeerList`/`NewPeer` carry
  `name`, added `Error`), test counts (30 Rust + 21 frontend + 43 signaling), Tauri
  events (7 listeners), `/room/:name` (peer count only); ROADMAP date + Phase 8 added;
  system-overview component tree, hooks, and status note refreshed.

### Removed
- **Dead Rust dependencies** from `Cargo.toml`: `url`, `uuid`, `once_cell`, `rand`.
- **Tracked build artifacts**: `test_standalone/target/` untracked from git.

### Fixed
- **CI-breaking ESLint config**: migrated to ESLint v9 flat config (`eslint.config.mjs`),
  replacing the legacy `.eslintrc.json` that v9 cannot read and the unsupported `--ext`
  flag in the `lint` script. Added `@eslint/js` and `globals` as explicit devDependencies.
- **Italian comments** translated to English in `jam-signaler/Dockerfile` and
  `jam-gui/src-tauri/src/logger.rs`.

### Known gaps (not yet addressed — tracked in ROADMAP Phase 9)
- End-to-end audio streaming has a documented procedure but has **not** been executed on
  real hardware.
- No WSS/TLS on the signaling channel; no room authentication; TURN still uses the public
  openrelay server.
- Adaptive jitter buffer absorbs network clock-drift (2026-06-22).

---

## Prior history

Pre-changelog development (Phases 1–7.6) is captured in `ROADMAP.md`: signaling server,
Rust audio/WebRTC backend, single-offerer mesh, RT-safe mixer, fault-tolerant reconnect
(ADR-001), component-based UI refactor, security audit of the signaler, display-name
propagation, and the 2026-06-18 critical-fix pass (forced Opus sample rate, bitrate
kbps→bits/s, glare fix, reconnect-survives-failure, `try_lock` mixer).
