# Jam P2P

Applicazione desktop P2P per jam audio collaborativo a bassa latenza via WebRTC.

Panoramica:
- **Frontend UI**: `jam-gui/` — React + Vite + Tauri v2
- **Backend nativo**: `jam-gui/src-tauri/` — Rust (cpal, Opus, webrtc-rs, WebSocket signaling)
- **Signaling server**: `jam-signaler/` — Node.js + ws (WebSocket + HTTP API)

Architettura: il backend Rust gestisce cattura/riproduzione audio, codec Opus e connessioni WebRTC. La UI React comunica con il backend tramite Tauri Commands ed eventi.

---

## Requisiti di sviluppo

| Dipendenza | Versione minima |
|---|---|
| Node.js | >= 18 |
| Rust | >= 1.70 (toolchain `stable`) |
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

Visual Studio Build Tools + WebView2 runtime. Vedi [Tauri prerequisites](https://tauri.app/start/prerequisites/).

---

## Quickstart

### 1. Installare dipendenze frontend

```bash
cd jam-gui && npm install
```

### 2. Avviare il signaling server

```bash
cd jam-signaler && npm install && npm start
```

Server attivo su `ws://localhost:8080`

### 3. Avviare l'app in dev mode

**Solo UI (browser):**
```bash
cd jam-gui && npm run dev
```

**Tauri desktop (richiesto ambiente nativo):**
```bash
cd jam-gui && npm run tauri dev
```

### 4. Docker (solo signaling server)

```bash
cd jam-signaler
npm install && npm run build   # compila con ncc
docker compose up --build
```

---

## Produzione / build

### Frontend

```bash
cd jam-gui && npm run build
```

### Tauri bundle (tutte le piattaforme)

```bash
cd jam-gui && npm run tauri build
```

### CI/CD

Il workflow `.github/workflows/build.yml` builda automaticamente per:
- Linux (AppImage + .deb)
- macOS Intel & Apple Silicon (.dmg + .app)
- Windows (.msi + .exe)

I tag `v*` triggerano una GitHub Release con gli artifact.

---

## Struttura del repository

```
jam-p2p/
├── jam-gui/                    # React UI + Tauri v2
│   ├── src/                    # Componenti React
│   │   ├── App.tsx             # UI principale (room join, mixer, VU meters)
│   │   ├── App.css             # Stili
│   │   ├── types.ts            # TypeScript types
│   │   └── main.tsx            # Entry point
│   └── src-tauri/              # Backend Rust (modulare)
│       ├── src/
│       │   ├── main.rs         # Entry point, Tauri setup, backend loop (~188 righe)
│       │   ├── audio.rs        # cpal I/O, Opus encoder, mixer, VU calculation + 4 test
│       │   ├── webrtc.rs       # PeerConnection creation, signal handler, track management
│       │   ├── signaling.rs    # WebSocket client, reconnect con exponential backoff
│       │   ├── state.rs        # Tauri state + 5 commands (join, leave, volume, bitrate, mute)
│       │   ├── messages.rs     # SignalMessage + AppCommand enums
│       │   ├── config.rs       # Costanti, ICE server configuration
│       │   └── logger.rs       # Tracing/logging initialization
│       ├── Cargo.toml
│       └── tauri.conf.json
├── jam-signaler/               # Signaling server Node.js
│   ├── server.js               # WebSocket + HTTP API, rate limiting, message validation
│   ├── Dockerfile
│   └── docker-compose.yml
├── .github/workflows/
│   └── build.yml               # CI/CD multi-piattaforma
└── docs/
    ├── architecture/           # Documentazione architettura
    └── testing/                # Piani di test e verifica
```

---

## Componenti

### Backend Rust (src-tauri)

| Feature | Stato | Note |
|---|---|---|
| Cattura audio (cpal) | ✅ Implementato | Mono/stereo downmix automatico |
| Codec Opus (encoder/decoder) | ✅ Implementato | VoIP mode, bitrate configurabile |
| WebRTC peer connections (webrtc-rs) | ✅ Implementato | Full mesh via RTP tracks |
| Signaling WebSocket client | ✅ Implementato | Reconnect con exponential backoff |
| Mixer multi-peer | ✅ Implementato | Ringbuffer + soft clipping (tanh) |
| VU meter via eventi Tauri | ✅ Implementato | RMS → dBFS → EMA smoothing |
| Reconnect esponenziale | ✅ Implementato | 1s → 30s max |
| TURN server (openrelay) | ✅ Configurato | STUN + TURN nel signaling e nel backend |
| Mute/Unmute con save/restore | ✅ Implementato | Volumi salvati e ripristinati |
| Encoder shutdown | ✅ Implementato | Watch channel per graceful shutdown |
| Double join guard | ✅ Implementato | `connected` atomic flag |
| Rate limiting signaling | ✅ Implementato | 50 msg/sec, max 64KB |
| NewPeer handling | ✅ Implementato | Crea PC e invia Offer automaticamente |
| PeerLeft signaling | ✅ Implementato | Cleanup immediato + evento UI |

### Signaling Server (jam-signaler)

| Feature | Stato | Note |
|---|---|---|
| WebSocket signaling | ✅ | Join/Leave/Offer/Answer/ICE |
| Heartbeat 30s ping/pong | ✅ | Dead peer detection |
| HTTP API (`/health`, `/ice-servers`, `/room/:name`) | ✅ | GET only, CORS enabled |
| STUN + TURN config | ✅ | Google STUN + OpenRelay TURN |
| Graceful disconnect + PeerLeft | ✅ | Cleanup stanze vuote |
| Docker deployment | ✅ | Dockerfile + docker-compose |
| Rate limiting | ✅ | 50 msg/sec per connessione |
| Message size limit | ✅ | Max 64KB per messaggio |
| Input validation | ✅ | Room name validation |

### Frontend (jam-gui)

| Feature | Stato | Note |
|---|---|---|
| Room join UI | ✅ | Server + room input |
| Volume control per peer | ✅ | Slider 0-100% |
| VU meter visualization | ✅ | 20-bar LED-style (green/yellow/red) |
| Local mic VU meter | ✅ | 20-bar blue LED-style |
| Status indicator | ✅ | idle/joining/connected/disconnected/error |
| Connection quality badge | ✅ | GOOD/FAIR/POOR indicator |
| Settings panel (bitrate) | ✅ | Collapsible, 16-192 kbps slider |
| Mute toggle | ✅ | 🔊 LIVE / 🔇 MUTED |
| Disconnect button | ✅ | ⏏ with Esc shortcut |
| Keyboard shortcuts | ✅ | M=mute, Esc=disconnect |
| Tauri commands integration | ✅ | 6 commands |
| ESLint + TypeScript strict | ✅ | Configurato |
| Frontend tests | ✅ | Vitest + 3 rendering tests |

---

## Note

- Il signaling server Node.js è **solo** per lo scambio di messaggi di signaling (Join/Leave/Offer/Answer/ICE). L'audio fluisce direttamente P2P via WebRTC.
- TURN server pubblico (openrelay.metered.ca) preconfigurato per NAT traversal.
- Topologia: **full mesh** — adatta per 2-6 peer. Per sessioni più grandi servirebbe SFU.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `M` | Toggle mute/unmute |
| `Esc` | Disconnect from room |

### Local Development Notes

- La UI React in browser (`npm run dev`) mostra solo l'interfaccia — le funzionalità audio/WebRTC richiedono Tauri.
- Per test rapidi della UI senza backend Rust, i comandi Tauri sono mockati nei test con `@tauri-apps/api` mock.

### Issue notevoli aperti

Vedere [ROADMAP.md](./ROADMAP.md) per la lista completa dei remaining issues e priorità.

---

**Ultimo aggiornamento**: 2026-04-29
