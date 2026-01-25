# Jam P2P

Questo repository contiene un'applicazione desktop ibrida (Tauri + React) per jam audio P2P e il relativo signaling server.

Panoramica:
- Frontend: `jam-gui` (React + Vite + Tauri)
- Signaling server: `jam-signaler` (Node.js, WebSocket)
- Runtime nativo: `src-tauri` (binding Rust per audio e WebRTC)

Requisiti locali di sviluppo
- Node.js >= 18
- Rust >= 1.70, `cargo` e toolchain `stable`
- Tauri prerequisites (platform-specific): vcpkg, OpenSSL su Windows/macOS a seconda del setup

Quickstart (sviluppo)

1) Installare dipendenze frontend:

```bash
cd jam-gui
npm install
```

2) Avviare il signaling server (locale):

```bash
cd ../jam-signaler
node server.js
```

3) Avviare frontend + Tauri in dev:

```bash
cd ../jam-gui
npm run dev        # vite dev
npm run tauri      # avvia la finestra Tauri (dev)
```

Note:
- Il signaling server è implementato in Node.js e si trova in `jam-signaler/server.js`.
- Il codice Rust in `src-tauri` gestisce l'I/O audio e le PeerConnection WebRTC. In produzione è possibile compilare con `npm run build` (nella cartella `jam-gui`) e poi packaging Tauri.

Produzione / build

1) Build frontend:

```bash
cd jam-gui
npm run build
```

2) Build Tauri bundle (da `jam-gui`):

```bash
npm run tauri build
```
