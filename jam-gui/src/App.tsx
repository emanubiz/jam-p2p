import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { usePeers } from "./hooks/usePeers";

function App() {
  const [room, setRoom] = useState("studio1");
  const [name, setName] = useState(() => "player" + Math.floor(Math.random() * 100));
  const [server, setServer] = useState("ws://localhost:8080");
  const [status, setStatus] = useState<"idle"|"joining"|"connected"|"error">("idle");
  const [error, setError] = useState<string | null>(null);

  const { peers, addPeer, removePeer, setPeerVolume } = usePeers();

  async function connect() {
    setStatus("joining");
    setError(null);
    try {
      await invoke("join_room", { room, name, server });
      setStatus("connected");
    } catch (err: any) {
      console.error(err);
      setError(String(err));
      setStatus("error");
    }
  }

  function onVolumeChange(peerId: string, v: number) {
    setPeerVolume(peerId, v);
    invoke("set_volume", { peer_id: peerId, vol: v }).catch(e => console.warn(e));
  }

  return (
    <div className="container">
      <h1>🎸 Jam P2P Native</h1>

      <div className="card">
        <label>Server WS:</label>
        <input value={server} onChange={(e) => setServer(e.target.value)} />

        <label>Room:</label>
        <input value={room} onChange={(e) => setRoom(e.target.value)} />

        <label>Name:</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <button onClick={connect} disabled={status === "joining"}>Join Session</button>
      </div>

      <p className="status">Status: <b>{status}</b>{error && <span className="error"> — {error}</span>}</p>

      {status === "connected" && (
        <div className="mixer">
          <h3>Peers</h3>
          {peers.length === 0 && <div>No peers currently connected.</div>}
          {peers.map(p => (
            <div key={p.id} className="peer-row">
              <div className="peer-meta">
                <strong>{p.name || p.id}</strong>
                <button onClick={() => removePeer(p.id)}>Remove</button>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={p.volume} onChange={(e) => onVolumeChange(p.id, Number(e.target.value))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;