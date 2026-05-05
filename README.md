# Jam P2P

Low-latency peer-to-peer audio jamming application for musicians. Built with a Rust + WebRTC backend and a React + Tauri v2 frontend.

## Overview

- **Frontend UI**: `jam-gui/` — React 19 + Vite + Tauri v2
- **Native Backend**: `jam-gui/src-tauri/` — Rust (cpal, Opus, webrtc-rs, WebSocket signaling)
- **Signaling Server**: `jam-signaler/` — Node.js + `ws` (WebSocket + HTTP API)

The Rust backend handles audio capture/playback, Opus codec, and WebRTC peer connections. The React UI communicates with the backend via Tauri Commands and Events for seamless desktop integration.

---

## Development Requirements

| Dependency | Minimum Version |
|---|---|
| Node.js | >= 18 |
| Rust | >= 1.70 (stable toolchain) |
| Tauri CLI | v2 |

### Linux (Ubuntu/Debian)

```bash
sudo apt install libpango1.0-dev libcairo2-dev libglib2.0-dev libatk1.0-dev \
  libgdk-pixbuf2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libasound2-dev pkg-config build-essential
```

### macOS

```bash
brew install cmake
```

### Windows

Visual Studio Build Tools + WebView2 runtime. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

---

## Quickstart

### 1. Install frontend dependencies

```bash
cd jam-gui && npm install
```

### 2. Start the signaling server

```bash
cd jam-signaler && npm install && npm start
```

Server runs at `ws://localhost:8080`

### 3. Run the app in dev mode

**UI only (browser):**
```bash
cd jam-gui && npm run dev
```

**Tauri desktop (requires native tooling):**
```bash
cd jam-gui && npm run tauri dev
```

### 4. Docker (signaling server only)

```bash
cd jam-signaler
npm install && npm run build   # compile with ncc
docker compose up --build
```

---

## Production / Build

### Frontend

```bash
cd jam-gui && npm run build
```

### Tauri bundle (all platforms)

```bash
cd jam-gui && npm run tauri build
```

### CI/CD

The `.github/workflows/build.yml` workflow automatically builds for:
- Linux (AppImage + .deb)
- macOS Intel & Apple Silicon (.dmg + .app)
- Windows (.msi + .exe)

Tags `v*` trigger a GitHub Release with all artifacts.

---

## Repository Structure

```
jam-p2p/
├── jam-gui/                    # React UI + Tauri v2
│   ├── src/
│   │   ├── App.tsx             # Main UI (room join, mixer, VU meters, settings)
│   │   ├── App.css             # Styles
│   │   ├── types.ts            # TypeScript types
│   │   ├── App.test.tsx        # 3 frontend rendering tests (Vitest)
│   │   └── main.tsx            # Entry point
│   └── src-tauri/              # Rust backend (modular)
│       ├── src/
│       │   ├── main.rs         # Entry point, Tauri setup, backend event loop (~188 lines)
│       │   ├── audio.rs        # cpal I/O, Opus encoder, mixer, VU calculation, 22 unit tests
│       │   ├── webrtc.rs       # PeerConnection creation, signal handler, track management
│       │   ├── signaling.rs    # WebSocket client, reconnect with exponential backoff
│       │   ├── state.rs        # Tauri state + commands (join, leave, volume, bitrate, mute)
│       │   ├── messages.rs     # SignalMessage + AppCommand + WsEvent enums
│       │   ├── config.rs       # Constants, ICE server configuration
│       │   └── logger.rs       # Tracing/logging initialization
│       ├── Cargo.toml
│       └── tauri.conf.json
├── jam-signaler/               # Signaling server (Node.js)
│   ├── server.js               # WebSocket + HTTP API, rate limiting, message validation
│   ├── Dockerfile
│   └── docker-compose.yml
├── .github/workflows/
│   └── build.yml               # Multi-platform CI/CD
└── docs/
    ├── architecture/           # Architecture docs & ADRs
│   │   ├── system-overview.md  # Full system architecture
│   │   └── decisions/          # Architecture Decision Records
    ├── testing/                # Test plans & verification results
│   │   ├── mesh-verification-plan.md   # Mesh topology verification
│   │   ├── multi-peer-mesh-test-plan.md # Multi-peer test plan
│   │   ├── audio-quality-test-plan.md   # Audio quality test plan
│   │   └── scripts/             # Automated test scripts
    ├── ROADMAP.md               # Development roadmap
    └── .cron-state.md           # Development progress log
```

