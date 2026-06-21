# 📊 COMPENDIO OMNICOMPRENSIVO — Jam P2P

> **Fusione di:** ANALISI_OPUS.md + ANALISI_COMPOSER.md + ANALISI_MINIMAX.md + Analisi Diretta
> **Data:** 2026-06-21 · **Commit:** `9cbe76a` · **GitNexus:** 715 nodi, 1000 edge, 18 cluster, 12 flow

---

## 1. VERDETTO UNIFICATO (95% consenso tra le 3 analisi)

| Dimensione | Opus | Composer | MiniMax | **Consenso** |
|---|---|---|---|---|
| Architettura | 8/10 | 4/5 (8/10) | 8/10 | **8.0/10** |
| Code Quality | 8/10 | 4/5 (8/10) | 7.5/10 | **7.8/10** |
| Documentazione | 9/10 | 3/5 (6/10) | 8/10 | **7.7/10** |
| Allineamento doc↔code | 6/10 | — | 8/10 | **7.0/10** |
| Sicurezza | 6.5/10 | 3/5 (6/10) | 7/10 | **6.5/10** |
| Ottimizzazione | 7.5/10 | 4/5 (8/10) | 7.5/10 | **7.7/10** |
| **Maturità complessiva** | **~7.5** | **MVP** | **7.8** | **7.5/10** |

**Verdetto unanime:** MVP eccellente, codice pulito, architettura matura — ma non ancora production-ready. Gap principali: CI/CD assente, E2E audio mai testato, hardening sicurezza (WSS/auth/TURN) da completare.

---

## 2. CONVERGENZE CHIAVE (tutte e 3 le analisi concordano)

### ✅ Punti di forza indiscussi

1. **Pipeline audio RT-safe** — `try_lock` nel callback cpal, encoder disaccoppiato dal mixer, `catch_unwind` anti-panico. Scelta forzata Opus sample rate (48/24/16/12/8 kHz) che evita "silent no-audio" su dispositivi 44.1 kHz.

2. **Single-offerer mesh** — prevenzione elegante del "glare" (doppia offerta simultanea). Solo il peer entrante invia Offer; gli esistenti rispondono. Ben documentato e implementato in `webrtc.rs`.

3. **Reconnect robusto** — ADR-001 formale + amendment 2026-06-18 che corregge il bug del backoff che si arrestava dopo un singolo tentativo fallito. `WsEvent` channel dedicato, separazione pulita delle responsabilità.

4. **Documentazione architetturale** — ADR, system-overview, test plan, README, ROADMAP: raro per un progetto di queste dimensioni. Commenti "why" nel codice di alta qualità.

5. **Test Rust eccellenti** — 30 test (23 audio + 7 serde wire protocol) con copertura edge-case: NaN, Inf, clipping, convergenza EMA, sample-rate selection, buffer vuoti.

6. **Separation of concerns** — 8 moduli Rust, 6 componenti React + 1 hook, boundaries chiari tra messaging, audio, webrtc, signaling, state, config.

### ❌ Criticità condivise (tutte concordano)

| # | Criticità | Gravità | Dove | 
|---|---|---|---|
| C1 | **CI/CD documentata ma INESISTENTE** | 🔴 CRITICA | `.github/workflows/` non esiste |
| C2 | **E2E audio mai verificato** | 🔴 CRITICA | Nessun test con 2+ istanze |
| C3 | **Nessun jitter buffer adattivo** | 🟡 MEDIA | Ring buffer FIFO semplici |
| C4 | **WSS/TLS assente** | 🟡 MEDIA | Signaling in chiaro ws:// |
| C5 | **Nessuna autenticazione stanze** | 🟡 MEDIA | Chiunque conosca il nome entra |
| C6 | **TURN pubblico openrelay** | 🟡 MEDIA | Credenziali hardcoded |
| C7 | **Dipendenze Rust morte** | 🟢 BASSA | `url`, `uuid`, `once_cell`, `rand` |
| C8 | **Artefatti build in git** | 🟢 BASSA | `test_standalone/target/` tracciato |

---

## 3. DISALLINEAMENTI DOCUMENTAZIONE ↔ CODEBASE

| # | Documento dice | Codice fa | File coinvolti | Severità |
|---|---|---|---|---|
| D1 | `.github/workflows/build.yml` esiste | **La directory `.github` non esiste** | `README.md`, `ROADMAP.md`, `system-overview.md` | 🔴 CRITICA |
| D2 | `peer-joined` payload = `string` | Emette `{ id, name }` (oggetto) | `README.md`, `webrtc.rs:197-200` | 🟡 MEDIA |
| D3 | `/room/:name` ritorna `peers: [...]` | Solo `{ room, peerCount }` | `system-overview.md`, `server.js:118-124` | 🟡 MEDIA |
| D4 | "5 Tauri event listeners" | 7 listener (`connected`, `server-error` mancanti) | `README.md`, `useTauriEvents.ts` | 🟡 MEDIA |
| D5 | "23 unit test" / "5 frontend test" | 30 Rust (23+7) / 6 frontend | `README.md`, `ROADMAP.md` | 🟢 BASSA |
| D6 | "7 extracted components" | 6 componenti + 1 hook | `README.md` | 🟢 BASSA |
| D7 | ROADMAP: "CI/CD ✅ Configured" | Workflow assente | `ROADMAP.md` righe 47-48 | 🔴 CRITICA |

---

## 4. ARCHITETTURA

### Diagramma a strati

```
┌──────────────────────────────────────────────────────────┐
│  STRATO 4 — UI (React 19 + Tauri v2)                     │
│  App.tsx → ConnectionForm / StatusBar / SettingsPanel    │
│           / LocalMicCard / PeerCard[] / VuMeter          │
│  useTauriEvents hook: 7 listener Tauri                   │
│  Stati: idle | joining | connected | reconnecting | error│
└──────────────────────┬───────────────────────────────────┘
                       │ Tauri IPC (5 commands + 7 events)
┌──────────────────────▼───────────────────────────────────┐
│  STRATO 3 — Backend Rust (8 moduli, ~1.552 LOC)          │
│  main.rs: tokio::select! event loop                      │
│  audio.rs: cpal + Opus + mixer RT-safe + 23 test         │
│  webrtc.rs: PeerManager single-offerer mesh              │
│  signaling.rs: WS client + reconnect backoff             │
│  state.rs: 5 Tauri commands + connected guard            │
│  messages.rs: wire protocol + 7 test serde               │
│  config.rs: costanti + ICE fallback                      │
│  logger.rs: tracing init                                  │
└──────────────────────┬───────────────────────────────────┘
                       │ WebSocket (ws:// :8080)
┌──────────────────────▼───────────────────────────────────┐
│  STRATO 2 — Signaling (Node.js, ~358 LOC)                │
│  server.js: WS + HTTP API, rate-limit, room mgmt         │
│  DoS caps: 8 peer/room, 500 room, 64KB msg               │
│  Heartbeat 30s, graceful shutdown SIGTERM/SIGINT         │
│  Docker-ready (Dockerfile + docker-compose)              │
└──────────────────────┬───────────────────────────────────┘
                       │ WebRTC DTLS-SRTP (P2P)
┌──────────────────────▼───────────────────────────────────┐
│  STRATO 1 — P2P Audio Mesh                               │
│  N×(N-1)/2 RTCPeerConnection per stanza                  │
│  RTP/Opus 20ms frame, 48/24/16/12/8 kHz forzato         │
│  STUN Google + TURN openrelay (fallback)                 │
└──────────────────────────────────────────────────────────┘
```

