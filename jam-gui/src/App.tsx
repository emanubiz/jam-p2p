import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Peer } from "./types";
import "./App.css";

function App() {
  const [room, setRoom] = useState("studio1");
  const [server, setServer] = useState("ws://localhost:8080");
  const [status, setStatus] = useState<"idle" | "joining" | "connected" | "disconnected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [muted, setMuted] = useState(false);
  const [localLevel, setLocalLevel] = useState(0);
  const [bitrate, setBitrate] = useState(64);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cleanups: (() => void)[] = [];
    async function setup() {
      const u1 = await listen<string>("peer-joined", (event) => {
        setPeers(prev => {
          if (prev.find(p => p.id === event.payload)) return prev;
          return [...prev, { id: event.payload, name: `Musician ${event.payload.slice(0, 4)}`, volume: 1.0, level: 0 }];
        });
      });
      const u2 = await listen<{ id: string; level: number }>("peer-level", (ev) => {
        setPeers(prev => prev.map(p => p.id === ev.payload.id ? { ...p, level: ev.payload.level } : p));
      });
      const u3 = await listen("disconnected", () => {
        setStatus("disconnected");
        setLocalLevel(0);
      });
      const u4 = await listen<string>("peer-left", (ev) => {
        setPeers(prev => prev.filter(p => p.id !== ev.payload));
      });
      const u5 = await listen<{ level: number }>("local-level", (ev) => {
        setLocalLevel(ev.payload.level);
      });
      cleanups = [u1, u2, u3, u4, u5];
    }
    setup();
    return () => { cleanups.forEach(fn => fn()); };
  }, []);

  async function connect() {
    setStatus("joining");
    setError(null);
    try {
      await invoke("join_room", { room, name: "user", server });
      setStatus("connected");
    } catch (err: any) {
      setError(String(err));
      setStatus("error");
    }
  }

  async function disconnect() {
    try {
      await invoke("leave_room");
      setPeers([]);
      setStatus("idle");
      setLocalLevel(0);
      setBitrate(64);
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

  function onVolumeChange(peerId: string, v: number) {
    setPeers(prev => prev.map(p => p.id === peerId ? { ...p, volume: v } : p));
    invoke("set_volume", { peerId, vol: v }).catch(console.warn);
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    invoke("set_muted", { muted: next }).catch(console.warn);
  }

  function handleBitrateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setBitrate(value);
    invoke("set_opus_bitrate", { bitrate: value }).catch(console.warn);
  }

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
  }, [status, muted]);

  // Connection quality based on status
  const connectionQuality = status === "connected" ? "good"
    : status === "joining" ? "fair"
    : status === "disconnected" ? "poor"
    : "poor";

  const buttonLabel = status === "joining" ? "Connecting"
    : status === "disconnected" ? "Reconnect"
    : "Connect to Session";

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
              <path d="M9 18V5l12-2v13" stroke="url(#grad1)" strokeWidth="2" strokeLinecap="square"/>
              <circle cx="6" cy="18" r="3" stroke="url(#grad1)" strokeWidth="2"/>
              <circle cx="18" cy="16" r="3" stroke="url(#grad1)" strokeWidth="2"/>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="#8b5cf6"/>
                  <stop offset="100%" stopColor="#ec4899"/>
                </linearGradient>
              </defs>
            </svg>
            <h1 className="logo-text">JAM P2P</h1>
          </div>
          <p className="logo-subtitle">Professional Audio Network</p>
        </div>

        <div className="main-card">
          <div className={`status-bar status-${status}`} />

          {(status === "idle" || status === "joining" || status === "error") && (
            <div className="connection-form">
              <div className="input-group">
                <label className="input-label">Server Endpoint</label>
                <input
                  className="input-field input-mono"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  disabled={status === "joining"}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Room ID</label>
                <input
                  className="input-field"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  disabled={status === "joining"}
                />
              </div>

              <button
                className={`connect-btn ${status === "joining" ? "connecting" : ""}`}
                onClick={connect}
                disabled={status === "joining"}
              >
                {status === "joining" ? (
                  <>
                    <span className="spinner" />
                    Connecting
                  </>
                ) : buttonLabel}
              </button>
            </div>
          )}

          <div className="status-indicator">
            <div className={`status-dot status-${status}`} />
            <span className={`status-text status-${status}`}>
              {status === "idle" && "Ready"}
              {status === "joining" && "Establishing Connection"}
              {status === "connected" && "Live Session"}
              {status === "disconnected" && "Disconnected — tap Reconnect"}
              {status === "error" && "Connection Failed"}
            </span>
            {status === "connected" && (
              <div className={`quality-badge quality-${connectionQuality}`} title="Connection quality">
                {connectionQuality === "good" && "● GOOD"}
                {connectionQuality === "fair" && "● FAIR"}
                {connectionQuality === "poor" && "● POOR"}
              </div>
            )}
          </div>

          {error && (
            <div className="error-box">
              <div className="error-title">ERROR</div>
              {error}
            </div>
          )}

          {status === "connected" && (
            <div className="mixer-section">
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
                    {peers.length} {peers.length === 1 ? 'PEER' : 'PEERS'}
                  </div>
                  <button
                    className={`settings-toggle ${settingsOpen ? "open" : ""}`}
                    onClick={() => setSettingsOpen(!settingsOpen)}
                    title="Settings"
                  >
                    ⚙
                  </button>
                </div>
              </div>

              {/* Settings Panel */}
              <div className={`settings-panel ${settingsOpen ? "open" : ""}`}>
                <div className="settings-group">
                  <label className="settings-label">
                    Opus Bitrate
                    <span className="settings-value">{bitrate} kbps</span>
                  </label>
                  <div className="bitrate-control">
                    <span className="bitrate-range-label">16</span>
                    <input
                      type="range"
                      className="bitrate-slider"
                      min={16}
                      max={192}
                      step={1}
                      value={bitrate}
                      onChange={handleBitrateChange}
                    />
                    <span className="bitrate-range-label">192</span>
                  </div>
                </div>
              </div>

              <div className="local-mic-card">
                <div className="peer-header">
                  <div className="peer-info">
                    <div className="peer-avatar local">🎤</div>
                    <div className="peer-details">
                      <div className="peer-name">Local Mic</div>
                      <div className="peer-id">MY INPUT</div>
                    </div>
                  </div>
                </div>
                <div className="local-level-meter">
                  {[...Array(20)].map((_, i) => (
                    <div
                      key={i}
                      className={`local-level-bar ${i < localLevel * 20 ? (i < 14 ? 'blue-low' : i < 18 ? 'blue-mid' : 'blue-high') : ''}`}
                    />
                  ))}
                </div>
                <div className="local-level-label">
                  LEVEL: {Math.round(localLevel * 100)}%
                </div>
              </div>

              {peers.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">⌛</div>
                  <div className="empty-text">Waiting for peers</div>
                </div>
              ) : (
                <div className="peers-list">
                  {peers.map(p => (
                    <div key={p.id} className="peer-card">
                      <div className="peer-header">
                        <div className="peer-info">
                          <div className="peer-avatar">🎵</div>
                          <div className="peer-details">
                            <div className="peer-name">{p.name}</div>
                            <div className="peer-id">{p.id.slice(0, 8)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="volume-control">
                        <div className="volume-label">VOL</div>
                        <div className="volume-slider-wrapper">
                          <div className="volume-track">
                            <div className="volume-fill" style={{width: `${p.volume * 100}%`}} />
                          </div>
                          <input
                            type="range"
                            className="volume-input"
                            min={0}
                            max={1}
                            step={0.01}
                            value={p.volume}
                            onChange={(e) => onVolumeChange(p.id, Number(e.target.value))}
                          />
                        </div>
                        <div className="volume-value">{Math.round(p.volume * 100)}%</div>
                      </div>

                      <div className="level-meter">
                        {[...Array(20)].map((_, i) => (
                          <div
                            key={i}
                            className={`level-bar ${i < (p.level ?? 0) * 20 ? i < 14 ? 'green' : i < 18 ? 'yellow' : 'red' : ''}`}
                          />
                        ))}
                      </div>
                    </div>
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
