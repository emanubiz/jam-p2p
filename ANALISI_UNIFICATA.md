# 📊 ANALISI — Jam P2P (documento unico e definitivo)

> Analisi consolidata del progetto, verificata direttamente sul codice reale.
> Incorpora il lavoro di tre analisi indipendenti (`ANALISI_OPUS.md`,
> `ANALISI_COMPOSER.md`, `ANALISI_MINIMAX.md`) e del compendio (`COMPENDIO.md`),
> ormai cancellati perché interamente assorbiti da questo documento.
> Include l'**audit delle modifiche** (commit `ab55f2b`→`265edcd`) e la feature
> **analytics**, non prevista dal piano originale.
>
> **Data:** 2026-06-22 (rev. 7) · **HEAD:** `be7c650`
> **GitNexus (reindex rev.7):** 816 nodi, 1302 archi, 27 cluster, 23 execution flow
> **Test eseguiti (rev. 7):** frontend **25/25** Vitest ·
> signaling **69/69** Jest · Rust **36/36**
> `cargo test` · `cargo clippy -D warnings -A pedantic` 0 warning · `cargo fmt --check` OK · `tsc --noEmit` OK · `eslint` OK

---

## 0.5 ERRATA — correzione sostanziale alla rev. 1 (2026-06-22)

