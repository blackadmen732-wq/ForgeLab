import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  generateSessionKeys,
  verifyTicket,
  voiceRoomName,
  type PublicJwk,
} from "@forgelab/protocol";
import { handleRemoveMember, handleTicket, handleVoiceToken, type CommsDeps } from "./comms.js";
import type { VoiceEnv } from "./env.js";

const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const TOKEN = "header.payload.signature-of-a-real-supabase-jwt";
const NOW = Date.parse("2026-09-30T12:00:00Z");
const VOICE: VoiceEnv = {
  clientUrl: "wss://voice.example.com",
  adminUrl: "https://voice.example.com",
  apiKey: "APIkey123",
  apiSecret: "s".repeat(40),
};

async function serverKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, publicJwk: { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! } as PublicJwk };
}

function deps(
  overrides: Partial<CommsDeps> = {},
  calls: { evicted: string[]; removed: string[] } = { evicted: [], removed: [] },
): CommsDeps {
  return {
    authenticate: async (token) => (token === TOKEN ? { id: USER } : null),
    consumeRate: async () => true,
    projectAccess: async (_t, pid) => (pid === PROJECT ? { role: "member", name: "Mark" } : null),
    channelAccess: async (_t, cid) =>
      cid === CHANNEL
        ? {
            projectId: PROJECT,
            isPrivate: false,
            permissions: ["can_view", "can_join_voice", "can_speak", "can_send_messages"],
          }
        : null,
    removeMember: async (_t, pid, uid) => {
      calls.removed.push(`${pid}/${uid}`);
    },
    projectChannelIds: async () => [CHANNEL, OTHER],
    evict: async (_v, room, identity) => {
      calls.evicted.push(`${room}/${identity}`);
    },
    presenceKey: async () => {
      throw new Error("not used");
    },
    voiceEnv: () => VOICE,
    nowMs: () => NOW,
    ...overrides,
  };
}

const post = (body: unknown, authorization = `Bearer ${TOKEN}`) => ({
  method: "POST",
  authorization,
  body,
});

function decodeJwt(token: string) {
  const [h, p, s] = token.split(".");
  const expected = createHmac("sha256", VOICE.apiSecret).update(`${h}.${p}`).digest("base64url");
  return {
    validSignature: s === expected,
    claims: JSON.parse(Buffer.from(p!, "base64url").toString()),
  };
}

describe("authentication and input", () => {
  it("requires POST and a valid session for every endpoint", async () => {
    for (const handle of [handleTicket, handleVoiceToken, handleRemoveMember]) {
      expect(
        (await handle({ method: "GET", authorization: `Bearer ${TOKEN}`, body: null }, deps()))
          .status,
      ).toBe(405);
      expect((await handle(post({}, ""), deps())).status).toBe(401);
      expect(
        (await handle(post({}, "Bearer forged.token.value-that-is-long-enough"), deps())).status,
      ).toBe(401);
    }
  });

  it("rejects malformed ids and keys", async () => {
    expect((await handleVoiceToken(post({ channelId: "general" }), deps())).status).toBe(400);
    expect(
      (await handleTicket(post({ projectId: PROJECT, publicKey: { kty: "RSA" } }), deps())).status,
    ).toBe(400);
    const { publicJwk } = await generateSessionKeys();
    expect(
      (
        await handleTicket(
          post({ projectId: PROJECT, publicKey: { ...publicJwk, d: "private" } }),
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleRemoveMember(post({ projectId: PROJECT, userId: "me" }), deps())).status,
    ).toBe(400);
  });

  it("rate-limits", async () => {
    const limited = deps({ consumeRate: async () => false });
    const { publicJwk } = await generateSessionKeys();
    expect((await handleVoiceToken(post({ channelId: CHANNEL }), limited)).status).toBe(429);
    expect(
      (await handleTicket(post({ projectId: PROJECT, publicKey: publicJwk }), limited)).status,
    ).toBe(429);
  });
});

describe("voice tokens", () => {
  it("issues a short-lived token for exactly one opaque room, identity from the session", async () => {
    const response = await handleVoiceToken(
      post({ channelId: CHANNEL, userId: OTHER, room: "project_284/general" }),
      deps(),
    );
    expect(response.status).toBe(200);
    const body = response.body as {
      token: string;
      room: string;
      url: string;
      identity: string;
      canSpeak: boolean;
    };
    expect(body.room).toBe(await voiceRoomName(CHANNEL, VOICE.apiSecret));
    expect(body.identity).toBe(USER);
    expect(body.url).toBe(VOICE.clientUrl);
    const { validSignature, claims } = decodeJwt(body.token);
    expect(validSignature).toBe(true);
    expect(claims.sub).toBe(USER);
    expect(claims.iss).toBe(VOICE.apiKey);
    expect(claims.exp - NOW / 1000).toBe(LIMITS.voiceTokenTtlSec);
    expect(claims.video).toMatchObject({
      room: body.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ["microphone"],
    });
    expect(claims.video.roomAdmin).toBeUndefined();
  });

  it("makes viewers listen-only", async () => {
    const viewer = deps({
      channelAccess: async () => ({
        projectId: PROJECT,
        isPrivate: false,
        permissions: ["can_view", "can_join_voice"],
      }),
      projectAccess: async () => ({ role: "viewer", name: "Jay" }),
    });
    const response = await handleVoiceToken(post({ channelId: CHANNEL }), viewer);
    const { claims } = decodeJwt((response.body as { token: string }).token);
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canPublishSources).toEqual([]);
  });

  it("refuses channels the caller cannot access, including other projects' channels", async () => {
    expect((await handleVoiceToken(post({ channelId: OTHER }), deps())).status).toBe(403);
    const noVoice = deps({
      channelAccess: async () => ({
        projectId: PROJECT,
        isPrivate: false,
        permissions: ["can_view"],
      }),
    });
    expect((await handleVoiceToken(post({ channelId: CHANNEL }), noVoice)).status).toBe(403);
  });

  it("reports when voice is not configured, without touching the database", async () => {
    let asked = false;
    const unconfigured = deps({
      voiceEnv: () => {
        throw Object.assign(new Error("Voice is not configured."), { status: 503 });
      },
      channelAccess: async () => {
        asked = true;
        return null;
      },
    });
    await expect(
      handleVoiceToken(post({ channelId: CHANNEL }), unconfigured),
    ).rejects.toMatchObject({ status: 503 });
    expect(asked).toBe(false);
  });
});

