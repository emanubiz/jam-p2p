import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useSessionAnalytics } from "./hooks/useSessionAnalytics";
import { ga } from "./ga";
import ConnectionForm from "./components/ConnectionForm";
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

function App() {
  const [room, setRoom] = useState("studio1");
  const [name, setName] = useState("");
  const [server, setServer] = useState("ws://localhost:8080");
  const [status, setStatus] = useState<
    "idle" | "joining" | "connected" | "reconnecting" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [bitrate, setBitrate] = useState(64);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

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

  // Mirror the live session duration into a ref so `disconnect` can report it
  // to GA4 without taking `analytics` as a dependency (which would rebuild the
  // callback — and re-bind the keyboard listener — on every 1 Hz tick).
  const elapsedSecRef = useRef(0);
  elapsedSecRef.current = analytics.elapsedSec;

  useEffect(() => {
    if (disconnected) {
      // Backend auto-reconnects with backoff; show a reconnecting state rather
      // than a fresh form (which would conflict with the in-flight reconnect).
      setStatus((s) => (s === "idle" ? s : "reconnecting"));
      clearDisconnected();
    }
  }, [disconnected, clearDisconnected]);

  useEffect(() => {
    if (reconnected) {
      setStatus((s) => (s === "idle" ? s : "connected"));
      clearReconnected();
    }
  }, [reconnected, clearReconnected]);

  useEffect(() => {
    if (serverError) {
      setError(serverError);
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
    setStatus("joining");
    setError(null);
    try {
      await invoke("join_room", { room, name: name.trim() || "Anonymous", server });
      ga.roomJoined(room);
      setStatus("connected");
    } catch (err: unknown) {
      setError(String(err));
      setStatus("error");
    }
  }, [room, name, server]);

  const disconnect = useCallback(async () => {
    try {
      await invoke("leave_room");
      ga.roomLeft(room, elapsedSecRef.current);
      resetPeers();
      setStatus("idle");
      setBitrate(64);
    } catch (err: unknown) {
      setError(String(err));
      setStatus("error");
    }
  }, [resetPeers, room]);

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
    const next = !muted;
    setMuted(next);
    invoke("set_muted", { muted: next }).catch(console.warn);
  }, [muted]);

  const handleBitrateChange = useCallback(
    (value: number) => {
      setBitrate(value);
      // UI is in kbps; the Opus encoder expects bits/s.
      invoke("set_opus_bitrate", { bitrate: value * 1000 }).catch(console.warn);
    },
    []
  );

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
  }, [status, muted, toggleMute, disconnect]);

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
              onServerChange={setServer}
              onRoomChange={setRoom}
              onNameChange={setName}
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
                    onClick={() => setAnalyticsOpen(!analyticsOpen)}
                    title="Session analytics"
                  >
                    📊
                  </button>
                  <button
                    className={`settings-toggle ${settingsOpen ? "open" : ""}`}
                    onClick={() => setSettingsOpen(!settingsOpen)}
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