### Debolezze architetturali

| # | Debolezza | Impatto | File |
|---|---|---|---|
| A1 | Nessun jitter buffer adattivo | Glitch audio sotto rete degradata | `audio.rs`, `webrtc.rs` |
| A2 | `local_track` singola condivisa | Impedisce audio processing per-peer | `main.rs` |
| A3 | Mesh O(N²) senza fallback SFU | >6 peer impraticabile | `webrtc.rs` |
| A4 | `mpsc::unbounded_channel` ovunque | Nessun backpressure, memoria illimitata | `main.rs`, `signaling.rs` |
| A5 | `StdMutex` su RT thread | Teoricamente unsafe (possibili syscall futex) | `audio.rs:38` |
| A6 | `run_backend()` ~161 righe | Complessità alta | `main.rs:62-224` |
| A7 | `server.js` monolite 280 righe | Manutenibilità | `server.js` |
| A8 | `ws.displayName` monkey-patching | Rischio collisione con libreria ws | `server.js:160` |

---

## 5. CODE QUALITY — ISSUE DETTAGLIATE

| # | Issue | File:Riga | Gravità | 
|---|---|---|---|
| CQ1 | Dep Rust morte: `url`, `uuid`, `once_cell`, `rand` mai usate | `Cargo.toml` | 🟡 |
| CQ2 | Artefatti build in git: `test_standalone/target/` tracciato | repo root | 🟡 |
| CQ3 | `App.tsx` 268 righe con 8 `useState` separati | `App.tsx:13-21` | 🟡 |
| CQ4 | `App.css` 740 righe monolitico | `App.css` | 🟡 |
| CQ5 | `server.js` 280 righe monolitico | `server.js` | 🟡 |
| CQ6 | `webrtc.rs` 299 righe, `handle_signal` 127 righe | `webrtc.rs:44-170` | 🟡 |
| CQ7 | `StdMutex` non RT-safe in teoria | `audio.rs:38` | 🟡 |
| CQ8 | Allocazione per-frame PCM buffer decoder | `webrtc.rs` on_track | 🟢 |
| CQ9 | `ws.displayName` monkey-patching | `server.js:160,184` | 🟢 |
| CQ10 | Commenti italiani residui (4 righe Dockerfile, logger.rs:4) | `Dockerfile`, `logger.rs` | 🟢 |
| CQ11 | Test frontend solo rendering, zero interazioni | `App.test.tsx` | 🟡 |
| CQ12 | Nessun test automatico signaling server | `jam-signaler` | 🟠 |
| CQ13 | `thread::sleep(1ms)` nell'encoder quando mic vuoto | `audio.rs` encoder loop | 🟢 |
| CQ14 | Volume slider senza debounce (invia ad ogni keystroke) | `PeerCard.tsx` | 🟢 |
| CQ15 | `bytes::Bytes::copy_from_slice` alloca per ogni frame | `audio.rs:241` | 🟢 |
| CQ16 | `MAX_ROOM_NAME_LENGTH=64` ma `MAX_NAME_LENGTH=32` non documentato | `server.js:11-12` | 🟢 |
| CQ17 | `RTP_PAYLOAD_TYPE=111` senza commento esplicativo | `config.rs:6` | 🟢 |
| CQ18 | `messages.rs` mescola tipi wire e tipi interni | `messages.rs:46-66` | 🟢 |

---

## 6. SICUREZZA — GAP ANALYSIS

### Controlli presenti (difese attive)

| Controllo | Dove | Efficacia |
|---|---|---|
| Rate limiting WS (50 msg/s/conn) | `server.js:79-83` | ✅ |
| Rate limiting HTTP (100 req/s/IP) | `server.js:34-40` | ✅ |
| Max message size (64 KB) | `server.js:85-89` | ✅ |
| Validazione strutturale messaggi (6 tipi) | `server.js:43-75` | ✅ |
| MAX_PEERS_PER_ROOM=8, MAX_ROOMS=500 | `server.js:17-21` | ✅ |
| CORS `ALLOWED_ORIGIN` env | `server.js:24` | 🟡 default `*` |
| Peer info leak chiuso (`/room/:name` solo count) | `server.js:118-124` | ✅ |
| `from` spoofing prevention (server-side) | `server.js` handler Offer/Answer/Ice | ✅ |
| CSP restrittiva Tauri | `tauri.conf.json` | ✅ |
| DTLS-SRTP obbligatorio | webrtc-rs | ✅ |
| Heartbeat 30s (dead peer detection) | `server.js:174-184` | ✅ |
| `catch_unwind` su encoder thread | `audio.rs:170-177` | ✅ |
| Capability Tauri minimal | `capabilities/default.json` | ✅ |

### Gap di sicurezza

| # | Gap | Rischio | Sfruttabilità |
|---|---|---|---|
| S1 | **No WSS/TLS signaling** | MITM su SDP/ICE in chiaro | 🟠 Media |
| S2 | **No room authentication** | Chiunque entra se conosce nome stanza | 🟠 Media |
| S3 | **No WS rate-limit per IP** (solo per-connection) | DoS amplifier: 1000 conn × 50 msg/s | 🟡 Media |
| S4 | **TURN openrelay pubblico** | Logging traffico relay, quota limitata | 🟡 Basso |
| S5 | **No dependency audit automatizzato** | Vulnerabilità in deps non rilevate | 🟡 Medio |
| S6 | **Credenziali TURN hardcoded** | In git history per sempre | 🟢 Basso (pubbliche) |
| S7 | **Nessun rate-limit connessioni WS globali** | Apertura illimitata di WS | 🟢 Basso |
| S8 | **`ALLOWED_ORIGIN` default `*`** | CSRF-like se dimenticato in prod | 🟢 Basso |

---

## 7. OTTIMIZZAZIONE — BOTTLENECK

### Ottimizzazioni già in atto (eccellenti)

