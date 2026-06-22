# Jam P2P

Low-latency peer-to-peer audio jam sessions for musicians, built with Tauri v2, React, and Rust.

Jam P2P lets musicians connect over the internet and play together in real time. Audio streams directly between peers via WebRTC — no central server relays audio. A lightweight signaling server coordinates the initial connection, then gets out of the way.

```
┌──────────────┐   WebSocket   ┌──────────────────┐   WebSocket   ┌──────────────┐
│   Peer A     │◄────────────►│  Signaling Server │◄────────────►│   Peer B     │
│  (Tauri+Rust)│               │  (Node.js + ws)  │               │  (Tauri+Rust)│
└──────┬───────┘               └──────────────────┘               └──────┬───────┘
       │                                                                 │
       │              WebRTC (Opus audio via RTP tracks)                 │
       └─────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Real-time P2P audio** — WebRTC mesh with Opus codec, 20ms frames, configurable bitrate (16–192 kbps)
- **Multi-peer mixer** — Ringbuffer-based mixing with tanh soft clipping for distortion-free output
- **VU meters** — Per-peer LED-style level meters with EMA smoothing (throttled to 15 Hz)
- **Mute/unmute** — Volume save/restore per peer
- **Reconnect** — Automatic exponential backoff (1s → 30s max) on connection drops
- **Graceful shutdown** — Clean teardown of encoder, peer connections, and signaling on app exit
- **Settings panel** — Adjustable Opus bitrate while connected
- **Session analytics** — Collapsible per-session metrics (duration, live/peak participants, joins, reconnects) derived locally — no telemetry sent anywhere
- **Keyboard shortcuts** — `M` to mute, `Esc` to disconnect
- **Cross-platform** — Linux (.deb, AppImage), macOS (.dmg), Windows (.msi, .exe) via CI/CD
- **Docker-ready signaling server** — Single `docker compose up` to deploy

---

## Architecture

```
jam-p2p/
├── jam-gui/                          # Frontend + Backend
│   ├── src/                          # React UI (TypeScript)
│   │   ├── App.tsx                   # Root component (compositor)
│   │   ├── hooks/
│   │   │   └── useTauriEvents.ts     # Tauri event listener hook
│   │   ├── components/
│   │   │   ├── ConnectionForm.tsx    # Server/room input + connect button
│   │   │   ├── PeerCard.tsx          # Single peer: name, volume slider, VU
│   │   │   ├── VuMeter.tsx           # 20-bar LED-style level meter
│   │   │   ├── LocalMicCard.tsx      # Local microphone VU display
│   │   │   ├── SettingsPanel.tsx     # Bitrate slider
│   │   │   └── StatusBar.tsx         # Connection status + quality badge
│   │   ├── types.ts                  # TypeScript type definitions
│   │   └── main.tsx                  # React entry point
│   └── src-tauri/                    # Rust backend
│       └── src/
│           ├── main.rs               # Entry point, Tauri setup, event loop
│           ├── audio.rs              # cpal I/O, Opus encoder/decoder, mixer, VU
│           ├── webrtc.rs             # PeerConnection management, track handling
│           ├── signaling.rs          # WebSocket client with reconnect
│           ├── state.rs              # Tauri commands (join, leave, volume, mute)
│           ├── messages.rs           # SignalMessage + AppCommand enums
│           ├── config.rs             # Constants, ICE server configuration
│           └── logger.rs             # Tracing/logging initialization
├── jam-signaler/                     # Signaling server (Node.js)
│   └── server.js                     # WebSocket + HTTP API
├── docs/                             # Documentation
│   ├── architecture/
│   │   ├── system-overview.md        # Detailed architecture doc
│   │   └── decisions/               # Architecture Decision Records
│   └── testing/                      # Test plans and scripts
└── .github/workflows/build.yml       # CI/CD pipeline
```

### Data Flow

```
Microphone ──► cpal capture ──► mono downmix ──► ringbuffer
                                                      │
                                               Opus encoder (20ms frames)
                                                      │
                                               RTP packets ──► WebRTC track ──► Peer

