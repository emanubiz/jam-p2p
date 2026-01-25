import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { usePeers } from "./hooks/usePeers";

function App() {
  const [room, setRoom] = useState("studio1");
  const [name, setName] = useState(() => "player" + Math.floor(Math.random() * 100));
  const [server, setServer] = useState("ws://localhost:8080");
  const [status, setStatus] = useState<"idle" | "joining" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const { peers, addPeer, removePeer, setPeerVolume } = usePeers();

  useEffect(() => {
    let unlisten: any;
    async function setup() {
      unlisten = await listen<string>("peer-joined", (event) => {
        addPeer({ 
          id: event.payload, 
          name: `Musician ${event.payload.slice(0, 4)}`, 
          volume: 1.0 
        });
      });
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, [addPeer]);

  async function connect() {
    setStatus("joining");
    setError(null);
    try {
      // Aspetta la conferma reale dal backend
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
    <div className="container">
      <h1>🎸 Jam P2P Native</h1>

      <div className="card">
        <label>Server:</label>
        <input value={server} onChange={(e) => setServer(e.target.value)} />
        <label>Stanza:</label>
        <input value={room} onChange={(e) => setRoom(e.target.value)} />
        <button onClick={connect} disabled={status === "joining"}>Entra</button>
      </div>

      <p className="status">
        Stato: <b>{status}</b>
        {error && <div style={{color: '#ff7675', fontSize: '0.9rem', marginTop: '5px'}}>{error}</div>}
      </p>

      {status === "connected" && (
        <div className="mixer">
          <h3>Mixer Live</h3>
          {peers.length === 0 && <p>In attesa di altri musicisti...</p>}
          {peers.map(p => (
            <div key={p.id} className="peer-row">
              <div className="peer-meta">
                <strong>{p.name}</strong>
                <button onClick={() => removePeer(p.id)}>X</button>
              </div>
              <input 
                type="range" min={0} max={1} step={0.01} 
                value={p.volume} 
                onChange={(e) => onVolumeChange(p.id, Number(e.target.value))} 
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;