- **Release profile:** `lto=true`, `codegen-units=1`, `opt-level=3`
- **VU throttle ~15 Hz** → -70% overhead IPC Tauri
- **Bitrate set solo on-change** → non chiama `set_bitrate` ogni frame
- **`try_lock` RT-safe** → zero blocking su thread audio
- **Encoder disaccoppiato dal mixer** → rimossa contesa di lock
- **`React.memo`** su tutti i componenti peer-facing
- **Single-offerer mesh** → handshake più veloce (no glare)

### Bottleneck

| Bottleneck | Impatto | File |
|---|---|---|
| Network RTT 20-100ms | 40-60% della latenza totale | Non controllabile |
| Mesh O(N²) | 8 peer = 28 connessioni, 1.75 Mbps/peer | `webrtc.rs` |
| Nessun jitter buffer | Glitch sotto jitter/clock drift | `audio.rs`, `webrtc.rs` |
| Allocazioni hot path | -1/2% CPU (PCM buffer, Bytes copy) | `webrtc.rs`, `audio.rs` |
| `thread::sleep(1ms)` | ~1ms jitter artificiale encoder | `audio.rs` encoder |

### Budget latenza

```
Audio capture buffer:  10-20 ms
Opus encoding:         20 ms (frame size)
Network RTT:           20-100 ms ← collo di bottiglia principale
Opus decoding:         < 1 ms
Mixer/output buffer:   10-20 ms
─────────────────────────────
Total:                 ~60-160 ms
```

Target ideale < 30ms, accettabile < 60ms, limite superiore ~100ms. L'attuale è borderline-OK per jam session ma non per performance live professionali.

---

## 8. PIANO IMPLEMENTATIVO DETTAGLIATO

### LEGENDA PRIORITÀ
- 🔴 **P0 — CRITICO:** bloccante per qualsiasi deploy, va fatto SUBITO
- 🟠 **P1 — ALTO:** necessario per produzione imminente
- 🟡 **P2 — MEDIO:** hardening, qualità, test
- 🟢 **P3 — BASSO:** nice-to-have, già in roadmap

---

### 🔴 P0.1 — Creare CI/CD workflow `.github/workflows/build.yml`

**PERCHÉ:** README, ROADMAP e system-overview dichiarano "CI/CD ✅ Configured" ma la directory `.github/` NON ESISTE. È il gap più grave: ogni push e PR sono senza verifica automatica. La doc "vende" più di quanto il repo contenga.

**COSA:** Creare `jam-p2p/.github/workflows/build.yml` con:
- Build matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`
- Step: checkout → setup Node 20 → `npm ci` in `jam-gui` → `npm test` (vitest) → setup Rust → `cargo test` in `jam-gui/src-tauri` → `cargo build --release`
- Trigger: push su `main`, PR, tag `v*`
- Release: su tag `v*`, upload artifacts (`.deb`, `.AppImage`, `.dmg`, `.msi`, `.exe`) come GitHub Release
- `cargo audit` e `npm audit` come step aggiuntivi

**COME:**

1. Creare directory:
```bash
mkdir -p .github/workflows
```

2. Creare `.github/workflows/build.yml`:

```yaml
name: Build & Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: jam-gui/package-lock.json
      - run: npm ci
        working-directory: jam-gui
      - run: npm test
        working-directory: jam-gui
      - run: npm run lint
        working-directory: jam-gui

  rust-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt update && sudo apt install -y libasound2-dev libgtk-3-dev libwebkit2gtk-4.1-dev
      - run: cargo test
        working-directory: jam-gui/src-tauri

  build:
    needs: [frontend-test, rust-test]
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: jam-gui/package-lock.json
      - run: npm ci
        working-directory: jam-gui
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Linux deps
        if: runner.os == 'Linux'
        run: sudo apt update && sudo apt install -y libasound2-dev libgtk-3-dev libwebkit2gtk-4.1-dev
      - run: npm run tauri build
        working-directory: jam-gui
      - uses: actions/upload-artifact@v4
        with:
          name: jam-p2p-${{ matrix.target }}
          path: jam-gui/src-tauri/target/release/bundle/

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            jam-p2p-*/**/*
```

3. Aggiornare `README.md` e `ROADMAP.md` per riflettere che la CI ora esiste davvero.

**VERIFICA:** Pushare su GitHub e controllare che la Actions parta e completi con successo.

---

### 🔴 P0.2 — E2E Audio Test

**PERCHÉ:** L'unica funzione core del prodotto — lo streaming audio tra 2+ peer — non è MAI stata verificata end-to-end. Il codice backend c'è tutto, ma nessuno ha mai lanciato 2 istanze dell'app per verificare che l'audio passi davvero. È il rischio funzionale n.1.

**COSA:** Avviare 2+ istanze di `tauri dev`, unirle alla stessa stanza sul signaling server, e verificare che:
1. I peer si vedano (evento `peer-joined` con nome)
2. I VU meter reagiscano al microfono
3. L'audio in uscita (speakers) contenga l'audio dell'altro peer
4. La latenza percepita sia accettabile (< 160ms)

**COME:**

1. Terminale 1 — avviare signaling server:
```bash
cd jam-signaler && npm install && npm start
```

2. Terminale 2 — avviare prima istanza app:
```bash
cd jam-gui && npm run tauri dev
```
- Inserire nome "Alice", stanza "test-e2e", cliccare Connect

3. Terminale 3 — avviare seconda istanza app:
```bash
cd jam-gui && npm run tauri dev
```
- Inserire nome "Bob", stanza "test-e2e", cliccare Connect

4. Verifiche manuali:
- Alice vede Bob nella peer list? (peer-joined con nome "Bob")
- Bob vede Alice nella peer list? (peer-joined con nome "Alice")
- Parlando nel microfono di Alice, il VU meter local di Alice si anima?
- Il VU meter di Bob (peer-level per Alice) si anima su Bob?
- L'audio di Alice esce dalle casse di Bob?
- La latenza percepita è accettabile?

5. Documentare il risultato in `docs/testing/E2E-AUDIO-RESULTS.md` con data, build, OS, e osservazioni.

---

### 🔴 P0.3 — Allineare README e documentazione

**PERCHÉ:** 8 disallineamenti documentati tra ciò che la doc dichiara e ciò che il codice fa realmente. Genera confusione e mina la fiducia nella documentazione.

**COSA:** Correggere: conteggi test (30+6, non 23+5), payload `peer-joined` (oggetto `{id,name}`, non stringa), eventi Tauri (7, non 5), conteggio componenti, API `/room/:name` (solo `peerCount`), stato CI/CD (ora esiste davvero dopo P0.1).

**COME:**

Modifiche a `README.md`:

1. Sezione "Tauri Events" — cambiare:
```
| `peer-joined` | `string` | New peer connected |
```
in:
```
| `peer-joined` | `{ id: string, name: string }` | New peer connected |
```
E aggiungere le due righe mancanti:
```
| `connected` | — | (Re)connected to signaling server (after Welcome) |
| `server-error` | `string` | Server-side error message |
```
Cambiare "5 event listeners" in "7 event listeners".

2. Sezione "Tauri Commands" — `leave_room` togliere "guards: must be connected" perché la guard è stata rimossa (reso idempotente):
```
| `leave_room` | — | `Result<(), String>` | Leave current room (idempotent — can be called anytime) |
```

3. Sezione "Testing" — cambiare "23 unit tests" in "30 unit tests (23 audio + 7 wire protocol)", "5 rendering tests" in "6 rendering tests".

4. Sezione "Component Architecture" — il diagramma dice "5 Tauri event listeners", cambiare in "7 Tauri event listeners".

5. Sezione "Frontend" — `useTauriEvents()` descrizione: "Hook managing 5 Tauri event listeners" → "Hook managing 7 Tauri event listeners". Aggiungere `connected`, `serverError` ai campi ritornati.

6. Sezione "Roadmap" — "CI/CD" va tenuto ma solo se P0.1 è stato completato. Altrimenti cambiare "✅ Complete" in "⏳ To verify" o rimuovere.

7. Sezione "Signaling Server > HTTP API" — `/room/:name` descrizione: cambiare "Room info (peer count, peer IDs)" in "Room info (peer count only)".

8. Data "Last updated" in fondo: cambiare `2026-06-16` in `2026-06-21`.

Modifiche a `ROADMAP.md`:
- Riga "CI/CD pipeline | ✅ Configured": se P0.1 completato, lasciare ✅; altrimenti cambiare in "⏳ Da creare".

Modifiche a `docs/architecture/system-overview.md`:
- Riga "Tauri Events" tabella: `peer-joined | string` → `peer-joined | { id, name }`
- Aggiungere eventi mancanti: `connected`, `server-error`, `reconnected`
- Riga "HTTP API" tabella: `/room/:name` response: `{ room, peerCount, peers: [...] }` → `{ room, peerCount }`
- Aggiungere nota "Last Updated: 2026-06-21"

---

### 🟠 P1.1 — Rimuovere dipendenze Rust morte da Cargo.toml

**PERCHÉ:** `url`, `uuid`, `once_cell`, `rand` sono dichiarate in `Cargo.toml` ma MAI usate nel codice (verificato con grep su tutto `src-tauri/src/`). Aumentano tempo di compilazione, superficie d'attacco, e dimensione binaria.

**COSA:** Rimuovere le 4 dipendenze da `jam-gui/src-tauri/Cargo.toml` e verificare che il progetto compili ancora.

**COME:**

1. Verifica che non siano usate:
```bash
cd jam-gui/src-tauri
grep -r "use url" src/         # nessun risultato
grep -r "use uuid" src/        # nessun risultato
grep -r "use once_cell" src/   # nessun risultato
grep -r "use rand" src/        # nessun risultato
```

2. Modificare `jam-gui/src-tauri/Cargo.toml`, rimuovere queste righe:
```toml
url = "2.5"
uuid = { version = "1.7", features = ["v4", "serde"] }
once_cell = "1.19"
rand = "0.8"
```

3. Verificare che compili:
```bash
cd jam-gui/src-tauri && cargo check
```

---

### 🟠 P1.2 — Rimuovere artefatti build da git

**PERCHÉ:** `test_standalone/target/` è tracciato in git (8 file binari). Sono artefatti di build committati per errore prima della regola `.gitignore`. Appesantiscono il repo inutilmente.

**COSA:** Rimuovere i file dal tracking git mantenendoli su disco localmente.

**COME:**

```bash
cd jam-p2p
git rm -r --cached test_standalone/target/
git commit -m "chore: remove tracked build artifacts from test_standalone/target/"
```

Nota: se `test_standalone/` non ha più alcun sorgente (solo `target/`), considerare di rimuovere l'intera directory o aggiungere il sorgente mancante.

---

### 🟠 P1.3 — Completare `.env.example`

**PERCHÉ:** `server.js` supporta `MAX_PEERS_PER_ROOM`, `MAX_ROOMS`, `ALLOWED_ORIGIN` come variabili d'ambiente ma `.env.example` documenta solo `PORT` e `LOG_LEVEL`. Un nuovo utente non sa che esistono queste variabili.

**COSA:** Aggiungere le variabili mancanti a `jam-signaler/.env.example`.

**COME:**

Modificare `jam-signaler/.env.example`, aggiungere dopo le righe esistenti:

```env
# DoS protection: max peers per room (default 8)
MAX_PEERS_PER_ROOM=8

