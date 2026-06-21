# Changelog

All notable changes to Jam P2P are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- No adaptive jitter buffer (audible glitches possible under network clock-drift).

---

## Prior history

Pre-changelog development (Phases 1–7.6) is captured in `ROADMAP.md`: signaling server,
Rust audio/WebRTC backend, single-offerer mesh, RT-safe mixer, fault-tolerant reconnect
(ADR-001), component-based UI refactor, security audit of the signaler, display-name
propagation, and the 2026-06-18 critical-fix pass (forced Opus sample rate, bitrate
kbps→bits/s, glare fix, reconnect-survives-failure, `try_lock` mixer).