Peer ──► WebRTC track ──► RTP packets ──► Opus decoder ──► PCM samples
                                                                  │
                                                         ringbuffer (per peer)
                                                                  │
                                                          Mixer (sum + tanh)
                                                                  │
                                                    cpal output ──► Speakers
```

---

## Requirements

| Dependency | Minimum Version |
|---|---|
| Node.js | >= 18 |
| Rust | >= 1.70 (stable toolchain) |
| Tauri CLI | v2 |

### System Dependencies

**Linux (Ubuntu/Debian):**
```bash
sudo apt install libpango1.0-dev libcairo2-dev libglib2.0-dev libatk1.0-dev \
  libgdk-pixbuf2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libasound2-dev pkg-config build-essential
```

**macOS:**
```bash
brew install cmake
```

**Windows:**
Visual Studio Build Tools + [WebView2 runtime](https://tauri.app/start/prerequisites/).

---

## Quick Start

### 1. Install dependencies

```bash
cd jam-gui && npm install
```

### 2. Start the signaling server

```bash
cd jam-signaler && npm install && npm start
```

Server runs on `ws://localhost:8080`.

### 3. Run the app

**Browser (UI only, no audio):**
```bash
cd jam-gui && npm run dev
```

**Desktop (full audio + WebRTC):**
```bash
cd jam-gui && npm run tauri dev
```

### 4. Docker (signaling server only)

```bash
cd jam-signaler
npm install && npm run build
docker compose up --build
```

---

## Production Build

**Frontend:**
```bash
cd jam-gui && npm run build
```

**Desktop bundle (all platforms):**
```bash
cd jam-gui && npm run tauri build
```

**CI/CD** (`.github/workflows/build.yml`) automatically builds for Linux, macOS (Apple Silicon), and Windows. Tags matching `v*` trigger a GitHub Release with all artifacts.

---

## Signaling Server

The signaling server (`jam-signaler/server.js`) coordinates initial WebRTC connections. It does **not** relay audio — that flows directly P2P.

### Protocol

| Direction | Type | Payload |
|---|---|---|
| Server → Client | `Welcome` | `{ uuid, iceServers }` |
| Server → Client | `PeerList` | `{ peers: [{ uuid, name }] }` |
| Server → Client | `NewPeer` | `{ uuid, name }` |
| Server → Client | `PeerLeft` | `{ uuid }` |
| Server → Client | `Error` | `{ message }` (e.g. room full / limit reached) |
| Client → Server | `Join` | `{ room, name }` |
| Client → Server | `Leave` | — |
| Bidirectional | `Offer` | `{ target/from, sdp }` |
| Bidirectional | `Answer` | `{ target/from, sdp }` |
| Bidirectional | `Ice` | `{ target/from, candidate }` |

### HTTP API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Server health (room count, peer count, uptime) |
| `/ice-servers` | GET | STUN/TURN configuration (dynamic when `TURN_SECRET` is set) |
| `/room/:name` | GET | Room info (peer count only — peer UUIDs are not enumerable cross-origin for privacy) |
| `/room/:name/token` | GET | HMAC room token (requires `ROOM_AUTH_SECRET`; 503 when auth disabled) |

### Security

- Rate limiting: 50 msg/sec per WebSocket connection, 100 req/sec per IP on HTTP
- Message size limit: 64 KB
- Message structure validation (type + required fields)
- Room name validation (non-empty, max 64 chars)
- Optional room authentication via HMAC tokens (`ROOM_AUTH_SECRET`)
- Optional own TURN with ephemeral REST credentials (`TURN_SECRET` + coturn)
- Production TLS: Caddy reverse proxy (`docker-compose.prod.yml`, `Caddyfile`)
- Secure dev (Windows): `docker-compose.secure-dev.yml` + `Caddyfile.secure-dev` — see `docs/testing/P0.5-SECURE-PATH-PROCEDURE.md`
- Graceful shutdown on SIGTERM/SIGINT