# DoS protection: max concurrent rooms (default 500)
MAX_ROOMS=500

# CORS: allowed origin for HTTP endpoints. Use specific origin in production.
# Default: * (all origins)
ALLOWED_ORIGIN=*
```

---

### 🟠 P1.4 — Tradurre commenti italiani residui

**PERCHÉ:** ROADMAP Phase 7 dichiara "Italian error messages → English ✅" ma restano commenti in italiano in 2 file. Incoerenza linguistica.

**COSA:** Tradurre i commenti italiani in inglese.

**COME:**

1. `jam-signaler/Dockerfile` — ci sono ~4 righe di commenti in italiano. Tradurre in inglese.

2. `jam-gui/src-tauri/src/logger.rs:4` — tradurre il commento.

---

### 🟠 P1.5 — `mpsc::channel(N)` bounded per WsEvent e SignalMessage

**PERCHÉ:** Tutti i canali interni usano `mpsc::unbounded_channel()`. Se un producer è più veloce del consumer (es. burst di messaggi WebSocket), la memoria cresce illimitatamente. Per produzione servono canali bounded con backpressure.

**COSA:** Sostituire `mpsc::unbounded_channel()` con `mpsc::channel(256)` per `ws_in_tx`/`ws_in_rx`, `ws_event_tx`/`ws_event_rx`, e `sig_tx`/`sig_rx` in `main.rs`.

**COME:**

1. In `jam-gui/src-tauri/src/main.rs`, cambiare:
```rust
// DA:
let (sig_tx, mut sig_rx) = mpsc::unbounded_channel::<SignalMessage>();
let (ws_in_tx, mut ws_in_rx) = mpsc::unbounded_channel::<String>();
let (ws_event_tx, mut ws_event_rx) = mpsc::unbounded_channel::<WsEvent>();
```
```rust
// A:
let (sig_tx, mut sig_rx) = mpsc::channel::<SignalMessage>(256);
let (ws_in_tx, mut ws_in_rx) = mpsc::channel::<String>(256);
let (ws_event_tx, mut ws_event_rx) = mpsc::channel::<WsEvent>(256);
```

2. In `jam-gui/src-tauri/src/signaling.rs`, cambiare i tipi dei campi:
```rust
// DA: pub ws_in_tx: mpsc::UnboundedSender<String>,
// A:  pub ws_in_tx: mpsc::Sender<String>,

