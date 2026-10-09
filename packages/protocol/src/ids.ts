const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Realtime topic carrying presence and collaboration events for a project. */
export function projectTopic(projectId: string): string {
  if (!isUuid(projectId)) throw new Error("projectTopic: invalid project id");
  return `project:${projectId.toLowerCase()}`;
}

/** Realtime topic carrying new chat messages for one channel. */
export function chatTopic(channelId: string): string {
  if (!isUuid(channelId)) throw new Error("chatTopic: invalid channel id");
  return `chat:${channelId.toLowerCase()}`;
}

/** The user's personal work area inside a project. */
export function personalWorkspaceId(userId: string): string {
  return `ws:${userId}`;
}

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Opaque, stable voice-room name for a channel: `fl_` + HMAC-SHA256(secret, channel id).
 * Knowing a room name grants nothing — the signed token's room grant is the gate — but an
 * opaque name leaks nothing about projects or channels either.
 */
export async function voiceRoomName(channelId: string, secret: string): Promise<string> {
  if (!isUuid(channelId)) throw new Error("voiceRoomName: invalid channel id");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`forgelab-room:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(channelId.toLowerCase())),
  );
  return `fl_${base64url(mac.slice(0, 18))}`;
}
