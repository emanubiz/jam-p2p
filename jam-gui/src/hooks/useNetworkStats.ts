import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** Aggregated WebRTC network metrics from the Rust backend (`session-stats`). */
export interface NetworkStats {
  avgRttMs: number | null;
  packetsLost: number;
  bytesReceived: number;
  bytesSent: number;
}

const EMPTY: NetworkStats = {
  avgRttMs: null,
  packetsLost: 0,
  bytesReceived: 0,
  bytesSent: 0,
};

/**
 * Subscribes to periodic `session-stats` events emitted by the backend
 * (polled via RTCPeerConnection::get_stats every ~2 s while connected).
 */
export function useNetworkStats(active: boolean): NetworkStats {
  const [stats, setStats] = useState<NetworkStats>(EMPTY);

  useEffect(() => {
    if (!active) {
      setStats(EMPTY);
      return;
    }

    let unlisten: (() => void) | undefined;

    listen<{
      avgRttMs?: number | null;
      packetsLost?: number;
      bytesReceived?: number;
      bytesSent?: number;
    }>("session-stats", (event) => {
      const p = event.payload;
      setStats({
        avgRttMs: p.avgRttMs ?? null,
        packetsLost: p.packetsLost ?? 0,
        bytesReceived: p.bytesReceived ?? 0,
        bytesSent: p.bytesSent ?? 0,
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [active]);

  return stats;
}

/** Compact human-readable byte count for the analytics strip. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
