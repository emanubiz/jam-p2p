import { useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useSessionAnalytics } from "./hooks/useSessionAnalytics";
import { ga } from "./ga";
import ConnectionForm, { type AppStatus } from "./components/ConnectionForm";
import SettingsPanel from "./components/SettingsPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import LocalMicCard from "./components/LocalMicCard";
import StatusBar from "./components/StatusBar";
import PeerCard from "./components/PeerCard";
import "./App.css";

/** Debounce window for per-peer volume updates sent to the backend. The UI
 *  still updates instantly (optimistic); only the IPC call to the Rust mixer
 *  is throttled so a slider drag doesn't fire `set_volume` for every pixel. */
const VOLUME_DEBOUNCE_MS = 50;

// ---------------------------------------------------------------------------
// Session state machine (useReducer replaces 9 useState calls)
// ---------------------------------------------------------------------------

type SessionState = {
  room: string;
  name: string;
  server: string;
  status: AppStatus;
  error: string | null;
  muted: boolean;
  bitrate: number;
  settingsOpen: boolean;
  analyticsOpen: boolean;
};

type SessionAction =
  | { type: "SET_ROOM"; room: string }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_SERVER"; server: string }
  | { type: "SET_STATUS"; status: AppStatus }
  | { type: "COND_SET_STATUS"; guard: (s: AppStatus) => AppStatus }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "TOGGLE_MUTE" }
  | { type: "SET_BITRATE"; bitrate: number }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "TOGGLE_ANALYTICS" };

const initialSessionState: SessionState = {
  room: "studio1",
  name: "",
  server: "ws://localhost:8080",
  status: "idle",
  error: null,
  muted: false,
  bitrate: 64,
  settingsOpen: false,
  analyticsOpen: false,
};

function sessionReducer(
  state: SessionState,
  action: SessionAction
): SessionState {
  switch (action.type) {
    case "SET_ROOM":
      return { ...state, room: action.room };
    case "SET_NAME":
      return { ...state, name: action.name };
    case "SET_SERVER":
      return { ...state, server: action.server };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "COND_SET_STATUS":
      return { ...state, status: action.guard(state.status) };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "TOGGLE_MUTE":
      return { ...state, muted: !state.muted };
    case "SET_BITRATE":
      return { ...state, bitrate: action.bitrate };
    case "TOGGLE_SETTINGS":
      return { ...state, settingsOpen: !state.settingsOpen };
    case "TOGGLE_ANALYTICS":
      return { ...state, analyticsOpen: !state.analyticsOpen };
  }
}

