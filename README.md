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
# Imposta una password stanza opzionale: ROOM_PASSWORD=secr3t
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

Consigli di sicurezza e operativi
- Configurare STUN/TURN: per connessioni fuori LAN è necessario un server STUN (es. `stun:stun.l.google.com:19302`) e per connessioni più affidabili usare TURN.
- Impostare una password stanza (env `ROOM_PASSWORD`) per limitare l'accesso al signaling.
- Abilitare logging strutturato (vedi `src-tauri/src/logger.rs`) e centralizzare i log in produzione.

Contribuire
- Aggiungere `LICENSE`, `CONTRIBUTING.md` e test prima di PR significative.

Files principali
- `jam-signaler/server.js` — signaling WebSocket con autenticazione stanza opzionale.
- `jam-gui/src/App.tsx` — UI React aggiornata con lista peer e slider per volume per peer.
- `src-tauri/src/main.rs` — runtime Rust: migliorata gestione errori e logging.

Passi consigliati successivi
- Aggiungere test unitari / e2e (playwright / vitest).
- Fornire un TURN server o usare un provider (coturn, Twilio, Xirsys) in produzione.

Per domande o se vuoi che applichi direttamente i cambi nel repo, dimmi quali file vuoi che modifichi per primi.