---

## Rust Backend

### Tauri Commands (Frontend → Rust)

| Command | Params | Returns | Description |
|---|---|---|---|
| `join_room` | `{ room, name, server }` | `Result<(), String>` | Join a room (fails with "Already connected" if a session is already live; auto-reconnect does not block) |
| `leave_room` | — | `Result<(), String>` | Leave current room (idempotent — safe to call during auto-reconnect) |
| `set_volume` | `{ peer_id, vol }` | `Result<(), String>` | Set per-peer volume (0.0–1.0) |
| `set_opus_bitrate` | `{ bitrate }` | `Result<(), String>` | Set encoder bitrate (16000–192000 bps) |
| `set_muted` | `{ muted }` | `Result<(), String>` | Mute/unmute with volume save/restore |

### Tauri Events (Rust → Frontend)

| Event | Payload | Description |
|---|---|---|
| `peer-joined` | `{ id: string, name: string }` | New peer connected (name from server `NewPeer`/`PeerList`) |
| `peer-left` | `string` | Peer disconnected |
| `peer-level` | `{ id: string, level: number }` | Peer audio level (0.0–1.0, EMA smoothed, throttled ~15 Hz) |
| `local-level` | `{ level: number }` | Local mic level (0.0–1.0, EMA smoothed, throttled ~15 Hz) |
| `connected` | — | (Re)connected to signaling server (after `Welcome`); also clears `reconnecting` UI |
| `disconnected` | — | WebSocket connection dropped; UI shows reconnecting panel with Cancel button |
| `server-error` | `string` | Server-side error message (e.g. "Room is full", "Server room limit reached") |

### Key Design Decisions

- **WebRTC via Rust (webrtc-rs)** — Lower latency than browser WebRTC, direct audio pipeline access
- **RTP tracks** — Audio streams via RTP (not data channels), native to the WebRTC media pipeline
- **Opus VoIP mode** — 64 kbps default, 20ms frames, optimized for speech/music
- **Forced Opus sample rate** — input, output, encoder and decoder share one Opus-valid rate (48/24/16/12/8 kHz, prefers 48 kHz); avoids the silent no-audio that a 44.1 kHz device default would otherwise cause
- **Full mesh (single-offerer)** — Every peer connects to every other peer; only the joining peer offers, existing peers answer (no glare). Simple, lowest latency. Suitable for 2–6 peers.
- **Soft clipping (tanh)** — Prevents harsh distortion when multiple streams are summed

### Configuration (`config.rs`)

| Constant | Value | Description |
|---|---|---|
| `FRAME_SIZE_MS` | 20 | Opus frame size in milliseconds |
| `DEFAULT_OPUS_BITRATE` | 64000 | Default encoder bitrate (bps) |
| `EMA_ALPHA` | 0.3 | VU meter smoothing factor |
| `VU_THROTTLE_MS` | 67 | VU meter event throttle (~15 Hz) |
| `RECONNECT_BASE_DELAY_MS` | 1000 | Initial reconnect delay |
| `RECONNECT_MAX_DELAY_MS` | 30000 | Maximum reconnect delay |
| `RING_BUFFER_SIZE_MULT` | 4 | Ring buffer size multiplier |

---

## Frontend

### Component Architecture

```
App.tsx
├── ConnectionForm     — Server/room inputs + connect button
├── StatusBar          — Status dot + text + quality badge
├── SettingsPanel      — Bitrate slider (collapsible)
├── AnalyticsPanel     — Per-session metrics strip (collapsible)
├── LocalMicCard       — Local mic VU meter
├── PeerCard[]         — Per-peer: name, volume slider, VU meter
│   └── VuMeter        — 20-bar LED-style level display (20 bars, green/blue)
├── hooks/useTauriEvents()     — Hook managing 7 Tauri event listeners
│   └── Returns { peers, localLevel, disconnected, reconnected, serverError, resetPeers, updatePeerVolume, ... }
└── hooks/useSessionAnalytics() — Derives session duration, peak size, joins, reconnects from status + peer count (no backend calls)
```

