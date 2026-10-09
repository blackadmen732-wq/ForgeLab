import {
  LIMITS,
  isProjectRole,
  isUuid,
  signTicket,
  voiceRoomName,
  type ProjectRole,
  type PublicJwk,
  type TicketClaims,
} from "@forgelab/protocol";
import type { VoiceEnv } from "./env.js";
import { bearer, fail, type ApiRequest, type ApiResponse } from "./http.js";
import { mintAccessToken } from "./livekit.js";

/**
 * The communication endpoints. Each one derives identity from the caller's Supabase JWT,
 * asks Postgres — *as that user* — what they may do, and only then signs anything.
 * Nothing the browser sends about who it is, or what role it has, is ever used.
 *
 *   POST /api/comms/ticket         { projectId, publicKey }  → signed presence ticket
 *   POST /api/voice/token          { channelId }             → 5-minute voice-room token
 *   POST /api/comms/remove-member  { projectId, userId }     → remove, then evict from voice
 */
export interface ProjectAccess {
  readonly role: ProjectRole;
  readonly name: string;
}

export interface ChannelAccess {
  readonly projectId: string;
  readonly isPrivate: boolean;
  readonly permissions: readonly string[];
}

export interface CommsDeps {
  authenticate(token: string): Promise<{ id: string } | null>;
  consumeRate(userId: string, bucket: string, max: number, windowSec: number): Promise<boolean>;
  /** Evaluated with the caller's JWT: null unless the caller is a member. */
  projectAccess(token: string, projectId: string): Promise<ProjectAccess | null>;
  /** Evaluated with the caller's JWT: null unless the caller may view the channel. */
  channelAccess(token: string, channelId: string): Promise<ChannelAccess | null>;
  /** Evaluated with the caller's JWT; the database enforces who may remove whom. */
  removeMember(token: string, projectId: string, userId: string): Promise<void>;
  /** Service role: every channel of a project (for voice eviction). */
  projectChannelIds(projectId: string): Promise<readonly string[]>;
  evict(voice: VoiceEnv, room: string, identity: string): Promise<void>;
  presenceKey(): Promise<{ privateKey: CryptoKey; publicJwk: PublicJwk }>;
  voiceEnv(): VoiceEnv;
  nowMs(): number;
}

const rateLimited = fail(429, "Too many requests. Try again in a moment.");

async function identify(
  request: ApiRequest,
  deps: CommsDeps,
): Promise<{ token: string; userId: string } | ApiResponse> {
  if (request.method !== "POST") return fail(405, "Use POST.");
  const token = bearer(request.authorization);
  if (token === null) return fail(401, "Sign in first.");
  const user = await deps.authenticate(token);
  if (user === null) return fail(401, "Your session has expired. Sign in again.");
  return { token, userId: user.id };
}

const isResponse = (value: unknown): value is ApiResponse =>
  typeof value === "object" && value !== null && "status" in value && "body" in value;

function isPublicJwk(value: unknown): value is PublicJwk {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const coord = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
  return (
    r["kty"] === "EC" &&
    r["crv"] === "P-256" &&
    coord(r["x"]) &&
    coord(r["y"]) &&
    r["d"] === undefined
  );
}

/* ---------------------------------------------------------------------------------- */