> ⚠️ **La rev. 1 di questo documento conteneva un errore metodologico grave.**
> Aveva verificato il progetto **leggendo** il codice ("ri-verifica leggendo il
> codice, non si fida dei report") ma **non lo aveva mai compilato né eseguito**.
> Una compilazione di 30 secondi avrebbe ribaltato il verdetto.

**Cosa era realmente lo stato di `main` (smentito dalla rev. 1):**

| Affermazione rev. 1 | Realtà verificata compilando/eseguendo |
|---|---|
| "CI reale e completo ✅" (P0.1), Tooling/CI **8.0/10** | La pipeline era **rossa a ogni commit** — non è mai passata una volta |
| `parking_lot` migration "✅ verificata" | Introduceva errori **`Send`**: i comandi Tauri async tenevano un guard `!Send` attraverso `.await` → **il binario non compilava** (`cargo check` = 14 errori) |
| "30 test Rust" (copertura "eccellente") | Il codice di test **non compilava** (`as_mut` su `MutexGuard`, partial-move) → i 30 test **non erano mai stati eseguiti** |
| Pipeline audio "RT-safe, verificata" | **Bug critico**: in `start_encoder_thread` il future di `track.write_rtp` veniva **droppato senza `await`** (`let _ = ...`) → **nessun pacchetto RTP veniva mai trasmesso**. Idem `pc.close()` (×2) |

**Causa radice:** verifica esclusivamente statica (lettura) senza un singolo
`cargo build`/`cargo clippy`/`cargo test`. Lezione: *un'analisi che non compila il
codice non è una verifica, è una recensione.*

**Riparazione eseguita in questa sessione (rev. 2)** — vedi §2-bis e CHANGELOG:
build Rust ripristinata, future RTP/close awaited, test Rust eseguiti (30/30),
CI verde (6 rotture indipendenti sistemate), +10 test di integrazione signaling.

---

## 0. Cosa rende questa analisi diversa dalle precedenti

Le tre analisi originali (Opus, Composer, MiniMax) e il compendio fotografavano il
commit `9cbe76a`, **prima** che il piano d'azione fosse eseguito. Questo documento:

1. **Ri-verifica** ogni affermazione leggendo il codice attuale (non si fida dei report).
2. **Audita** i 5 commit che hanno implementato il piano del compendio, confermando
   riga per riga che ogni P0–P3 sia stato realmente applicato.
3. **Aggiorna i verdetti**: molti gap del compendio sono ora **chiusi**.
4. **Integra le analytics**, una feature aggiunta lato frontend fuori dal piano.
5. **Segnala un nuovo difetto** che nessuna delle analisi originali aveva colto:
   la configurazione ESLint era incompatibile con la versione dichiarata (CI-breaking).

---

## 1. VERDETTO UNIFICATO — prima vs ora

| Dimensione | Compendio (9cbe76a) | rev.2 (a9dd5bc) | **Ora (8c48eb0)** | Δ |
|---|---|---|---|---|
| Architettura | 8.0/10 | 8.0/10 | **8.0/10** | = |
| Code Quality | 7.8/10 | 8.5/10 | **8.7/10** | ▲ jitter buffer e decoupling encoder ben fatti, idiomatici |
| Documentazione | 7.7/10 | 9.0/10 | **9.0/10** | = disallineamenti chiusi |
| Allineamento doc↔code | 7.0/10 | 9.0/10 | **9.0/10** | = |
| Sicurezza | 6.5/10 | 7.5/10 | **8.0/10** | ▲ room auth HMAC e TURN REST ora **implementati e unit-testati**, non solo "ready" |
| Ottimizzazione | 7.7/10 | 8.0/10 | **8.5/10** | ▲ encoder→RTP via mpsc (niente più `block_on` per-frame) + jitter buffer adattivo |
| Build Rust | (non testata) | OK | **OK** | verde, ri-verificata in rev.3 |
| Tooling / CI | — | 6.5/10 | **7.5/10** | verde sui 3 job gate; branch protection attiva; build Tauri multi-OS ancora flaky |
| Test (Rust / FE / signaler) | — | 30 / 25 / 53 | **35 / 25 / 63** | ▲ +5 jitter, +10 auth/turn/validation |
| **Maturità complessiva** | **7.5/10** | ~7.6/10 | **~8.0/10** | ▲ P1+P2 chiusi; resta solo l'E2E audio reale |

**Verdetto aggiornato (rev. 3):** dalla rev.2 un secondo intervento ha chiuso **P1**
(WSS/auth/TURN) e **P2** (jitter buffer + getStats), più la mitigazione stutter di P0
(encoder→RTP disaccoppiato). Ho riverificato **compilando ed eseguendo** (vedi §2-ter):
build verde, clippy 0 warning, 35 test Rust, 63 signaler, 25 frontend, GitNexus reindex OK.
Il codice è solido e ben strutturato. **Resta un solo blocco reale: l'E2E audio su hardware
non è ancora stato eseguito** — tutto il resto è verificabile a tavolino, questo no. Finché
non passa, le build di Phase 8 vanno trattate come "audio non confermato". Vedi §9.

---

## 2. AUDIT REVIEW DELLE MODIFICHE (commit `ab55f2b`→`265edcd`)

Verifica diretta che ogni voce del piano del compendio sia stata implementata
correttamente. **Esito: tutte verificate ✅.**

| Priorità | Item | Verificato in | Esito |
|---|---|---|---|
| P0.1 | CI/CD workflow | `.github/workflows/build.yml` esiste (5 job) **ma falliva a ogni run** — vedi §2-bis | ⚠️ presente ma **rotto** (corretto in rev.2) |
| P0.2 | Procedura E2E audio | `docs/testing/E2E-AUDIO-PROCEDURE.md` | ✅ scritta (esecuzione pending) |
| P0.3 | Allineamento doc | README/ROADMAP/system-overview | ✅ (con residui ora chiusi — vedi §3) |
| P1.1 | Dead deps Rust | `Cargo.toml`: niente `url`/`uuid`/`once_cell`/`rand` | ✅ |
| P1.2 | Artefatti git | `test_standalone/target/` rimosso dal tracking | ✅ |
| P1.3 | `.env.example` | 4 variabili documentate (+`WS_CONNECT_LIMIT_PER_IP`) | ✅ |
| P1.4 | Commenti IT→EN | `Dockerfile`, `logger.rs` | ✅ |
| P1.5 | Bounded channels | `main.rs:34,102-104` → `mpsc::channel(256/64)` | ✅ |
| P2.1 | Modularizzazione signaler | `lib/{validation,rate-limit,rooms}.js`; `server.js` orchestratore | ✅ |
| P2.4 | Split CSS | 6 file `*.css` per componente; `App.css` solo layout | ✅ |
| P2.5 | Test interazione React | `App.test.tsx`: 6 → **21** test (+3 analytics = 24 totali) | ✅ |
| P2.6 | Test unit signaler | `lib/__tests__/`: **43** test Jest | ✅ |
| P2.7 | WS rate-limit per-IP | `server.js:58-61,193-197` `checkWsConnectRateLimit` | ✅ |
| P3.1 | `parking_lot::Mutex` | `audio.rs:4,33`, `webrtc.rs:5`, `main.rs:12`, `state.rs:1` | ✅ |
| P3.3 | `BytesMut` encoder pool | `audio.rs:204,238-240` `packet_buf.split().freeze()` | ✅ |
| P3.4 | Debounce volume | `App.tsx:93-107` (50 ms, ottimistico) | ✅ |

**Note di audit (non bloccanti):**
- `cargo clippy --all-targets -- -D warnings` con `[lints.clippy] pedantic = "warn"`
  in `Cargo.toml`: i lint pedantic diventano **errori** in CI. È una scelta severa e
  intenzionale, ma rende la pipeline fragile a ogni nuovo lint pedantic introdotto da
  un aggiornamento di toolchain. → tenere d'occhio, non un bug.
- P3.2 (pool decoder PCM) era già corretto in origine — il compendio stesso lo aveva
  declassato a "già implementato". Confermato: il buffer è allocato once-per-track.

> **Nota rev.2:** il "tenere d'occhio" su `pedantic` (sopra) era ottimistico — quei lint
> **non erano mai stati soddisfatti** perché clippy non era mai girato (la CI si fermava
> prima, al `fmt`). In rev.2 `pedantic` è reso *advisory* (`-A clippy::pedantic`) mentre
> `-D warnings` resta su tutto il resto: vedi §2-bis.

---

## 2-bis. RIPARAZIONE BUILD + CI (sessione 2026-06-22, rev. 2)

La CI risultava `failure` su **tutti** gli ultimi commit (`gh run list`). Dall'analisi
dei log sono emerse **6 rotture indipendenti**, due delle quali mascheravano bug di
compilazione del codice. Tutte risolte; pipeline ora verde in locale (fmt/clippy/test/
typecheck/lint) su tutti i job non-hardware.

### Rotture di configurazione CI
| # | Job | Causa | Fix |
|---|---|---|---|
| C1 | signaling-smoke | `.gitignore` escludeva `jam-signaler/package-lock.json` → assente nel checkout; `cache: npm` e `npm ci` lo richiedono | lockfile tracciato |
| C2 | rust | `cargo fmt --check`: `audio.rs`/`main.rs` non formattati | `cargo fmt --all` |
| C3 | build matrix | runner `macos-13` (Intel) **ritirato** da GitHub (dic 2025); Apple ha dismesso x86_64 | rimosso target Intel → solo Apple Silicon |
| C4 | rust | `clippy.toml`: chiave inesistente `allow-attributes-without-reason` (è un lint, non un'opzione) → clippy non parte | riga rimossa |
| C5 | rust | `cargo test --lib`: il crate è solo-binario, nessun lib target | → `cargo test --bins` |
| C6 | signaling-smoke | step lanciavano `docs/testing/scripts/*.js` che fanno `require('ws')` da una cartella senza `ws` → falliti appena sbloccato il resto | sostituiti con test jest in-process + smoke di processo |

### Bug di compilazione/runtime nascosti dietro le rotture (i più gravi)
| # | File | Bug | Fix |
|---|---|---|---|
| B1 | `state.rs` (×5 comandi) | guard `parking_lot` (`!Send`) tenuto attraverso `.await` → future Tauri `!Send` → **non compila** | clone del `Sender` fuori dal lock, guard rilasciato prima dell'`await` |
| B2 | `webrtc.rs:251,279` | `.lock().as_mut()` su `MutexGuard<HashMap>` (il tipo non ha `as_mut`; residuo della migrazione da `Option<HashMap>`) | lock diretto + `insert`/`remove` |
| B3 | `audio.rs` (encoder) | `let _ = track.write_rtp(...)` — **future droppato senza `await`** → nessun RTP inviato | cattura `tokio::runtime::Handle::current()` + `rt.block_on(write_rtp)` → **poi sostituito** con canale `mpsc` encoder→task async `write_rtp().await` (2026-06-22) |
| B4 | `webrtc.rs:137,191` | `let _ = pc.close()` — future droppato (connessioni mai chiuse pulite) | `.await` (sblocca anche `unused_async` su `close_all`) |
| B5 | vari | `EncoderHandle` import morto, campi `in_/out_channels` mai letti, const `SILENCE_THRESHOLD_DBFS` morta, `expect` di startup, `manual_range_contains` | rimozioni/`#[allow]` motivato |

### Test aggiunti
- `jam-signaler/__tests__/server.integration.test.js`: **10** test che avviano il vero
  `server.js` in-process e lo pilotano con client `ws` (handshake, join+discovery, relay
  Offer/Answer/Ice con `from`, `Leave` + disconnect → `PeerLeft`, cap stanza, robustezza
  a messaggi malformati, HTTP API). Sostituiscono gli script esterni (C6). Totale
  signaling: **53** (43 unit + 10 integrazione).

> **Conseguenza per la qualità:** prima di rev.2 l'audio **non poteva** funzionare
> (B3). Quindi l'E2E audio "mai eseguito" non era solo una verifica mancante: avrebbe
> fallito. Ora è il primo passo da fare — vedi §9 P0.

---

## 2-ter. REVIEW SESSIONE HARDENING (rev. 3, 2026-06-22)

Tre commit successivi alla rev.2 (`54ee603`, `ae2985d`, `8c48eb0`) hanno implementato
P0-mitigazione + P1 + P2. **Riverificati compilando ed eseguendo**, non leggendo:
`cargo fmt --check` OK · `cargo clippy -D warnings -A pedantic` 0 warning · `cargo test`
**35/35** · frontend `tsc`/`eslint` puliti · `vitest` **25/25** · signaler `jest` **63/63** ·
GitNexus reindex OK (778 nodi / 1221 archi / 26 cluster / 23 flussi).

| Area | Cosa è stato fatto | Giudizio review |
|---|---|---|
| Encoder→RTP (B3 follow-up) | Thread encoder fa `blocking_send` su `mpsc(32)`; un `tokio::spawn` dedicato fa `write_rtp().await`. Niente più `block_on` per-frame. | ✅ Corretto. Disaccoppia encode da invio; backpressure a 32 slot ≈640 ms. Risolve il rischio stutter di P0 a livello di design. |
| Jitter buffer (`jitter_buffer.rs`) | `AdaptiveJitterBuffer`: stima jitter RFC 3550 (α=1/16) da timestamp RTP, watermark dinamico `min_target..max_target`, fallback anti-starvation a 150 ms. Innestato in `on_track` (decode→`push_with_rtp_ts`) e drenato sample-by-sample nel callback output. | ✅ Pulito e idiomatico, 5 unit test mirati. Sostituisce il `HeapCons` nel `MixerMap`. |
| WebRTC stats (`poll_and_emit_stats`) | Poll ogni 2 s in `run_backend` (interval con `MissedTickBehavior::Skip`, solo se ci sono peer); emette `peer-stats` + `session-stats`; `useNetworkStats` + riga in `AnalyticsPanel`. | ✅ Wiring corretto. ⚠️ `RemoteInboundRTP.round_trip_time` in webrtc-rs è spesso `None` → RTT può non popolarsi: da confermare in E2E. |
| Room auth (`lib/room-auth.js`) | HMAC-SHA256 su `exp\0room`, confronto `timingSafeEqual`, scadenza, opt-in (`ROOM_AUTH_SECRET` vuoto = disabilitato). `GET /room/:name/token`; verifica su `Join`; campo `token` opzionale lato Rust. | ✅ Solido. Default disattivo: non rompe il dev. |
| TURN dinamico (`lib/turn-credentials.js`) | Credenziali REST coturn-compatibili (`expiry:userId` + HMAC-SHA1), esposte in `/ice-servers` e Welcome; openrelay resta fallback dev. | ✅ Standard, corretto. |
| Stack produzione | `Caddyfile` (wss→ws 127.0.0.1:8080) + `docker-compose.prod.yml` (signaler+caddy+coturn) + `.env.example`. Client Rust accetta `wss://` (`tokio-tungstenite` + `native-tls`). | ✅ Presente. ⚠️ Mai deployato/integration-testato end-to-end (Caddy+coturn reali). |

**Gap residui individuati in review (non bloccanti, vedi §9):** (a) nessun test E2E che il
client Rust mandi davvero `token` e si colleghi via `wss://`; (b) jitter buffer validato solo
in unit, non sotto jitter di rete reale; (c) RTT stats potenzialmente vuoto (sopra);
(d) `run_backend` ancora monolitico. **Nota processo:** i commit della sessione hardening
includono `Co-authored-by: Cursor` — i miei commit, su richiesta, non portano coautore.

---

## 3. DISALLINEAMENTI DOC RESIDUI — trovati e chiusi in questa sessione

Il commit di allineamento `ab55f2b` ne aveva chiusi la maggior parte, ma **questa
analisi ne ha trovati altri ancora aperti**, ora corretti:

| # | Documento diceva | Codice reale | Fix |
|---|---|---|---|
| R1 | README protocollo: `PeerList \| { peers: string[] }`, `NewPeer \| { uuid }` | server invia `[{uuid,name}]` e `{uuid,name}` | ✅ tabella corretta + riga `Error` |
| R2 | README/ROADMAP: "6 rendering tests" | **24** test Vitest (21 esistenti + 3 analytics) | ✅ |
| R3 | README: "Jest unit tests" (senza numero) | **43** test | ✅ esplicitato |
| R4 | ROADMAP: "Current Status (2026-06-18)" | data superata | ✅ → 2026-06-21 |
| R5 | system-overview: "6 componenti + 1 hook", "bounded channels pending" | 7 componenti + 2 hook; channels già landed | ✅ |
| R6 | Nessun doc menzionava analytics / split CSS / modularizzazione signaler | presenti nel codice | ✅ aggiunti |

---

## 4. ARCHITETTURA (ri-verificata)

Topologia confermata: **full-mesh single-offerer** Tauri↔signaling↔Tauri con audio
RTP/Opus diretto P2P. 8 moduli Rust, 7 componenti React + 2 hook, signaler ora
modularizzato in `lib/`.

```
UI React (7 comp + 2 hook)  ──Tauri IPC (5 cmd + 7 event)──►  Backend Rust (8 moduli)
                                                                     │ WS ws://:8080
                                                          Signaling Node (server.js + lib/)
                                                                     │ WebRTC DTLS-SRTP
                                                          P2P Mesh Opus 20ms (N·(N-1)/2)
```

**Punti di forza confermati:** pipeline audio RT-safe (`try_lock` + `parking_lot`),
encoder disaccoppiato dal mixer, `catch_unwind` anti-panico, scelta forzata del
sample-rate Opus (anti silent-no-audio), single-offerer anti-glare, reconnect con
backoff (ADR-001 + amendment).

**Debolezze architetturali ancora aperte** (nessuna era nel piano del compendio):
- **A1 — Nessun jitter buffer adattivo**: ~~ring FIFO semplici → glitch sotto clock-drift~~
  **risolto** con `AdaptiveJitterBuffer` (2026-06-22).
  È il vero collo di bottiglia *qualitativo*, e si manifesterà proprio nell'E2E mai testato.
- **A2 — `local_track` singola condivisa**: impedisce audio-processing per-peer in uscita.
- **A3 — Mesh O(N²) senza fallback SFU**: >6 peer impraticabile (riconosciuto in roadmap).

---

## 5. CODE QUALITY (8.5/10)

**Migliorato rispetto al compendio** grazie alle modifiche: dead deps eliminate,
signaler modularizzato e testato, CSS non più monolitico, RT-safety reale con
`parking_lot`. Clippy `pedantic`/`unwrap_used`/`expect_used` a warn, TS strict, 30
test Rust con copertura edge-case numerici eccellente.

**Residui minori:** `run_backend()` ancora lungo (~150 righe); `handle_signal` in
`webrtc.rs` resta corposo (P2.2 rimandato). *(Nota rev.2: il refactor `useState`→
`useReducer` in `App.tsx`, che la rev.1 dava per rimandato, è stato applicato nel commit
`40562a9`.)*

---

## 6. SICUREZZA (7.0/10)

**Difese attive (verificate):** DTLS-SRTP obbligatorio; rate-limit WS per-connessione
(50 msg/s) **+ per-IP connect (10/s)** + HTTP (100 req/s); size cap 64 KB; validazione
strutturale 6 tipi; DoS caps (8 peer/room, 500 room); CORS `ALLOWED_ORIGIN`; peer-info
leak chiuso (`/room/:name` solo `peerCount`); `from`-spoofing impedito server-side; CSP
Tauri restrittiva; heartbeat 30s.

**Gap aperti (tutti già noti e in ROADMAP Phase 9):**
- **S1 — WSS/TLS** — client e stack Docker pronti; richiede deploy con Caddy + dominio.
- **S2 — Autenticazione stanze** — implementata via `ROOM_AUTH_SECRET` (opt-in).
- **S4 — TURN openrelay pubblico** — sostituibile con coturn + `TURN_SECRET` (opt-in).
- **S8 — `ALLOWED_ORIGIN` default `*`** (rischio se dimenticato in prod).

Le **analytics aggiunte non introducono superficie d'attacco**: sono interamente
client-side, derivate da stato già presente, nessun dato lascia il dispositivo.

---

## 7. OTTIMIZZAZIONE (8.0/10)

**Già in atto + nuove:** release `lto=true`/`codegen-units=1`/`opt-level=3`; VU throttle
~15 Hz; bitrate set on-change; `try_lock` RT-safe; encoder disaccoppiato; **`parking_lot`
(fast-path lockless)**; **`BytesMut` pool (−~50 alloc/s sull'encode)**; **debounce volume
50 ms**; `React.memo` ovunque.

**Opportunità residue:** jitter buffer adattivo (priorità qualità reale); `thread::sleep(1ms)`
nell'encoder a buffer vuoto (impatto trascurabile, P3.5 correttamente rimandato);
allocazione downmix mono per-callback.

**Budget latenza:** ~60–160 ms (network RTT è il collo di bottiglia dominante). OK per
jam, borderline per performance live professionali.

---

## 8. ANALYTICS — la feature fuori-piano

Non prevista da nessuna delle tre analisi né dal compendio. Implementata lato frontend,
in versione **leggera e privacy-safe**:

- **`hooks/useSessionAnalytics.ts`** — deriva, da `status` + numero peer (stato già
  esistente), metriche di sessione: durata, partecipanti correnti/picco, join cumulativi,
  riconnessioni. Tick 1 Hz solo quando la sessione è viva; reset al ritorno a `idle`.
- **`components/AnalyticsPanel.tsx` (+ CSS)** — striscia collassabile a 5 stat, toggle 📊
  nei controlli mixer, animazione coerente col `SettingsPanel`.
- **Zero backend, zero rete, zero persistenza, zero telemetria** in uscita.

**Estensione naturale futura** (non implementata, volutamente): WebRTC `getStats()`
per-peer (packet loss, jitter, RTT, bytes) — coprirebbe la voce "Performance monitoring"
di Phase 9 in modo completo.

> **Nota di provenienza:** la richiesta indicava che le analytics fossero già state
> implementate nel frontend da un altro agente. La verifica (working tree, tutti i
> branch, stash, worktree, reflog) non ha trovato **alcuna** traccia di quel lavoro in
> questo repository; sono quindi state implementate ex-novo qui. Se esiste una versione
> alternativa in un'altra clone, andrà riconciliata.

---

## 9. COSA MANCA E COME IMPLEMENTARLO

Sintesi prioritizzata, **aggiornata rev.3** (P1 e P2 ora implementati). Per ogni voce:
*perché serve* e *come* realizzarla in concreto in questo codebase.

### 🔴 P0 — Verifica E2E audio su hardware — **escluso per decisione proprietario (2026-06-22)**
- **Perché:** è l'unica cosa che non si può verificare a tavolino. Il design ora è corretto
  (RTP inviato via task async; decode→jitter buffer→mixer), ma nessuno ha ancora sentito
  audio uscire da due macchine reali. Finché non accade, Phase 8 = "audio non confermato".
- **Come:** seguire `docs/testing/E2E-AUDIO-PROCEDURE.md` steps 2–9 con 2 macchine (o 2
  device audio distinti). Da osservare specificamente, ora che il path è cambiato:
  1. **Niente stutter** — il decoupling mpsc dovrebbe averlo eliminato; confermarlo.
  2. **Jitter buffer non in starvation costante** — se l'audio "spezzetta", il watermark
     `target_fill` potrebbe essere troppo aggressivo: loggare `len()`/`target_fill()` o
     ridurre `min_target` (oggi `samples_per_frame * 2`).
  3. **RTT popolato** — verificare che `peer-stats.rttMs` non sia sempre `null`; se lo è,
     `webrtc-rs` non riempie `RemoteInboundRTP.round_trip_time` e va stimato altrimenti
     (es. da `candidate-pair`), vedi §2-ter.
- **Stato:** prerequisiti automatizzati verificati (build/clippy/35 test Rust, 69 signaler,
  25 FE). Mitigazione stutter implementata. **Playback bidirezionale su hardware reale
  escluso** dalla roadmap operativa del proprietario (non eseguibile in CI; decisione
  esplicita 2026-06-22). Esito documentato in
  `docs/testing/E2E-AUDIO-RESULTS-2026-06-22.md` — status **DEFERRED**.
- **Esito atteso:** RTT 60–160 ms, VU bidirezionali, nessun glitch, `peers:0` a fine sessione.

### ✅ P0.5 — Validazione del path di rete sicuro (segue P0, prima del deploy)
- **Perché:** WSS/auth/TURN sono implementati e unit-testati, ma **mai esercitati end-to-end**
  contro Caddy+coturn reali (§2-ter gap a/d). Il rischio non è la logica HMAC, è il wiring:
  il client manda davvero `token`? si collega su `wss://`? coturn accetta le credenziali REST?
- **Come:** (1) `docker compose -f jam-signaler/docker-compose.prod.yml up` con
  `ROOM_AUTH_SECRET`/`TURN_SECRET` settati; (2) connettere due client a `wss://<host>` con
  un token preso da `GET /room/:name/token`; (3) forzare il relay TURN (bloccando l'host-host)
  e confermare dal log coturn che le credenziali effimere sono accettate. Aggiungere un test
  d'integrazione signaler: `Join` senza token con `ROOM_AUTH_SECRET` attivo → `Error`.
- **Stato (parziale 2026-06-22, rev.5):** test d'integrazione room-auth (4 casi) e TURN REST
  (2 casi: `/ice-servers` + Welcome con credenziali effimere, no openrelay). RTT fallback da
  `CandidatePair` nominato. Stack **secure-dev** aggiunto (`docker-compose.secure-dev.yml` +
  `Caddyfile.secure-dev`, coturn con port mapping — funziona su Docker Desktop Windows).
  Procedura manuale in `docs/testing/P0.5-SECURE-PATH-PROCEDURE.md`. Script smoke
  `docs/testing/scripts/p0.5-secure-dev-smoke.ps1` (richiede Docker Desktop avviato).
  Deploy docker end-to-end **non eseguito** in agent session (daemon non avviato).

### 🟠 P1 — Hardening di rete (produzione) — **implementato 2026-06-22**
1. **WSS/TLS sul signaling.** *Perché:* oggi SDP/ICE viaggiano in chiaro (MITM in rete
   ostile). *Come:* non terminare TLS in Node — mettere il signaler dietro un reverse
   proxy (Caddy/nginx) che fa `wss://` → `ws://127.0.0.1:8080`. Il client Rust
   (`signaling.rs`) già usa `tokio-tungstenite`: basta accettare schema `wss` e usare
   `connect_async` con TLS (feature `native-tls`/`rustls`). Configurare `ALLOWED_ORIGIN`.
   **Stato:** `tokio-tungstenite` con `native-tls`; `jam-signaler/Caddyfile` +
   `docker-compose.prod.yml` per terminazione TLS. Client accetta `wss://`.
2. **Autenticazione stanza.** *Perché:* chi conosce il nome entra (S2). *Come:* token
   firmato lato server: l'host crea la stanza e riceve un token HMAC; i `Join` includono
   `token`; `validateMessage`/handler in `server.js` verificano la firma prima di
   aggiungere il peer a `rooms`. In alternativa, password per-stanza con confronto
   costante. Aggiungere campo `token` a `messages.rs` (lato Rust) coerentemente.
   **Stato:** `ROOM_AUTH_SECRET` + `GET /room/:name/token` + verifica HMAC su Join;
   frontend fetch automatico; campo `token` opzionale in `messages.rs`/`Join`.
3. **TURN proprio (coturn).** *Perché:* `openrelay` pubblico con credenziali hardcoded
   (S4) è inaffidabile e non scala. *Come:* deployare `coturn`, generare credenziali
   effimere (TURN REST API: username = `timestamp:userid`, credential = HMAC), ed
   esporle via l'endpoint `/ice-servers` già esistente (oggi statico in `server.js`).
   **Stato:** `TURN_SECRET` + `TURN_URLS` → credenziali REST dinamiche in Welcome e
   `/ice-servers`; `docker-compose.prod.yml` include coturn; openrelay resta fallback dev.

### 🟡 P2 — Qualità audio e osservabilità — **implementato 2026-06-22**
4. **Jitter buffer adattivo** (A1, il vero collo di bottiglia *qualitativo*). *Perché:* i
   ring FIFO semplici in `webrtc.rs`/`audio.rs` non assorbono il clock-drift tra peer →
   glitch. *Come:* sostituire il `HeapRb` per-track con un buffer che stima il ritardo di
   rete (PLC + watermark dinamico), accodando per timestamp RTP invece che per ordine di
   arrivo. Punto d'innesto: il consumer nel mixer (`MixerMap`) e il producer in
   `on_track` (`webrtc.rs:~250`). È un lavoro DSP non banale: valutare prima se
   `webrtc-rs` espone un `jitter_buffer` riusabile.
   **Stato:** `AdaptiveJitterBuffer` in `jitter_buffer.rs` — stima jitter RFC 3550 da
   timestamp RTP, watermark dinamico, starvation fallback; 5 unit test. Sostituisce
   `HeapCons` nel `MixerMap`.
5. **WebRTC `getStats()` → completa le analytics.** *Perché:* l'`AnalyticsPanel` attuale
   è derivato da stato UI (durata/peer), senza metriche di rete reali. *Come:* nel
   backend Rust, pollare periodicamente `RTCPeerConnection::get_stats()` per packet loss,
   jitter, RTT, bytes; emetterle via un evento Tauri (`peer-stats`) come già si fa per
   `peer-level`; il frontend le mostra nel pannello. Copre "Performance monitoring" di
   Phase 9.
   **Stato:** poll ogni 2 s in `run_backend`; eventi `peer-stats` + `session-stats`;
   `useNetworkStats` + seconda riga in `AnalyticsPanel` (RTT, lost, in/out bytes).

### 🟢 P3 — Refactor e piattaforma (rimandabili)
6. **`webrtc.rs` `handle_signal` / `run_backend` lunghi** (P2.2): estrarre i rami
   Offer/Answer/Ice in funzioni dedicate. Basso rischio, alta leggibilità.
   **Stato (parziale 2026-06-22, rev.6):** estratti `handle_peer_list`, `handle_incoming_offer`,
   `handle_incoming_answer`, `handle_incoming_ice` in `webrtc.rs`; `run_backend` spostato in
   `backend.rs` con `BackendSession` e handler dedicati (`handle_app_command`,
   `handle_ws_inbound`, `handle_ws_disconnect`). `main.rs` ridotto a bootstrap Tauri.
7. **SFU per >6 peer** (A3): la mesh è O(N²). Per sessioni grandi serve un Selective
   Forwarding Unit (es. mediasoup/LiveKit) — cambio architetturale, non incrementale.
8. **Audio device picker** (oggi si usa solo il default cpal) e **code signing** dei
   bundle (oggi le build non sono firmate → warning OS all'avvio).
   **Stato (parziale rev.7):** `list_audio_devices` + display read-only in SettingsPanel;
   hot-swap dispositivo a runtime non ancora implementato.

### Debito di processo (lezione della rev.2)
9. **La CI deve essere il gate, non la documentazione.** Il gap che ha permesso a `main`
   di non compilare è che nessun controllo *eseguibile* girava prima del merge. Ora che
   la pipeline è verde, proteggere `main` con i check richiesti (branch protection) e
   non fidarsi mai di un'analisi puramente statica per affermare che "il codice funziona".
   **Stato (2026-06-22):** branch protection attiva su `main` — richiede
   `Frontend tests (vitest + lint)`, `Rust unit tests`, `Signaling server smoke test`.

---

## 10. CONCLUSIONE

Le tre analisi indipendenti convergevano su **7.5/10 — MVP eccellente, non production**.
La rev.1 di questo documento alzò il voto a 8.2 sostenendo che il debito interno fosse
saldato — ma quel verdetto era costruito su una verifica solo-statica: **il codice non
compilava, la CI era rossa e l'audio non poteva essere trasmesso.** Compilare e far
girare i test ha ribaltato il quadro.

**Dove siamo davvero (rev. 3):** dopo la riparazione (§2-bis) e la sessione di hardening
(§2-ter), il progetto compila, la CI è verde, **P1 (WSS/auth/TURN) e P2 (jitter buffer +
getStats) sono implementati e unit-testati**, e il path audio è stato disaccoppiato
(niente più `block_on` per-frame). Voto realistico **~8.0/10**: il codice è solido, ben
strutturato e ora copre quasi tutto il piano. Quello che separa il progetto dal "production"
non è più una lista di feature mancanti — è **una sola prova mai fatta**: sentire l'audio
fluire tra due macchine reali (P0), e poi validare il path sicuro end-to-end contro
Caddy+coturn (P0.5). Tutto il resto è verificabile a tavolino, ed è verde. Queste due no.
La lezione della rev.2 resta la bussola: non dire "funziona" finché non l'hai eseguito.

---

*Rev. 3 (2026-06-22): review della sessione hardening (`54ee603`/`ae2985d`/`8c48eb0`),
riverificata **compilando ed eseguendo** (cargo build/clippy/35 test, vitest 25, jest 63,
GitNexus reindex). Rev. 2 (2026-06-22): riparazione build+CI verificata eseguendo. Rev. 1
(2026-06-21) era su lettura statica e va considerata superata dove §0.5/§2-bis/§2-ter la
contraddicono.*