---

## Features

### Backend Rust (src-tauri)

| Feature | Status | Notes |
|---|---|---|
| Audio capture (cpal) | ✅ Implemented | Mono/stereo automatic downmix |
| Opus codec (encoder/decoder) | ✅ Implemented | VoIP mode, configurable bitrate 16-192 kbps |
| WebRTC peer connections (webrtc-rs 0.11) | ✅ Implemented | Full mesh via RTP tracks |
| Signaling WebSocket client | ✅ Implemented | Reconnect with exponential backoff 1s → 30s max |
| Multi-peer audio mixer | ✅ Implemented | Ringbuffer + tanh soft clipping |
| VU meter via Tauri events | ✅ Implemented | RMS → dBFS → EMA smoothing |
| Mute/Unmute with save/restore | ✅ Implemented | Volume state persisted |
| Encoder graceful shutdown | ✅ Implemented | Watch channel for clean shutdown |
| Double join guard | ✅ Implemented | `connected` atomic flag |
| Rate limiting signaling | ✅ Implemented | 50 msg/sec, max 64KB |
| NewPeer auto-handling | ✅ Implemented | Auto-creates PC + sends Offer |
| WebSocket reconnect (WsEvent channel) | ✅ Implemented | Dedicated lifecycle channel |
| PeerLeft signaling cleanup | ✅ Implemented | Immediate cleanup + UI event |
| STUN + TURN (openrelay) | ✅ Configured | NAT traversal ready |
| Clippy lint configuration | ✅ Configured | `unwrap_used`, `expect_used`, `pedantic` warnings |
| Unit tests | ✅ 22 tests | Audio level, clipping, EMA, edge cases |

### Signaling Server (jam-signaler)

| Feature | Status | Notes |
|---|---|---|
| WebSocket signaling | ✅ | Join/Leave/Offer/Answer/ICE |
| Heartbeat 30s ping/pong | ✅ | Dead peer detection |
| HTTP API (`/health`, `/ice-servers`, `/room/:name`) | ✅ | GET only, CORS enabled |
| STUN + TURN config | ✅ | Google STUN + OpenRelay TURN |
| Graceful disconnect + PeerLeft | ✅ | Empty room cleanup |
| Docker deployment | ✅ | Dockerfile + docker-compose |
| Rate limiting | ✅ | 50 msg/sec per connection |
| Message size limit | ✅ | Max 64KB |
| Input validation | ✅ | Room name validation |

### Frontend (jam-gui)

| Feature | Status | Notes |
|---|---|---|
| Room join UI | ✅ | Server + room input |
| Volume control per peer | ✅ | Slider 0-100% |
| VU meter visualization | ✅ | 20-bar LED-style (green/yellow/red) per peer |
| Local mic VU meter | ✅ | 20-bar blue LED-style for self-monitoring |
| Settings panel (bitrate) | ✅ | Collapsible, 16-192 kbps slider |
| Connection quality badge | ✅ | GOOD/FAIR/POOR indicator |
| Mute toggle | ✅ | 🔊 LIVE / 🔇 MUTED |
| Disconnect button | ✅ | ⏏ with Esc shortcut |
| Keyboard shortcuts | ✅ | M=mute, Ctrl+Shift+D/Esc=disconnect |
| Peer count display | ✅ | Real-time peer count |
| Tauri commands integration | ✅ | join, leave, set_volume, set_opus_bitrate, set_muted |
| ESLint + TypeScript strict | ✅ | Configured |
| Frontend tests | ✅ | Vitest + 3 rendering tests |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `M` | Toggle mute/unmute |
| `Ctrl+Shift+D` | Disconnect from room |
| `Esc` | Disconnect from room |

---

## Notes

- The Node.js signaling server is **only** for signaling message exchange (Join/Leave/Offer/Answer/ICE). Audio flows directly P2P via WebRTC.
- TURN server (openrelay.metered.ca) is pre-configured for NAT traversal.
- Topology: **full mesh** — suitable for 2-6 peers. For larger sessions, an SFU would be needed.
- The React UI in the browser (`npm run dev`) shows only the interface — audio/WebRTC functionality requires the Tauri desktop build.

See [ROADMAP.md](./ROADMAP.md) for the complete list of remaining items and priorities.

---

**Last updated**: 2026-05-05
