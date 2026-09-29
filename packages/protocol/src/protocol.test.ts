import { describe, expect, it } from "vitest";
import {
  LIMITS,
  canAssignRole,
  canRemoveMember,
  chatTopic,
  findRefs,
  generateSessionKeys,
  importPublicKey,
  normaliseMessage,
  parseCollabEvent,
  parsePresenceState,
  parseRefs,
  permissionsFor,
  projectTopic,
  segments,
  signEnvelope,
  signTicket,
  verifyEnvelope,
  verifyTicket,
  voiceRoomName,
  type TicketClaims,
} from "./index.js";

const P = "11111111-1111-4111-8111-111111111111";
const OTHER_P = "99999999-9999-4999-8999-999999999999";
const U = "22222222-2222-4222-8222-222222222222";
const U2 = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-09-30T12:00:00Z");

async function serverKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return pair;
}

async function ticketFor(server: CryptoKeyPair, sub: string, pid = P, exp = NOW / 1000 + 600) {
  const session = await generateSessionKeys();
  const claims: TicketClaims = {
    v: 1,
    sub,
    pid,
    role: "member",
    name: "Mark",
    key: session.publicJwk,
    iat: NOW / 1000,
    exp,
  };
  return { session, ticket: await signTicket(claims, server.privateKey) };
}

describe("permissions", () => {
  it("grants by role", () => {
    expect([...permissionsFor("viewer")]).toEqual(["can_view", "can_join_voice"]);
    expect(permissionsFor("member").has("can_send_messages")).toBe(true);
    expect(permissionsFor("member").has("can_invite")).toBe(false);
    expect(permissionsFor("admin").has("can_remove_member")).toBe(true);
    expect(permissionsFor(null).size).toBe(0);
  });

  it("private channels need a channel-member row below admin", () => {
    expect(permissionsFor("member", { isPrivate: true, isChannelMember: false }).size).toBe(0);
    expect(
      permissionsFor("member", { isPrivate: true, isChannelMember: true }).has("can_view"),
    ).toBe(true);
    expect(
      permissionsFor("admin", { isPrivate: true, isChannelMember: false }).has("can_view"),
    ).toBe(true);
  });

  it("limits removal and role assignment by rank", () => {
    expect(canRemoveMember("owner", "admin")).toBe(true);
    expect(canRemoveMember("admin", "admin")).toBe(false);
    expect(canRemoveMember("admin", "viewer")).toBe(true);
    expect(canRemoveMember("owner", "owner")).toBe(false);
    expect(canAssignRole("admin", "member", "admin")).toBe(false);
    expect(canAssignRole("admin", "viewer", "member")).toBe(true);
    expect(canAssignRole("owner", "member", "owner")).toBe(false);
  });
});

describe("ids and rooms", () => {
  it("builds topics only from valid ids", () => {
    expect(projectTopic(P)).toBe(`project:${P}`);
    expect(chatTopic(U)).toBe(`chat:${U}`);
    expect(() => projectTopic("project:x")).toThrow();
  });

  it("derives opaque, stable, secret-dependent room names", async () => {
    const a = await voiceRoomName(P, "secret-1");
    expect(a).toMatch(/^fl_[A-Za-z0-9_-]{24}$/);
    expect(await voiceRoomName(P, "secret-1")).toBe(a);
    expect(await voiceRoomName(P, "secret-2")).not.toBe(a);
    expect(await voiceRoomName(OTHER_P, "secret-1")).not.toBe(a);
    expect(a).not.toContain(P.slice(0, 8));
  });
});

describe("schemas", () => {
  it("validates presence strictly", () => {
    const ok = {
      voiceChannelId: U,
      mic: "muted",
      deafened: false,
      activity: "building",
      workspaceId: `ws:${U}`,
      focus: "magnet-34",
    };
    expect(parsePresenceState(ok)).not.toBeNull();
    expect(parsePresenceState({ ...ok, mic: "shouting" })).toBeNull();
    expect(parsePresenceState({ ...ok, voiceChannelId: "general" })).toBeNull();
    expect(parsePresenceState({ ...ok, focus: "<script>" })).toBeNull();
  });

  it("validates collaboration events strictly", () => {
    expect(
      parseCollabEvent({
        type: "view.share",
        camera: { position: [1, 2, 3], target: [0, 0, 0], projection: "perspective" },
        focus: ["pump"],
        note: null,
      }),
    ).not.toBeNull();
    expect(
      parseCollabEvent({
        type: "view.share",
        camera: { position: [1, 2], target: [0, 0, 0], projection: "perspective" },
        focus: [],
        note: null,
      }),
    ).toBeNull();
    expect(parseCollabEvent({ type: "control.take", target: U })).toBeNull();
  });
});

