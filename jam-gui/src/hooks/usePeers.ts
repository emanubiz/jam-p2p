import { useState, useCallback } from "react";
import type { Peer } from "../types";

export function usePeers() {
  const [peers, setPeers] = useState<Peer[]>([]);

  const addPeer = useCallback((p: Peer) => {
    setPeers(prev => {
      if (prev.find(x => x.id === p.id)) return prev;
      return [...prev, { ...p, level: p.level ?? 0 }];
    });
  }, []);

  const removePeer = useCallback((id: string) => {
    setPeers(prev => prev.filter(p => p.id !== id));
  }, []);

  const setPeerVolume = useCallback((id: string, volume: number) => {
    setPeers(prev => prev.map(p => p.id === id ? { ...p, volume } : p));
  }, []);

  const setPeerLevel = useCallback((id: string, level: number) => {
    setPeers(prev => prev.map(p => p.id === id ? { ...p, level } : p));
  }, []);

  return { peers, addPeer, removePeer, setPeerVolume, setPeerLevel } as const;
}
