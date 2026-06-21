import { useEffect, useRef, useState } from "react";

/** Read-only snapshot of session analytics surfaced to the UI. */
export interface SessionAnalytics {
  /** Whole seconds since the session first reached `connected`. */
  elapsedSec: number;
  /** Participants right now (remote peers + the local musician). */
  participants: number;
  /** Highest participant count seen during this session. */
  peakParticipants: number;
  /** Number of remote peer arrivals observed this session (cumulative). */
  peerJoins: number;
  /** Times the session dropped and recovered (reconnecting → connected). */
  reconnects: number;
}

const EMPTY: SessionAnalytics = {
  elapsedSec: 0,
  participants: 0,
  peakParticipants: 0,
  peerJoins: 0,
  reconnects: 0,
};

type Status = "idle" | "joining" | "connected" | "reconnecting" | "error";

/**
 * Derives lightweight, privacy-safe session analytics purely from existing UI
 * state — no backend calls, no persistence, no network of its own. It observes
 * the session `status` and the live peer count and accumulates a few useful
 * aggregates (duration, peak size, churn, reconnects). Everything resets when
 * the session returns to `idle`, so each connection starts from a clean slate.
 */
export function useSessionAnalytics(
  status: Status,
  peerCount: number
): SessionAnalytics {
  const [analytics, setAnalytics] = useState<SessionAnalytics>(EMPTY);

  // Refs hold the running session so the 1 Hz ticker and the status/peer
  // effects can mutate without re-subscribing on every render.
  const startRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const joinsRef = useRef(0);
  const reconnectsRef = useRef(0);
  const prevStatusRef = useRef<Status>("idle");
  const prevPeersRef = useRef(0);

  // Track status transitions: first connect starts the clock; a
  // reconnecting→connected recovery bumps the reconnect counter; returning to
  // idle wipes the session.
  useEffect(() => {
    const prev = prevStatusRef.current;

    if (status === "connected" && startRef.current === null) {
      startRef.current = Date.now();
    }
    if (status === "connected" && prev === "reconnecting") {
      reconnectsRef.current += 1;
    }
    if (status === "idle") {
      startRef.current = null;
      peakRef.current = 0;
      joinsRef.current = 0;
      reconnectsRef.current = 0;
      prevPeersRef.current = 0;
      setAnalytics(EMPTY);
    }

    prevStatusRef.current = status;
  }, [status]);

  // Track peer-count churn: any net increase counts as join(s); peak is a
  // high-water mark over the whole session.
  useEffect(() => {
    if (status === "idle") return;
    const participants = peerCount + 1; // include the local musician
    if (participants > peakRef.current) peakRef.current = participants;
    if (peerCount > prevPeersRef.current) {
      joinsRef.current += peerCount - prevPeersRef.current;
    }
    prevPeersRef.current = peerCount;
  }, [peerCount, status]);

  // 1 Hz tick while the session is live (connected or reconnecting) keeps the
  // duration and derived aggregates fresh without spamming renders.
  useEffect(() => {
    if (status !== "connected" && status !== "reconnecting") return;
    const id = window.setInterval(() => {
      const start = startRef.current;
      setAnalytics({
        elapsedSec: start ? Math.floor((Date.now() - start) / 1000) : 0,
        participants: peerCount + 1,
        peakParticipants: peakRef.current,
        peerJoins: joinsRef.current,
        reconnects: reconnectsRef.current,
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, peerCount]);

  return analytics;
}
