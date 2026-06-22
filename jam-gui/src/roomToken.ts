/** Convert a WebSocket signaling URL to an HTTP(S) base for REST calls. */
export function wsToHttpBase(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) return `https://${wsUrl.slice(6)}`;
  if (wsUrl.startsWith("ws://")) return `http://${wsUrl.slice(5)}`;
  return wsUrl;
}

export type RoomToken = { exp: number; sig: string };

/**
 * Fetch an HMAC room token when the server has ROOM_AUTH_SECRET configured.
 * Returns null when auth is disabled (503) or the request fails.
 */
export async function fetchRoomToken(
  httpBase: string,
  room: string
): Promise<RoomToken | null> {
  try {
    const res = await fetch(
      `${httpBase}/room/${encodeURIComponent(room)}/token`
    );
    if (res.status === 503) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: RoomToken };
    return data.token ?? null;
  } catch {
    return null;
  }
}