// DA: pub sig_tx: mpsc::UnboundedSender<SignalMessage>,
// A:  pub sig_tx: mpsc::Sender<SignalMessage>,

// DA: pub ws_event_tx: mpsc::UnboundedSender<WsEvent>,
// A:  pub ws_event_tx: mpsc::Sender<WsEvent>,
```

3. In `jam-gui/src-tauri/src/webrtc.rs`, cambiare:
```rust
// DA: pub sig_tx: mpsc::UnboundedSender<SignalMessage>,
// A:  pub sig_tx: mpsc::Sender<SignalMessage>,
```

4. In `jam-gui/src-tauri/src/state.rs`, il tipo `tx: Mutex<mpsc::UnboundedSender<AppCommand>>` può restare `unbounded` perché `AppCommand` è a basso volume (comandi UI). Ma per coerenza, bounded con 64 va bene:
```rust
// DA: pub tx: Mutex<mpsc::UnboundedSender<AppCommand>>,
// A:  pub tx: Mutex<mpsc::Sender<AppCommand>>,
```
E in `init_state`:
```rust
// DA: pub fn init_state(tx: mpsc::UnboundedSender<AppCommand>) -> ...
// A:  pub fn init_state(tx: mpsc::Sender<AppCommand>) -> ...
```
E in `main.rs`:
```rust
// DA: let (tx, rx) = mpsc::unbounded_channel::<AppCommand>();
// A:  let (tx, rx) = mpsc::channel::<AppCommand>(64);
```

5. L'`rx` in `main.rs` cambia tipo da `UnboundedReceiver` a `Receiver`, che ha `.recv()` async (invece di sync). Nel `tokio::select!`, `rx.recv()` restituisce `Option<AppCommand>` come prima, quindi nessun cambiamento alla logica.

6. Verificare compilazione: `cd jam-gui/src-tauri && cargo check`

---

### 🟡 P2.1 — Refactor `server.js` in moduli

**PERCHÉ:** `server.js` è un monolite di 280 righe con 5 responsabilità mescolate: validazione messaggi, rate limiting, gestione stanze, HTTP API, WebSocket handler. Renderlo modulare migliora testabilità, manutenibilità e leggibilità.

**COSA:** Estrarre 3 moduli: `lib/validation.js` (validateMessage), `lib/rate-limit.js` (checkHttpRateLimit), `lib/rooms.js` (removePeerFromRoom, room management).

**COME:**

1. Creare `jam-signaler/lib/validation.js`:
```js
// Message validation
const VALID_MESSAGE_TYPES = new Set(['Join', 'Leave', 'Offer', 'Answer', 'Ice']);
const MAX_ROOM_NAME_LENGTH = 64;
const MAX_NAME_LENGTH = 32;

function validateMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!VALID_MESSAGE_TYPES.has(message.type)) return false;

  switch (message.type) {
    case 'Join':
      return (
        message.data &&
        typeof message.data.room === 'string' &&
        message.data.room.trim().length > 0 &&
        message.data.room.length <= MAX_ROOM_NAME_LENGTH &&
        (message.data.name === undefined ||
          (typeof message.data.name === 'string' &&
            message.data.name.length <= MAX_NAME_LENGTH))
      );
    case 'Leave':
      return true;
    case 'Offer':
    case 'Answer':
      return (
        message.data &&
        typeof message.data.target === 'string' &&
        typeof message.data.sdp === 'string'
      );
    case 'Ice':
      return (
        message.data &&
        typeof message.data.target === 'string' &&
        typeof message.data.candidate === 'string'
      );
    default:
      return false;
  }
}

module.exports = { validateMessage, VALID_MESSAGE_TYPES, MAX_ROOM_NAME_LENGTH, MAX_NAME_LENGTH };
```

2. Creare `jam-signaler/lib/rate-limit.js`:
```js
// HTTP rate limiting
const httpRateMap = new Map(); // ip -> { count, windowStart }

function checkHttpRateLimit(ip, limit = 100) {
  const now = Date.now();
  let entry = httpRateMap.get(ip);
  if (!entry || now - entry.windowStart > 1000) {
    entry = { count: 0, windowStart: now };
    httpRateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

// Periodic cleanup of stale entries
function startRateLimitCleanup(intervalMs = 10000, maxAge = 5000) {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of httpRateMap) {
      if (now - entry.windowStart > maxAge) httpRateMap.delete(ip);
    }
  }, intervalMs);
}

module.exports = { checkHttpRateLimit, startRateLimitCleanup, httpRateMap };
```

3. Creare `jam-signaler/lib/rooms.js`:
```js
const WebSocket = require('ws');

function removePeerFromRoom(ws, uuid, room, rooms, logger) {
  if (!room || !rooms.has(room)) return;
  const roomPeers = rooms.get(room);
  roomPeers.delete(uuid);
  roomPeers.forEach((peerWs) => {
    if (peerWs.readyState === WebSocket.OPEN) {
      peerWs.send(JSON.stringify({ type: 'PeerLeft', data: { uuid } }));
    }
  });
  if (roomPeers.size === 0) rooms.delete(room);
  if (logger) logger.info({ uuid, room }, 'Peer removed from room');
}

module.exports = { removePeerFromRoom };
```

4. Aggiornare `server.js` per importare dai moduli invece di avere tutto inline. Il file `server.js` si riduce a ~160 righe e diventa un orchestratore pulito.

5. Aggiungere test unit per `validateMessage` e `checkHttpRateLimit`:
```bash
cd jam-signaler && npm install --save-dev jest
```
Creare `jam-signaler/lib/__tests__/validation.test.js` e `rate-limit.test.js`.

---

### 🟡 P2.2 — Refactor `webrtc.rs` estraendo factory e handler

**PERCHÉ:** `webrtc.rs` è 299 righe in un unico file. `handle_signal` è 127 righe con 10 rami match. `create_peer_connection` è 118 righe con 4 callback inline. Estrarre in moduli dedicati migliora testabilità e leggibilità.

**COSA:** Estrarre:
- `peer_connection.rs` — `create_peer_connection` factory con setup callback
- `ice_handlers.rs` — ICE candidate gathering e invio
- `track_handlers.rs` — on_track callback: decoder + ring buffer + VU

**COME:**

1. Creare `jam-gui/src-tauri/src/peer_connection.rs`:
```rust
// Trasferire qui la funzione create_peer_connection e i tipi correlati
// da webrtc.rs con le callback on_peer_connection_state_change,
// on_track, e on_ice_candidate
```

2. Creare `jam-gui/src-tauri/src/track_handlers.rs`:
```rust
// Estrarre la logica del on_track callback:
// - Opus decoder init
// - Ring buffer per-peer
// - Mixer insert
// - VU computation e throttling
```

3. `webrtc.rs` si riduce a ~100 righe: `WebrtcContext`, `PeerManager` struct, `new()`, `close_all()`, e `handle_signal` (che ora chiama `peer_connection::create_peer_connection`).

4. Aggiungere `mod peer_connection;` e `mod track_handlers;` in `main.rs`.

---

### 🟡 P2.3 — Refactor `App.tsx` con `useReducer`

**PERCHÉ:** `App.tsx` ha 8 `useState` separati (room, name, server, status, error, muted, bitrate, settingsOpen) e 3 `useEffect` quasi identici (disconnected, reconnected, serverError). Un `useReducer` centralizza la state machine della sessione e riduce prop-drilling e duplicazione.

**COSA:** Sostituire 8 `useState` con 1 `useReducer` che gestisce lo stato della sessione. Estrarre logica keyboard shortcut in hook dedicato `useKeyboardShortcuts`.

**COME:**

1. Definire lo stato e le azioni:
```typescript
type SessionState = {
  room: string;
  name: string;
  server: string;
  status: 'idle' | 'joining' | 'connected' | 'reconnecting' | 'error';
  error: string | null;
  muted: boolean;
  bitrate: number;
  settingsOpen: boolean;
};

