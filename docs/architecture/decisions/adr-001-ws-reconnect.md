# ADR-001: WebSocket Reconnect via WsEvent Channel

**Status:** Accepted
**Date:** 2026-05-03

## Context

The jam-p2p main event loop uses `tokio::select!` to multiplex three channels:

1. `rx` — receives `AppCommand` from the Tauri frontend
2. `sig_rx` — receives `SignalMessage` to forward to the signaling server
3. `ws_in_rx` — receives incoming WebSocket text frames from the WS reader task

The original code had an `else` branch intended to detect WebSocket disconnection
and trigger automatic reconnection with exponential backoff:

```rust
// ORIGINAL (broken) pattern
loop {
    tokio::select! {
        Some(cmd) = rx.recv() => { ... }
        Some(msg) = sig_rx.recv() => { ... }
        Some(text) = ws_in_rx.recv() => { ... }
        else => {
            // Dead code — never reached
            // reconnect logic here
        }
    }
}
```

**The problem:** `tokio::select!`'s `else` branch fires only when ALL branches
return `None` or are not ready AND all futures have been completed. Since `rx`
and `sig_rx` remain open for the entire application lifetime (their senders
live in `AppState` and the `WebrtcContext`), the `else` branch **never** fires,
making the reconnection logic entirely dead code.

## Decision

Introduce a dedicated `WsEvent` enum with an mpsc channel to explicitly signal
WebSocket lifecycle changes from the reader task to the main loop:

### Changes

1. **`messages.rs`** — Added `WsEvent` enum:
   ```rust
   pub enum WsEvent {
       Disconnected,
   }
   ```

2. **`signaling.rs`** — `SignalingClient` now holds a `ws_event_tx` sender.
   The spawned WS reader task clones this sender and sends
   `WsEvent::Disconnected` **after** the `while let Some(Ok(msg))` read loop
   exits (i.e., when the WebSocket stream ends):

   ```rust
   tokio::spawn(async move {
       while let Some(Ok(msg)) = read.next().await {
           if let Message::Text(t) = msg {
               let _ = ws_in_tx.send(t);
           }
       }
       let _ = ws_event_tx.send(WsEvent::Disconnected);
   });
   ```

3. **`main.rs`** — Added a new `ws_event_rx` branch to the select! block.
   When `WsEvent::Disconnected` is received, the reconnect logic runs:

   ```rust
   Some(_) = ws_event_rx.recv() => {
       // WS connection dropped — trigger reconnect
       let _ = handle.emit("disconnected", ());
       peer_manager.close_all(&handle).await;
       if sig_client.should_reconnect() {
           let delay = sig_client.backoff_delay();
           tokio::time::sleep(delay).await;
           sig_client.connect(&server, &room, &name, res_tx).await;
       }
   }
   ```

4. The original `else` branch was removed since the new channel makes it
   obsolete.

## Consequences

### Positive

- **Reconnection now works** — the `WsEvent::Disconnected` channel guarantees
  that the main loop will be notified when the WebSocket connection drops,
  regardless of the state of other channels.
- **Explicit lifecycle** — WS connection state is communicated through a
  dedicated channel, making the code's intent clear.
- **No busy-polling** — the mpsc channel is async-native; the main loop only
  wakes when a WsEvent arrives.
- **Minimal diff** — no restructuring of the existing message flow.

### Negative

- **Extra channel overhead** — one additional mpsc channel and one extra
  select! branch, but the overhead is negligible (one extra allocation per
  connection, one branch per loop iteration).
- **Channel cloning** — the `ws_event_tx` must be cloned into every WS reader
  task spawned by `connect()`. If multiple connections are active (not
  currently the case), each needs its own clone.

## Alternatives Considered

### 1. Watch Channel (`tokio::sync::watch`)

Use a `watch::Sender<bool>` to broadcast connection status. The main loop
would poll `watch::Receiver::changed()`.

- **Pros:** Single receiver, broadcast semantics.
- **Cons:** Requires polling (`changed()` returns `Result<()>` and the receiver
  always contains the last value). Adds complexity for no benefit over mpsc.

### 2. Shared `AtomicBool`

A simple `Arc<AtomicBool>` flag checked in the main loop.

- **Pros:** Zero allocation, simple.
- **Cons:** Requires polling or a separate wake mechanism. Cannot distinguish
  between "first connect" and "reconnect after drop" without additional state.
  Prone to busy-looping.

### 3. Join Handle

Store the WS reader task's `JoinHandle` and poll it.

- **Pros:** No extra channel needed.
- **Cons:** `JoinHandle` cannot be awaited in `tokio::select!` directly
  (requires wrapping). Polling a joined handle yields an error, not a clean
  notification. Harder to reason about.

### 4. Dedicated `SignalMessage::Disconnected` Variant

Send a disconnection notification through the existing `sig_tx` channel
instead of adding a new channel.

- **Pros:** Reuses existing infrastructure.
- **Cons:** `sig_tx` is semantically "outbound messages to the signaling
  server." Injecting internal lifecycle events creates a confusing mix of
  concerns. Processing `Sig nalMessage::Disconnected` in the `sig_rx` branch
  would require branching logic in the same path that forwards SDP/ICE
  messages, making the code harder to follow.

The dedicated `WsEvent` channel was chosen because it provides clean
separation of concerns — the WS lifecycle is handled independently from
application-level signaling messages — while remaining simple and idiomatic
with tokio's mpsc pattern.

## Amendment (2026-06-18): backoff must survive a failed retry

The `ws_event_rx` branch drives reconnection by: backoff sleep → `connect()`.
The next retry, however, only happens when another `WsEvent::Disconnected`
arrives, and that event is emitted by the WS **reader task** — which `connect()`
spawns *only on success*. So if a reconnect attempt failed (server still down),
no reader task was spawned, no further `Disconnected` was ever sent, and the
exponential-backoff loop silently gave up after a single failed attempt.

Fix: `connect()` now re-emits `WsEvent::Disconnected` on its failure path **when
a prior session exists** (`self.last_join.is_some()`), so the loop schedules the
next backoff attempt and keeps retrying until it succeeds or the user leaves. The
`last_join` guard ensures an *initial* connect failure (no prior session) still
surfaces as a one-shot error to the UI instead of entering a reconnect loop.
