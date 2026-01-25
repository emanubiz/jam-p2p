
// App.tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { usePeers } from "./hooks/usePeers";

function App() {
  const [room, setRoom] = useState("studio1");
  const [name] = useState(() => "player" + Math.floor(Math.random() * 100));
  const [server, setServer] = useState("ws://localhost:8080");
  const [status, setStatus] = useState<"idle" | "joining" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const { peers, addPeer, removePeer, setPeerVolume, setPeerLevel } = usePeers();

  useEffect(() => {
    let unlisten: any;
    async function setup() {
      unlisten = await listen<string>("peer-joined", (event) => {
        addPeer({ 
          id: event.payload, 
          name: `Musician ${event.payload.slice(0, 4)}`, 
          volume: 1.0,
          level: 0
        });
      });
      // listen for per-peer level (VM meter) updates from backend
      await listen<{ id: string; level: number }>("peer-level", (ev) => {
        setPeerLevel(ev.payload.id, ev.payload.level);
      });
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, [addPeer]);

  async function connect() {
    setStatus("joining");
    setError(null);
    try {
      await invoke("join_room", { room, name, server });
      setStatus("connected");
    } catch (err: any) {
      setError(String(err));
      setStatus("error");
    }
  }

  function onVolumeChange(peerId: string, v: number) {
    setPeerVolume(peerId, v);
    invoke("set_volume", { peer_id: peerId, vol: v }).catch(console.warn);
  }

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
                ) : "Connect to Session"}
              </button>
            </div>
          )}

          <div className="status-indicator">
            <div className={`status-dot status-${status}`} />
            <span className={`status-text status-${status}`}>
              {status === "idle" && "Ready"}
              {status === "joining" && "Establishing Connection"}
              {status === "connected" && "Live Session"}
              {status === "error" && "Connection Failed"}
            </span>
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
                <div className="peer-count">
                  {peers.length} {peers.length === 1 ? 'PEER' : 'PEERS'}
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
                        <button 
                          className="remove-btn"
                          onClick={() => removePeer(p.id)}
                        >×</button>
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