type SessionAction =
  | { type: 'SET_ROOM'; room: string }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_SERVER'; server: string }
  | { type: 'SET_STATUS'; status: SessionState['status'] }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'SET_BITRATE'; bitrate: number }
  | { type: 'TOGGLE_SETTINGS' };
```

2. Creare `sessionReducer` con la logica di transizione.

3. In `App.tsx`, sostituire tutti i `useState` con:
```typescript
const [session, dispatch] = useReducer(sessionReducer, initialState);
```

4. Estrarre `useKeyboardShortcuts` hook:
```typescript
function useKeyboardShortcuts(
  status: string,
  onToggleMute: () => void,
  onDisconnect: () => void
) {
  useEffect(() => {
    if (status !== 'connected') return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onToggleMute();
      }
      if (
        (e.ctrlKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) ||
        e.key === 'Escape'
      ) {
        e.preventDefault();
        onDisconnect();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, onToggleMute, onDisconnect]);
}
```

---

### 🟡 P2.4 — Modularizzare `App.css`

**PERCHÉ:** `App.css` è 740 righe monolitico. Con l'aumentare dei componenti diventa ingestibile. CSS Modules o files separati per componente migliorano manutenibilità.

**COSA:** Creare `ConnectionForm.css`, `PeerCard.css`, `VuMeter.css`, `StatusBar.css`, `SettingsPanel.css`, `LocalMicCard.css`, `App.css` (solo layout globale). Importare ogni CSS nel rispettivo componente.

**COME:**

1. Identificare le classi CSS per ogni componente:
- `.connection-form`, `.input-group`, `.input-label`, `.input-field`, `.connect-btn` → `ConnectionForm.css`
- `.peer-card`, `.peer-header`, `.volume-control`, `.volume-slider-wrapper` → `PeerCard.css`
- `.level-meter`, `.level-bar`, `.green`, `.yellow`, `.red` → `VuMeter.css`
- `.status-indicator`, `.status-dot`, `.quality-badge` → `StatusBar.css`
- `.settings-panel`, `.bitrate-control`, `.bitrate-slider` → `SettingsPanel.css`
- `.local-mic-card`, `.local-level-label` → `LocalMicCard.css`

2. In ogni componente, aggiungere `import './ComponentName.css';`

3. In `App.css`, tenere solo: `.app-container`, `.bg-grid`, `.glow-orb`, `.content-wrapper`, `.logo-section`, `.main-card`, `.mixer-section`, `.reconnecting-panel`, `.error-box`, `.empty-state`, `.peers-list`.

4. Verificare che il frontend compili e renderizzi correttamente: `cd jam-gui && npm run dev` e ispezione visuale.

---

### 🟡 P2.5 — Aggiungere test interazione React

**PERCHÉ:** I 6 test attuali (`App.test.tsx`) verificano solo rendering statico. Zero test su interazioni reali: connect, disconnect, toggle mute, bitrate change, keyboard shortcuts.

**COSA:** Aggiungere almeno 5 test di interazione con `fireEvent` e mock di `invoke`.

**COME:**

Aggiungere a `App.test.tsx`:

```typescript
it("calls invoke join_room when clicking connect", async () => {
  render(<App />);
  const btn = screen.getByText("Connect to Session");
  fireEvent.click(btn);
  expect(invoke).toHaveBeenCalledWith("join_room", expect.objectContaining({
    room: "studio1",
    server: "ws://localhost:8080",
  }));
});

it("shows connecting state when join is in progress", async () => {
  // mock invoke to not resolve immediately
  (invoke as any).mockReturnValue(new Promise(() => {}));
  render(<App />);
  fireEvent.click(screen.getByText("Connect to Session"));
  expect(screen.getByText("Connecting")).toBeTruthy();
});

it("shows error when join_room fails", async () => {
  (invoke as any).mockRejectedValueOnce("Connection refused");
  render(<App />);
  fireEvent.click(screen.getByText("Connect to Session"));
  await waitFor(() => {
    expect(screen.getByText("ERROR")).toBeTruthy();
    expect(screen.getByText("Connection refused")).toBeTruthy();
  });
});

it("calls invoke set_muted when toggling mute", async () => {
  // setup: simulate connected state
  // ... render con status connesso e mock events
  // click mute button
  // expect invoke to have been called with set_muted
});

it("calls invoke leave_room when clicking disconnect", async () => {
  // setup: simulate connected state
  // click disconnect
  // expect invoke to have been called with leave_room
});
```

---

### 🟡 P2.6 — Test unit signaling server

**PERCHÉ:** Il signaling server ha ZERO test automatici. Solo 6 script manuali in `docs/testing/scripts/`. `validateMessage`, rate limiting, room caps, peer join/leave non sono testati in isolamento.

**COSA:** Aggiungere test unit con Jest per: `validateMessage` (tutti i tipi, edge case), `checkHttpRateLimit`, `removePeerFromRoom`. Test di integrazione per il flusso Join → PeerList → NewPeer → Leave.

**COME:**

1. Installare Jest nel signaling:
```bash
cd jam-signaler && npm install --save-dev jest
```

2. Aggiornare `package.json`:
```json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch"
}
```

3. Creare `jam-signaler/lib/__tests__/validation.test.js`:
```js
const { validateMessage } = require('../validation');