describe("messages", () => {
  it("normalises text and enforces length", () => {
    expect(normaliseMessage("  hi\u0000 there\n\n\n\nok ")).toBe("hi there\n\nok");
    expect(normaliseMessage("   ")).toBeNull();
    expect(normaliseMessage("x".repeat(LIMITS.messageMaxChars + 1))).toBeNull();
  });

  it("finds references to known objects and renders segments", () => {
    const text = "Look at @magnet-34 and @nobody, then @pump.";
    const refs = findRefs(text, (id) => (id === "magnet-34" || id === "pump" ? "component" : null));
    expect(refs.map((r) => text.slice(r.start, r.end))).toEqual(["@magnet-34", "@pump"]);
    expect(parseRefs(refs, text)).toEqual(refs);
    expect(parseRefs([{ kind: "component", id: "x", start: 5, end: 999 }], text)).toEqual([]);
    const segs = segments(text, refs);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => "ref" in s)).toHaveLength(2);
  });
});

describe("signed envelopes", () => {
  it("accepts a valid envelope and identifies the sender from the ticket", async () => {
    const server = await serverKeys();
    const { session, ticket } = await ticketFor(server, U);
    const env = await signEnvelope(
      { ticket, kind: "presence", seq: 1, at: NOW, data: { hello: 1 } },
      session.privateKey,
    );
    const v = await verifyEnvelope(env, { serverKey: server.publicKey, projectId: P, nowMs: NOW });
    expect(v?.claims.sub).toBe(U);
    expect(v?.data).toEqual({ hello: 1 });
  });

  it("rejects tampering, foreign projects, expiry, forged tickets and stolen tickets", async () => {
    const server = await serverKeys();
    const attacker = await serverKeys();
    const { session, ticket } = await ticketFor(server, U);
    const env = await signEnvelope(
      { ticket, kind: "presence", seq: 1, at: NOW, data: { mic: "muted" } },
      session.privateKey,
    );
    const opts = { serverKey: server.publicKey, projectId: P, nowMs: NOW };

    expect(await verifyEnvelope({ ...env, data: { mic: "unmuted" } }, opts)).toBeNull();
    expect(await verifyEnvelope(env, { ...opts, projectId: OTHER_P })).toBeNull();
    expect(await verifyEnvelope(env, { ...opts, nowMs: NOW + 700_000 })).toBeNull();

    // A ticket minted with any key other than the server's is worthless.
    const forged = await ticketFor(attacker, U2);
    const forgedEnv = await signEnvelope(
      { ticket: forged.ticket, kind: "presence", seq: 1, at: NOW, data: {} },
      forged.session.privateKey,
    );
    expect(await verifyEnvelope(forgedEnv, opts)).toBeNull();

    // Another member copies Mark's ticket but cannot sign as Mark.
    const thief = await ticketFor(server, U2);
    const stolen = await signEnvelope(
      { ticket, kind: "presence", seq: 2, at: NOW, data: {} },
      thief.session.privateKey,
    );
    expect(await verifyEnvelope(stolen, opts)).toBeNull();
  });

  it("rejects envelopes far outside the receiver's clock", async () => {
    const server = await serverKeys();
    const { session, ticket } = await ticketFor(server, U);
    const env = await signEnvelope(
      { ticket, kind: "presence", seq: 1, at: NOW - 10 * 60_000, data: {} },
      session.privateKey,
    );
    expect(
      await verifyEnvelope(env, { serverKey: server.publicKey, projectId: P, nowMs: NOW }),
    ).toBeNull();
  });

  it("verifies tickets on their own and round-trips public keys", async () => {
    const server = await serverKeys();
    const { ticket, session } = await ticketFor(server, U);
    const claims = await verifyTicket(ticket, server.publicKey, { projectId: P, nowMs: NOW });
    expect(claims?.key).toEqual(session.publicJwk);
    await expect(importPublicKey(session.publicJwk)).resolves.toBeDefined();
    expect(
      await verifyTicket(`${ticket}x`, server.publicKey, { projectId: P, nowMs: NOW }),
    ).toBeNull();
  });
});
