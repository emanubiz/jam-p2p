import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Peer } from "../types";

export function useTauriEvents() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [localLevel, setLocalLevel] = useState(0);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    let cleanups: (() => void)[] = [];

    async function setup() {
      const u1 = await listen<string>("peer-joined", (event) => {
        setPeers((prev) => {
          if (prev.find((p) => p.id === event.payload)) return prev;
          return [
            ...prev,
            {
              id: event.payload,
              name: `Musician ${event.payload.slice(0, 4)}`,
              volume: 1.0,
              level: 0,
            },
          ];
        });
      });

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

      cleanups = [u1, u2, u3, u4, u5];
    }

    setup();
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const clearDisconnected = useCallback(() => setDisconnected(false), []);

  const resetPeers = useCallback(() => {
    setPeers([]);
    setLocalLevel(0);
    setDisconnected(false);
  }, []);

  const updatePeerVolume = useCallback((peerId: string, volume: number) => {
    setPeers((prev) =>
      prev.map((p) => (p.id === peerId ? { ...p, volume } : p))
    );
  }, []);

  return { peers, localLevel, disconnected, clearDisconnected, resetPeers, updatePeerVolume };
}