All peer-facing components use `React.memo` to minimize re-renders. Each
component ships its own CSS file; `App.css` holds only global layout.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `M` | Toggle mute/unmute |
| `Esc` | Disconnect from room |
| `Ctrl+Shift+D` | Disconnect (alternative) |

---

## Testing

**Frontend:**
```bash
cd jam-gui && npm test
```

**Rust unit tests** (requires system dependencies):
```bash
cd jam-gui/src-tauri && cargo test
```

### Test Coverage

- **Rust**: 36 unit tests covering audio level computation (silence, full-scale, EMA smoothing, NaN/Inf safety, clipping, extreme values, convergence), Opus sample-rate selection (`pick_common_opus_rate`), the adaptive jitter buffer (`jitter_buffer.rs`), cpal device enumeration, plus 7 serde wire-protocol round-trip tests
- **Frontend**: 25 Vitest tests — rendering (logo, connection form, inputs, component structure, display-name label), interaction tests (connect/join, error surfacing, mute toggle, disconnect, bitrate change), and analytics-panel tests (duration formatting, network stats, collapsed state)
- **Signaling**: 69 Jest tests — unit + in-process integration (room-auth, TURN REST, wire contract)

---

## Performance

### Latency Budget

| Stage | Latency |
|---|---|
| Audio capture buffer | 10–20 ms |
| Opus encoding | 20 ms |
| Network RTT | 20–100 ms |
| Opus decoding | < 1 ms |
| Mixer/output buffer | 10–20 ms |
| **Total** | **~60–160 ms** |

### Mesh Scalability

| Peers | Connections | Bandwidth |
|---|---|---|
| 2 | 1 | Low |
| 3 | 3 | Moderate |
| 5 | 10 | High |
| N | N×(N-1)/2 | O(N²) |

Full mesh is practical for 2–6 peers. For larger sessions, an SFU (Selective Forwarding Unit) would be needed.

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full development roadmap and remaining issues,
[CHANGELOG.md](./CHANGELOG.md) for the release history, and
[ANALISI_UNIFICATA.md](./ANALISI_UNIFICATA.md) for the consolidated architecture/quality/security analysis.

**Completed:** Signaling server, Rust backend, WebRTC mesh, UI, CI/CD, graceful shutdown, message validation, VU throttling, component refactoring.

**Next:** Validate secure stack (`docs/testing/P0.5-SECURE-PATH-PROCEDURE.md`), runtime audio device selection, platform code signing (`docs/process/CODE-SIGNING.md`), SFU for large sessions. E2E audio on hardware deferred per owner decision.

---

## License

ISC

---

**Last updated**: 2026-06-22

## CI/CD

GitHub Actions pipeline (`.github/workflows/build.yml`) runs on every push and pull request to `main`:

- **Frontend test job**: Vitest + ESLint + TypeScript typecheck on `ubuntu-latest`
- **Rust test job**: `cargo test --bins` (36 unit tests), `cargo fmt --check`, `cargo clippy -D warnings` (with the `pedantic` group advisory via `-A clippy::pedantic`), `cargo audit`
- **Signaling smoke job**: Jest unit + in-process integration tests (69) + standalone `node server.js` boot with HTTP `/health` and `/ice-servers` smoke
- **Build matrix**: Tauri release build on Linux (`.deb`, `.AppImage`, `.rpm`), macOS Apple Silicon (`.dmg`), Windows (`.msi`, `.exe`)
- **Release**: tags matching `v*` produce a GitHub Release with all platform artifacts attached

Trigger a manual run from the Actions tab → "Build & Test" → "Run workflow".
