/**
 * Google Analytics 4 event sender.
 *
 * This is distinct from `useSessionAnalytics` (which shows live stats *to the
 * user* inside the app). This module reports aggregate, privacy-safe traffic
 * events *to GA4* so real usage numbers (active users, sessions, retention,
 * platform) can be presented to ad networks / sponsors when monetizing.
 *
 * No-ops cleanly if the gtag snippet in index.html hasn't loaded (e.g. in the
 * browser dev server with no network, or before the Measurement ID is set).
 */
declare function gtag(...args: unknown[]): void;

function send(eventName: string, params?: Record<string, unknown>) {
  if (typeof gtag === "undefined") return;
  gtag("event", eventName, params);
}

export const ga = {
  roomJoined: (room: string) => send("room_joined", { room_name: room }),
  roomLeft: (room: string, sessionSeconds: number) =>
    send("room_left", { room_name: room, session_seconds: sessionSeconds }),
  peerConnected: (totalPeers: number) =>
    send("peer_connected", { peer_count: totalPeers }),
  peerDisconnected: (totalPeers: number) =>
    send("peer_disconnected", { peer_count: totalPeers }),
};