function App() {
  const [session, dispatch] = useReducer(sessionReducer, initialSessionState);
  const { room, name, server, status, error, muted, bitrate, settingsOpen, analyticsOpen } =
    session;

  const {
    peers,
    localLevel,
    disconnected,
    clearDisconnected,
    reconnected,
    clearReconnected,
    serverError,
    clearServerError,
    resetPeers,
    updatePeerVolume,
  } = useTauriEvents();

  // Lightweight, privacy-safe per-session analytics derived purely from the
  // existing status + peer state (no backend calls, no persistence).
  const analytics = useSessionAnalytics(status, peers.length);

  // Stable callbacks for form inputs — dispatch is stable from useReducer,
  // so these never cause ConnectionForm (React.memo) to re-render.
  const onServerChange = useCallback(
    (s: string) => dispatch({ type: "SET_SERVER", server: s }),
    []
  );
  const onRoomChange = useCallback(
    (r: string) => dispatch({ type: "SET_ROOM", room: r }),
    []
  );
  const onNameChange = useCallback(
    (n: string) => dispatch({ type: "SET_NAME", name: n }),
    []
  );

  // Mirror the live session duration into a ref so `disconnect` can report it
  // to GA4 without taking `analytics` as a dependency (which would rebuild the
  // callback — and re-bind the keyboard listener — on every 1 Hz tick).
  const elapsedSecRef = useRef(0);
  elapsedSecRef.current = analytics.elapsedSec;

  useEffect(() => {
    if (disconnected) {
      // Backend auto-reconnects with backoff; show a reconnecting state rather
      // than a fresh form (which would conflict with the in-flight reconnect).
      dispatch({
        type: "COND_SET_STATUS",
        guard: (s) => (s === "idle" ? s : "reconnecting"),
      });
      clearDisconnected();
    }
  }, [disconnected, clearDisconnected]);

  useEffect(() => {
    if (reconnected) {
      dispatch({
        type: "COND_SET_STATUS",
        guard: (s) => (s === "idle" ? s : "connected"),
      });
      clearReconnected();
    }
  }, [reconnected, clearReconnected]);

  useEffect(() => {
    if (serverError) {
      dispatch({ type: "SET_ERROR", error: serverError });
      clearServerError();
    }
  }, [serverError, clearServerError]);

  // Report peer-count churn to GA4 (separate from the in-app analytics panel):
  // a net increase is a peer connecting, a net decrease one leaving.
  const prevPeerCountRef = useRef(0);
  useEffect(() => {
    if (status !== "connected") {
      prevPeerCountRef.current = peers.length;
      return;
    }
    const curr = peers.length;
    const prev = prevPeerCountRef.current;
    if (curr > prev) ga.peerConnected(curr);
    else if (curr < prev) ga.peerDisconnected(curr);
    prevPeerCountRef.current = curr;
  }, [peers.length, status]);

  const connect = useCallback(async () => {
    dispatch({ type: "SET_STATUS", status: "joining" });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      await invoke("join_room", {
        room: session.room,
        name: session.name.trim() || "Anonymous",
        server: session.server,
      });
      ga.roomJoined(session.room);
      dispatch({ type: "SET_STATUS", status: "connected" });
    } catch (err: unknown) {
      dispatch({ type: "SET_ERROR", error: String(err) });
      dispatch({ type: "SET_STATUS", status: "error" });
    }
  }, [session.room, session.name, session.server]);

  // disconnect only needs session.room (for ga.roomLeft reporting); name and
  // server are irrelevant here because they're only used at connect time.
  const disconnect = useCallback(async () => {
    try {
      await invoke("leave_room");
      ga.roomLeft(session.room, elapsedSecRef.current);
      resetPeers();
      dispatch({ type: "SET_STATUS", status: "idle" });
      dispatch({ type: "SET_BITRATE", bitrate: 64 });
    } catch (err: unknown) {
      dispatch({ type: "SET_ERROR", error: String(err) });
      dispatch({ type: "SET_STATUS", status: "error" });
    }
  }, [resetPeers, session.room]);

  // Optimistic + debounced volume updates. The UI is updated immediately on
  // every change so the slider feels instant; the actual `set_volume` IPC is
  // debounced so a single mouse drag of the slider generates one (or a few)
  // calls instead of dozens. The pending timer is kept in a useMemo so it
  // survives across renders without resetting.
  const onVolumeChange = useMemo(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    return (peerId: string, v: number) => {
      updatePeerVolume(peerId, v);
      const existing = timers.get(peerId);
      if (existing) clearTimeout(existing);
      timers.set(
        peerId,
        setTimeout(() => {
          timers.delete(peerId);
          invoke("set_volume", { peerId, vol: v }).catch(console.warn);
        }, VOLUME_DEBOUNCE_MS)
      );
    };
  }, [updatePeerVolume]);

  const toggleMute = useCallback(() => {
    const next = !session.muted;
    dispatch({ type: "TOGGLE_MUTE" });
    invoke("set_muted", { muted: next }).catch(console.warn);
  }, [session.muted]);

  const handleBitrateChange = useCallback((value: number) => {
    dispatch({ type: "SET_BITRATE", bitrate: value });
    // UI is in kbps; the Opus encoder expects bits/s.
    invoke("set_opus_bitrate", { bitrate: value * 1000 }).catch(console.warn);
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      }
      if (
        (e.ctrlKey && e.shiftKey && (e.key === "d" || e.key === "D")) ||
        e.key === "Escape"
      ) {
        e.preventDefault();
        disconnect();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, toggleMute, disconnect]);

  const showForm =
    status === "idle" || status === "joining" || status === "error";

  return (
    <div className="app-container">
      <div className="bg-grid" />
      <div className="glow-orb glow-orb-1" />
      <div className="glow-orb glow-orb-2" />

      <div className="content-wrapper">
        <div className="logo-section">
          <div className="logo-box">
            <div className="logo-shimmer" />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 18V5l12-2v13"
                stroke="url(#grad1)"
                strokeWidth="2"
                strokeLinecap="square"
              />
              <circle cx="6" cy="18" r="3" stroke="url(#grad1)" strokeWidth="2" />
              <circle cx="18" cy="16" r="3" stroke="url(#grad1)" strokeWidth="2" />
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
            <h1 className="logo-text">JAM P2P</h1>
          </div>
          <p className="logo-subtitle">Professional Audio Network</p>
        </div>

        <div className="main-card">
          <div className={`status-bar status-${status}`} />

          {showForm && (
            <ConnectionForm
              server={server}
              room={room}
              name={name}
              status={status}
              onServerChange={onServerChange}
              onRoomChange={onRoomChange}
              onNameChange={onNameChange}
              onConnect={connect}
            />
          )}

          {status === "reconnecting" && (
            <div className="reconnecting-panel">
              <span className="spinner" />
              <span className="reconnecting-text">
                Reconnecting to <strong>{room}</strong>…
              </span>
              <button
                className="cancel-btn"
                onClick={disconnect}
                title="Cancel auto-reconnect and return to the form"
              >
                Cancel
              </button>
            </div>
          )}

          <StatusBar status={status} />

          {error && (
            <div className="error-box">
              <div className="error-title">ERROR</div>
              {error}
            </div>
          )}

          {status === "connected" && (
            <div className="mixer-section">
              <div className="room-badge">
                <span className="room-badge-label">ROOM</span>
                <span className="room-badge-name">{room}</span>
                <span className="room-badge-peers">
                  {peers.length + 1} participant
                  {peers.length + 1 !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="mixer-header">
                <h3 className="mixer-title">Active Channels</h3>
                <div className="mixer-controls">
                  <button
                    className={`mute-btn ${muted ? "muted" : ""}`}
                    onClick={toggleMute}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? "🔇 MUTED" : "🔊 LIVE"}
                    <span className="shortcut-hint">(M)</span>
                  </button>
                  <button
                    className="disconnect-btn"
                    onClick={disconnect}
                    title="Disconnect from room"
                  >
                    ⏏ Disconnect
                    <span className="shortcut-hint">(Esc)</span>
                  </button>
                  <div className="peer-count">
                    {peers.length} {peers.length === 1 ? "PEER" : "PEERS"}
                  </div>
                  <button
                    className={`settings-toggle ${analyticsOpen ? "open" : ""}`}
                    onClick={() => dispatch({ type: "TOGGLE_ANALYTICS" })}
                    title="Session analytics"
                  >
                    📊
                  </button>
                  <button
                    className={`settings-toggle ${settingsOpen ? "open" : ""}`}
                    onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}
                    title="Settings"
                  >
                    ⚙
                  </button>
                </div>
              </div>

              <AnalyticsPanel analytics={analytics} isOpen={analyticsOpen} />

              <SettingsPanel
                bitrate={bitrate}
                isOpen={settingsOpen}
                onBitrateChange={handleBitrateChange}
              />

              <LocalMicCard level={localLevel} />

              {peers.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon waiting-pulse">⌛</div>
                  <div className="empty-text">Waiting for peers</div>
                </div>
              ) : (
                <div className="peers-list">
                  {peers.map((p) => (
                    <PeerCard
                      key={p.id}
                      peer={p}
                      onVolumeChange={onVolumeChange}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