describe('validateMessage', () => {
  it('rejects null/undefined', () => {
    expect(validateMessage(null)).toBe(false);
    expect(validateMessage(undefined)).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(validateMessage({ type: 'Unknown' })).toBe(false);
  });

  it('validates Join with room', () => {
    expect(validateMessage({ type: 'Join', data: { room: 'test' } })).toBe(true);
  });

  it('rejects Join without room', () => {
    expect(validateMessage({ type: 'Join', data: {} })).toBe(false);
  });

  it('rejects Join with empty room', () => {
    expect(validateMessage({ type: 'Join', data: { room: '  ' } })).toBe(false);
  });

  it('validates Join with name', () => {
    expect(validateMessage({ type: 'Join', data: { room: 'test', name: 'Alice' } })).toBe(true);
  });

  it('rejects Join with name too long', () => {
    expect(validateMessage({ type: 'Join', data: { room: 'test', name: 'A'.repeat(33) } })).toBe(false);
  });

  it('rejects Join with room too long', () => {
    expect(validateMessage({ type: 'Join', data: { room: 'A'.repeat(65) } })).toBe(false);
  });

  it('validates Offer with target and sdp', () => {
    expect(validateMessage({ type: 'Offer', data: { target: 'uuid', sdp: '...' } })).toBe(true);
  });

  it('rejects Offer without sdp', () => {
    expect(validateMessage({ type: 'Offer', data: { target: 'uuid' } })).toBe(false);
  });

  it('validates Ice with target and candidate', () => {
    expect(validateMessage({ type: 'Ice', data: { target: 'uuid', candidate: '...' } })).toBe(true);
  });

  it('validates Leave', () => {
    expect(validateMessage({ type: 'Leave' })).toBe(true);
  });
});
```

4. Creare `jam-signaler/lib/__tests__/rate-limit.test.js`:
```js
const { checkHttpRateLimit } = require('../rate-limit');

describe('checkHttpRateLimit', () => {
  it('allows first request', () => {
    expect(checkHttpRateLimit('1.2.3.4', 100)).toBe(true);
  });

  it('allows up to limit', () => {
    for (let i = 0; i < 99; i++) checkHttpRateLimit('1.2.3.5', 100);
    expect(checkHttpRateLimit('1.2.3.5', 100)).toBe(true);
  });

  it('rejects above limit', () => {
    for (let i = 0; i < 100; i++) checkHttpRateLimit('1.2.3.6', 100);
    expect(checkHttpRateLimit('1.2.3.6', 100)).toBe(false);
  });
});
```

---

### 🟡 P2.7 — WS rate-limit per IP (oltre per-connection)

**PERCHÉ:** Attualmente il rate limiting WebSocket è solo per-connessione (50 msg/s per WS). Un attaccante può aprire 1000 connessioni dallo stesso IP, ognuna con il suo rate limit → 50,000 msg/s totali. Serve un rate limit per IP a monte del handshake WS.

**COSA:** Aggiungere un `wsRateMap` (simile a `httpRateMap`) che limita il numero di connessioni WS per IP.

**COME:**

In `server.js`, aggiungere prima di `wss.on('connection', ...)`:

```js
// WS connection rate limiting per IP
const wsRateMap = new Map(); // ip -> { count, windowStart }
const WS_CONNECT_LIMIT = 10; // max 10 connections per second per IP

function checkWsRateLimit(ip) {
  const now = Date.now();
  let entry = wsRateMap.get(ip);
  if (!entry || now - entry.windowStart > 1000) {
    entry = { count: 0, windowStart: now };
    wsRateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= WS_CONNECT_LIMIT;
}
```

Nel handler `connection`:
```js
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!checkWsRateLimit(clientIp)) {
    logger.warn({ ip: clientIp }, 'WS connection rate limit exceeded');
    ws.close(1013, 'Too many connections');
    return;
  }
  // ... resto del handler
});
```

---

### 🟢 P3.1 — Migrare a `parking_lot::Mutex` per il mixer

**PERCHÉ:** `std::sync::Mutex` sul mixer (`MixerMap`) è teoricamente unsafe su RT thread perché può fare syscall `futex` anche in `try_lock`. `parking_lot::Mutex` ha un fast-path lockless e non fa syscall, quindi è veramente RT-safe.

**COSA:** Sostituire `std::sync::Mutex` con `parking_lot::Mutex` per `MixerMap` e `saved_volumes`.

**COME:**

1. Aggiungere a `Cargo.toml`:
```toml
parking_lot = "0.12"
```

2. In `audio.rs`:
```rust
// DA: use std::sync::Mutex;
// A:  use parking_lot::Mutex;

// DA: pub mixer_sources: Arc<Mutex<MixerMap>>,
// A:  pub mixer_sources: Arc<Mutex<MixerMap>>,  // invariato, cambia solo il crate
```

3. In tutti i punti dove si usa `.lock()` → `.lock()` (stessa API), `.try_lock()` → `.try_lock()` (stessa API):
```rust
// DA: if let Ok(mut sources) = mixer_injector.try_lock() {
// A:  if let Some(mut sources) = mixer_injector.try_lock() {
```
Nota: `parking_lot::Mutex::try_lock()` restituisce `Option<MutexGuard>` invece di `Result<MutexGuard, TryLockError>`. Quindi `Ok(sources)` → `Some(sources)`.

4. Stessa modifica per `saved_volumes` in `main.rs`.

---

### 🟢 P3.2 — Pool allocator per PCM decoder buffer

**PERCHÉ:** `webrtc.rs` decoder callback alloca `vec![0f32; samples_per_frame * 2]` per ogni track ricevuto (~50 pacchetti/s × N peer). Con 8 peer sono 400 allocazioni/s evitabili.

**COSA:** Usare un buffer riutilizzabile o un pool semplice. L'approccio più semplice è un `Vec<f32>` con `.resize()` invece di riallocare.

**COME:**

Attualmente in `webrtc.rs` nel callback `on_track`:
```rust
let mut pcm = vec![0f32; samples_per_frame * 2];
// ...
while let Ok((rtp, _)) = track.read_rtp().await {
    if let Ok(len) = dec.decode_float(&rtp.payload, &mut pcm, false) {
        // ...
    }
}
```

Il buffer `pcm` è già dichiarato FUORI dal loop `while`, quindi viene allocato UNA volta per track. **In realtà non c'è riallocazione per frame**, solo una allocazione all'inizio della track. 

**Quindi questa "ottimizzazione" è già implementata correttamente.** I report delle analisi hanno sovrastimato il problema. Il buffer `pcm` viene allocato una volta per track (quando un peer si connette) e riutilizzato per tutti i pacchetti successivi. L'unico miglioramento possibile è pre-allocare con `vec!` invece di `Vec::with_capacity` + `resize` ma il comportamento è equivalente.

**Azione corretta:** Verificare e documentare che l'allocazione è già once-per-track, non per-packet.

---

### 🟢 P3.3 — `BytesMut` riusato nell'encoder

**PERCHÉ:** `audio.rs` encoder alloca `bytes::Bytes::copy_from_slice(&out_buf[..len])` per ogni frame (~50/s). `BytesMut` riusato evita questa allocazione.

**COSA:** Usare `BytesMut` con `.resize()` invece di `Bytes::copy_from_slice()`.

**COME:**

In `audio.rs::start_encoder_thread`:
```rust
// DA:
let mut out_buf = [0u8; 1024];
// ...
payload: bytes::Bytes::copy_from_slice(&out_buf[..len]),