describe("presence tickets", () => {
  it("binds the session key to the caller's verified identity and role", async () => {
    const server = await serverKey();
    const session = await generateSessionKeys();
    const d = deps({
      presenceKey: async () => ({
        privateKey: server.pair.privateKey,
        publicJwk: server.publicJwk,
      }),
    });
    const response = await handleTicket(
      post({ projectId: PROJECT, publicKey: session.publicJwk, sub: OTHER, role: "owner" }),
      d,
    );
    expect(response.status).toBe(200);
    const body = response.body as { ticket: string; serverKey: PublicJwk };
    expect(body.serverKey).toEqual(server.publicJwk);
    const claims = await verifyTicket(body.ticket, server.pair.publicKey, {
      projectId: PROJECT,
      nowMs: NOW,
    });
    expect(claims).toMatchObject({
      sub: USER,
      role: "member",
      name: "Mark",
      key: session.publicJwk,
    });
    expect(claims!.exp - claims!.iat).toBe(LIMITS.ticketTtlSec);
  });

  it("refuses non-members", async () => {
    const session = await generateSessionKeys();
    expect(
      (await handleTicket(post({ projectId: OTHER, publicKey: session.publicJwk }), deps())).status,
    ).toBe(403);
  });
});

describe("member removal", () => {
  it("removes through the database first, then evicts from every voice room of the project", async () => {
    const calls = { evicted: [] as string[], removed: [] as string[] };
    const response = await handleRemoveMember(
      post({ projectId: PROJECT, userId: OTHER }),
      deps({}, calls),
    );
    expect(response.status).toBe(200);
    expect(calls.removed).toEqual([`${PROJECT}/${OTHER}`]);
    expect(calls.evicted).toEqual([
      `${await voiceRoomName(CHANNEL, VOICE.apiSecret)}/${OTHER}`,
      `${await voiceRoomName(OTHER, VOICE.apiSecret)}/${OTHER}`,
    ]);
  });

  it("evicts nobody when the database refuses", async () => {
    const calls = { evicted: [] as string[], removed: [] as string[] };
    const refusing = deps(
      {
        removeMember: async () => {
          throw Object.assign(new Error("You cannot remove that member."), { status: 403 });
        },
      },
      calls,
    );
    await expect(
      handleRemoveMember(post({ projectId: PROJECT, userId: OTHER }), refusing),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.evicted).toEqual([]);
  });
});