export async function handleTicket(request: ApiRequest, deps: CommsDeps): Promise<ApiResponse> {
  const who = await identify(request, deps);
  if (isResponse(who)) return who;
  const body = request.body as { projectId?: unknown; publicKey?: unknown } | null;
  if (!isUuid(body?.projectId)) return fail(400, "projectId must be a UUID.");
  if (!isPublicJwk(body?.publicKey)) return fail(400, "publicKey must be a P-256 public JWK.");
  if (!(await deps.consumeRate(who.userId, "ticket", 30, 60))) return rateLimited;

  const access = await deps.projectAccess(who.token, body.projectId);
  if (access === null || !isProjectRole(access.role))
    return fail(403, "You are not a member of this project.");

  const iat = Math.floor(deps.nowMs() / 1000);
  const claims: TicketClaims = {
    v: 1,
    sub: who.userId,
    pid: body.projectId.toLowerCase(),
    role: access.role,
    name: access.name.slice(0, 80),
    key: { kty: "EC", crv: "P-256", x: body.publicKey.x, y: body.publicKey.y },
    iat,
    exp: iat + LIMITS.ticketTtlSec,
  };
  const key = await deps.presenceKey();
  return {
    status: 200,
    body: {
      ticket: await signTicket(claims, key.privateKey),
      serverKey: key.publicJwk,
      expiresAt: claims.exp,
      role: access.role,
    },
  };
}

export async function handleVoiceToken(request: ApiRequest, deps: CommsDeps): Promise<ApiResponse> {
  const who = await identify(request, deps);
  if (isResponse(who)) return who;
  const body = request.body as { channelId?: unknown } | null;
  if (!isUuid(body?.channelId)) return fail(400, "channelId must be a UUID.");
  const voice = deps.voiceEnv(); // 503 when voice is not configured
  if (
    !(await deps.consumeRate(
      who.userId,
      "voice",
      LIMITS.voiceTokenRateCount,
      LIMITS.voiceTokenRateWindowSec,
    ))
  )
    return rateLimited;

  // The channel id from the browser is only a question; Postgres answers it for this user.
  const channel = await deps.channelAccess(who.token, body.channelId);
  if (channel === null || !channel.permissions.includes("can_join_voice")) {
    return fail(403, "You cannot join voice in that channel.");
  }
  const project = await deps.projectAccess(who.token, channel.projectId);
  if (project === null) return fail(403, "You cannot join voice in that channel.");

  const canSpeak = channel.permissions.includes("can_speak");
  const room = await voiceRoomName(body.channelId, voice.apiSecret);
  const nowSec = Math.floor(deps.nowMs() / 1000);
  const token = mintAccessToken({
    apiKey: voice.apiKey,
    apiSecret: voice.apiSecret,
    identity: who.userId,
    name: project.name.slice(0, 80),
    metadata: JSON.stringify({ role: project.role }),
    ttlSec: LIMITS.voiceTokenTtlSec,
    nowSec,
    grant: {
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: canSpeak,
      // Microphone audio only: no camera, no screen, no data channel.
      canPublishSources: canSpeak ? ["microphone"] : [],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    },
  });
  return {
    status: 200,
    body: {
      url: voice.clientUrl,
      token,
      room,
      identity: who.userId,
      canSpeak,
      expiresAt: nowSec + LIMITS.voiceTokenTtlSec,
    },
  };
}

export async function handleRemoveMember(
  request: ApiRequest,
  deps: CommsDeps,
): Promise<ApiResponse> {
  const who = await identify(request, deps);
  if (isResponse(who)) return who;
  const body = request.body as { projectId?: unknown; userId?: unknown } | null;
  if (!isUuid(body?.projectId) || !isUuid(body?.userId))
    return fail(400, "projectId and userId must be UUIDs.");
  if (!(await deps.consumeRate(who.userId, "admin", 30, 60))) return rateLimited;

  await deps.removeMember(who.token, body.projectId, body.userId);

  // They can no longer obtain tokens; end the voice session they may already have.
  let evicted = 0;
  let voice: VoiceEnv | null;
  try {
    voice = deps.voiceEnv();
  } catch {
    voice = null; // voice not configured: nothing to evict
  }
  if (voice !== null) {
    for (const channelId of await deps.projectChannelIds(body.projectId)) {
      try {
        await deps.evict(voice, await voiceRoomName(channelId, voice.apiSecret), body.userId);
        evicted += 1;
      } catch (error) {
        console.error("voice eviction failed:", error);
      }
    }
  }
  return { status: 200, body: { removed: true, roomsChecked: evicted } };
}