// A:
use bytes::BytesMut;
let mut out_buf = [0u8; 1024];
let mut payload_buf = BytesMut::with_capacity(1024);
// ...
payload_buf.clear();
payload_buf.extend_from_slice(&out_buf[..len]);
let payload = payload_buf.split().freeze();
// usa `payload` nel packet RTP
```

---

### 🟢 P3.4 — Debounce volume slider

**PERCHÉ:** Il volume slider in `PeerCard.tsx` invoca `set_volume` a OGNI keystroke del range input. Con un mouse drag veloce può generare 100+ chiamate IPC in un secondo. Il backend già gestisce bene (è una semplice HashMap update), ma è overhead evitabile.

**COSA:** Debounce di 50ms sull'invio di `set_volume` al backend. L'UI resta ottimistica (aggiorna subito lo stato React).

**COME:**

In `App.tsx`, modificare `onVolumeChange`:
```typescript
const debouncedSetVolume = useMemo(() => {
  const timers = new Map<string, number>();
  return (peerId: string, vol: number) => {
    // Update UI immediately (optimistic)
    updatePeerVolume(peerId, vol);
    // Debounce backend call
    if (timers.has(peerId)) clearTimeout(timers.get(peerId));
    timers.set(peerId, window.setTimeout(() => {
      invoke("set_volume", { peerId, vol }).catch(console.warn);
      timers.delete(peerId);
    }, 50));
  };
}, [updatePeerVolume]);
```

---

### 🟢 P3.5 — Sostituire `thread::sleep(1ms)` nell'encoder con `Condvar`

**PERCHÉ:** Quando il mic ring buffer è vuoto, l'encoder thread fa `thread::sleep(Duration::from_millis(1))` per evitare busy-looping. Questo aggiunge fino a 1ms di jitter artificiale. Una soluzione più pulita è usare `ringbuf` con blocking pop o un `Condvar`.

**COSA:** Usare `ringbuf::HeapRb` con `pop()` bloccante invece di `try_pop()` + sleep.

**ALTERNATIVA PIÙ SEMPLICE:** Dato che l'impatto di 1ms di sleep è trascurabile nel contesto di un frame Opus da 20ms e il codice è già corretto e semplice, valutare se vale la pena la complessità aggiuntiva di un `Condvar`. Il jitter di 1ms è 1/20 della frame size — impercettibile.

**Raccomandazione:** Rinviare a post-MVP. Non è un collo di bottiglia reale.

---

### 🟢 P3.6 — Aggiungere `cargo audit` e `npm audit` al CI

**PERCHÉ:** 18+ dipendenze Rust e 13+ dipendenze frontend non vengono mai scansionate per vulnerabilità note. `cargo audit` e `npm audit` sono strumenti standard che dovrebbero girare in CI.

**COSA:** Dopo P0.1 (CI creato), aggiungere step `cargo audit` e `npm audit` al workflow.

**COME:**

Nel `.github/workflows/build.yml`, aggiungere:
```yaml
- name: Security audit (Rust)
  run: cargo audit
  working-directory: jam-gui/src-tauri
  continue-on-error: true  # non blocca la build, ma notifica

- name: Security audit (npm)
  run: npm audit
  working-directory: jam-gui
  continue-on-error: true
```

Installare `cargo-audit` se non presente:
```bash
cargo install cargo-audit
```

---

### 🟢 P3.7 — `WeakMap` invece di monkey-patching `ws.displayName`

**PERCHÉ:** `server.js` fa `ws.displayName = name` — monkey-patching di un oggetto della libreria `ws`. Rischio di collisione se `ws` aggiungesse una proprietà `displayName` in futuro.

**COSA:** Usare una `WeakMap<WebSocket, { uuid, room, displayName }>` invece di proprietà dirette su `ws`.

**COME:**

```js
// DA:
ws.displayName = name;
peers.set(ws, { uuid: userUuid, room });

// A:
const peerMeta = new WeakMap(); // ws -> { uuid, room, displayName }
peerMeta.set(ws, { uuid: userUuid, room: currentRoom, displayName: name });
```

Poi usare `peerMeta.get(ws)` ovunque invece di `peers.get(ws)` e `ws.displayName`.

---

## 9. ROADMAP OPERATIVA

```
SPRINT 1 (1 settimana) — Fondamenta
├── P0.1: CI/CD workflow (.github/workflows/build.yml)
├── P0.3: Allineare README/ROADMAP/system-overview
├── P1.1: Rimuovere dep Rust morte (url, uuid, once_cell, rand)
├── P1.2: Rimuovere test_standalone/target da git
├── P1.3: Completare .env.example
└── P1.4: Tradurre commenti italiani

SPRINT 2 (1-2 settimane) — Stabilità e sicurezza
├── P0.2: E2E audio test (2+ istanze)
├── P1.5: mpsc bounded per WsEvent/SignalMessage
├── P2.7: WS rate-limit per IP
└── P3.6: cargo audit + npm audit nel CI

SPRINT 3 (1-2 settimane) — Qualità codice e test
├── P2.5: Test interazione React (5+ test)
├── P2.6: Test unit signaling server (Jest)
├── P2.1: Refactor server.js in moduli
└── P2.2: Refactor webrtc.rs

SPRINT 4 (1-2 settimane) — Refactor frontend e performance
├── P2.3: Refactor App.tsx con useReducer
├── P2.4: Modularizzare App.css
├── P3.1: parking_lot::Mutex per mixer
├── P3.3: BytesMut riusato nell'encoder
└── P3.4: Debounce volume slider

SPRINT 5+ — Roadmap Phase 9 (produzione)
├── WSS signaling (TLS via reverse proxy)
├── Room authentication (token/password)
├── TURN server proprio (coturn)
├── Audio device selection UI
├── Jitter buffer adattivo
├── SFU topology per >6 peer
└── Adaptive bitrate + code signing
```

---

## 10. CONCLUSIONE

**Jam P2P** è un progetto di **qualità tecnica sorprendentemente alta** per la sua fase. Le tre analisi indipendenti convergono su un verdetto unanime: **MVP eccellente, codice pulito e ben architettato, documentazione rara per qualità — ma non ancora production-ready.**

Con **5 sprint di lavoro** (8-10 settimane), il progetto passa da MVP solido a **prodotto production-grade**, pronto per jam session reali tra musicisti.

**Score finale ponderato: 7.5/10**

---

*Compendio generato da analisi incrociata di ANALISI_OPUS.md, ANALISI_COMPOSER.md, ANALISI_MINIMAX.md + analisi diretta del codebase. Data: 2026-06-21. Commit: 9cbe76a.*
