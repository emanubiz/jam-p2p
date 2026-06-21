# End-to-End Audio Verification — Procedure

This is the **manual** end-to-end verification procedure for `jam-p2p`'s
core function: streaming live Opus audio between 2+ desktop instances.

The procedure exists because the audio pipeline cannot be exercised by an
automated test on CI: there is no audio device available in the runner, and
cpal will refuse to open a stream with a fake "default" device. Until we
introduce a virtual audio device (PulseAudio/PipeWire null-sink) or a hardware
test rig, this must be performed by a developer on a workstation with real
input + output hardware.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | >= 18 | For the signaling server |
| Rust | >= 1.70 | For the Tauri backend |
| System deps | platform-specific | See top-level README |
| 2+ microphones and speakers (or 1 + headset) | — | For full-duplex verification |
| Latency measurement tool | — | macOS: `say` + stopwatch; Linux: `arecord` + `aplay`; Windows: PowerShell `MediaRecorder` |

> **Headless caveat:** running in a VM/headless container will fail at step 4
> because no audio device is visible to cpal. Use a desktop session.

---

## 1. Start the signaling server

```bash
cd jam-signaler
npm install
npm start
# Expected log: "Signaling server listening" on port 8080
```

Confirm `/health` and `/ice-servers`:

```bash
curl -fsS http://localhost:8080/health
# {"status":"ok","rooms":0,"peers":0,"uptime":...}

curl -fsS http://localhost:8080/ice-servers
# {"iceServers":[...]}
```

## 2. Launch the first peer (Alice)

```bash
cd jam-gui
npm install
npm run tauri dev
```

In the app window:

1. Set **Display Name** to `Alice`
2. Set **Server Endpoint** to `ws://localhost:8080`
3. Set **Room ID** to `e2e-test`
4. Click **Connect to Session**

Expected: status flips to "Live Session", room badge shows "1 participant"
(only Alice), "Waiting for peers" empty state visible.

## 3. Launch the second peer (Bob)

In a **separate terminal**:

```bash
cd jam-gui
npm run tauri dev
```

In the new window:

1. Set **Display Name** to `Bob`
2. Set **Server Endpoint** to `ws://localhost:8080`
3. Set **Room ID** to `e2e-test` (same as Alice)
4. Click **Connect to Session**

Expected: both windows show "2 participants" in the room badge, and each
window shows the other's peer card with the correct display name.

## 4. Verify VU meters

- Speak into Alice's microphone → Alice's `LocalMicCard` VU meter should animate.
- Speak into Alice's microphone → Bob's `PeerCard` VU meter for Alice should animate.
- Same for Bob speaking into Alice's window.

If a VU meter does not animate, check:
- Microphone permissions in the OS (macOS: System Settings → Privacy → Microphone).
- The audio input device in the system tray isn't muted.

## 5. Verify audio playback

- Alice's audio should come out of Bob's speakers, and vice versa.
- Verify full-duplex: both peers can speak simultaneously and both hear each other.
- Optional: use a loopback cable / virtual cable to capture both ends and
  confirm the recorded audio matches the spoken input.

## 6. Measure round-trip latency

A rough but useful measurement:

1. Position both machines near each other (or use a hardware loopback).
2. Start a tone generator (e.g. a 1 kHz sine) on Alice's input.
3. Capture the output on Bob's machine with a sample-accurate tool.
4. The time difference between the tone generator's timestamp and the
   captured output's timestamp is the end-to-end latency (encode + network +
   decode + output buffer).

**Target:** 60–160 ms (the latency budget documented in the top-level README).

## 7. Optional: 3+ peer mesh

Repeat step 3 with a third peer (Carol) using a different display name. All
three windows should show 3 participants. Each peer should hear the other two
mixers in their output.

The signaling server caps mesh at `MAX_PEERS_PER_ROOM` (default 8).

## 8. Graceful disconnect

On Bob's window:

1. Click **Disconnect** (or press `Esc`).
2. Alice's window should see Bob disappear from the peer list (event
   `peer-left`).
3. The signaling server log should print "Peer removed from room".

Repeat for Alice. The server's `/health` endpoint should report `peers: 0` and
the rooms map should be empty.

## 9. Tear down

- Stop the signaling server (`Ctrl+C`). The graceful-shutdown handler closes
  every WebSocket with code 1001.
- Close both Tauri windows. The encoder thread shuts down via the watch
  channel; peer connections are closed and `peer-left` events are emitted.

---

## Pass criteria

A run counts as PASS when ALL of the following hold:

1. Both peers connect and see each other with correct display names.
2. Audio flows in both directions (Alice → Bob AND Bob → Alice).
3. VU meters animate on local + remote ends.
4. Round-trip latency is below 200 ms (target 60–160 ms).
5. Disconnect propagates to the surviving peer within 1 s.
6. The signaling server reports `peers: 0` after both clients disconnect.

## Failure log

When you run this procedure, fill in the results table below and check it into
the repo as `docs/testing/E2E-AUDIO-RESULTS-<date>.md`:

```markdown
# E2E Audio Results — <date>

| Step | Result | Notes |
|---|---|---|
| 1. Signaling server starts | ✅/❌ | |
| 2. Alice connects | ✅/❌ | |
| 3. Bob connects | ✅/❌ | |
| 4. VU meters | ✅/❌ | |
| 5. Audio playback | ✅/❌ | |
| 6. Latency | ___ ms | |
| 7. 3-peer mesh (optional) | ✅/❌/skipped | |
| 8. Graceful disconnect | ✅/❌ | |
| 9. Tear down | ✅/❌ | |

**OS:** ___ **Rust:** ___ **Node:** ___ **Tauri:** ___
```

The first PASS run unblocks Phase 8 of the roadmap (cross-platform CI builds
can be trusted to ship working audio binaries).
