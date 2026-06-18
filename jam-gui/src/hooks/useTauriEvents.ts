import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Peer } from "../types";

export function useTauriEvents() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [localLevel, setLocalLevel] = useState(0);
  const [disconnected, setDisconnected] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let cleanups: (() => void)[] = [];

    async function setup() {
      const u1 = await listen<{ id: string; name: string }>(
        "peer-joined",
        (event) => {
          const { id, name } = event.payload;
          setPeers((prev) => {
            if (prev.find((p) => p.id === id)) return prev;
            return [
              ...prev,
              {
                id,
                name: name && name.trim() ? name : `Musician ${id.slice(0, 4)}`,
                volume: 1.0,
                level: 0,
              },
            ];
          });
        }
      );

      const u2 = await listen<{ id: string; level: number }>(
        "peer-level",
        (ev) => {
          setPeers((prev) =>
            prev.map((p) =>
              p.id === ev.payload.id ? { ...p, level: ev.payload.level } : p
            )
          );
        }
      );

      const u3 = await listen("disconnected", () => {
        setDisconnected(true);
        setLocalLevel(0);
      });

      const u4 = await listen<string>("peer-left", (ev) => {
        setPeers((prev) => prev.filter((p) => p.id !== ev.payload));
      });

      const u5 = await listen<{ level: number }>("local-level", (ev) => {
        setLocalLevel(ev.payload.level);
      });

      // Emitted on every Welcome — i.e. initial join AND successful auto-reconnect.
      const u6 = await listen("connected", () => {
        setReconnected(true);
        setDisconnected(false);
      });

      const u7 = await listen<string>("server-error", (ev) => {
        setServerError(ev.payload);
      });

      cleanups = [u1, u2, u3, u4, u5, u6, u7];
    }

    setup();
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const clearDisconnected = useCallback(() => setDisconnected(false), []);
  const clearReconnected = useCallback(() => setReconnected(false), []);
  const clearServerError = useCallback(() => setServerError(null), []);

  const resetPeers = useCallback(() => {
    setPeers([]);
    setLocalLevel(0);
    setDisconnected(false);
    setReconnected(false);
    setServerError(null);
  }, []);

  const updatePeerVolume = useCallback((peerId: string, volume: number) => {
    setPeers((prev) =>
      prev.map((p) => (p.id === peerId ? { ...p, volume } : p))
    );
  }, []);

  return {
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
  };
}
