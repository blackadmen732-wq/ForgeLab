import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMITS,
  generateSessionKeys,
  projectTopic,
  signEnvelope,
  signTicket,
  toPublicJwk,
  type ProjectRole,
  type PublicJwk,
  type TicketClaims,
} from "@forgelab/protocol";
import {
  ProjectSession,
  TicketRefused,
  createMemoryRealtime,
  type RealtimeTransport,
  type ReceivedEvent,
  type SessionSnapshot,
} from "./index.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "55555555-5555-4555-8555-555555555555";
const VOICE = "33333333-3333-4333-8333-333333333333";
const USERS = {
  mark: { id: "11111111-1111-4111-8111-111111111111", name: "Mark", role: "owner" },
  andre: { id: "66666666-6666-4666-8666-666666666666", name: "Andre", role: "member" },
  jay: { id: "77777777-7777-4777-8777-777777777777", name: "Jay", role: "viewer" },
} as const satisfies Record<string, { id: string; name: string; role: ProjectRole }>;
type Who = keyof typeof USERS;

let now = Date.parse("2026-09-30T12:00:00Z");
const clock = () => now;

/** Stands in for POST /api/comms/ticket. */
async function ticketServer() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const serverKey = toPublicJwk(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const issue = async (
    who: Who,
    key: PublicJwk,
    projectId = PROJECT,
    ttl: number = LIMITS.ticketTtlSec,
  ) => {
    const iat = Math.floor(now / 1000);
    const claims: TicketClaims = {
      v: 1,
      sub: USERS[who].id,
      pid: projectId,
      role: USERS[who].role,
      name: USERS[who].name,
      key,
      iat,
      exp: iat + ttl,
    };
    return { ticket: await signTicket(claims, pair.privateKey), serverKey };
  };
  return { issue, serverKey };
}

/** Polls until `check` passes or `timeoutMs` of real time has passed (crypto is async). */
async function eventually(check: () => void, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const names = (s: SessionSnapshot) => s.roster.map((e) => e.name);

let hub: ReturnType<typeof createMemoryRealtime>;
let server: Awaited<ReturnType<typeof ticketServer>>;
const sessions: ProjectSession[] = [];

async function join(who: Who, ttl?: number) {
  const session = new ProjectSession({
    projectId: PROJECT,
    transport: hub.transport,
    fetchTicket: (key) => server.issue(who, key, PROJECT, ttl),
    now: clock,
  });
  sessions.push(session);
  await session.start();
  return session;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  now = Date.parse("2026-09-30T12:00:00Z");
  hub = createMemoryRealtime();
  server = await ticketServer();
});

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.stop();
  vi.useRealTimers();
});

describe("presence roster", () => {
  it("shows each member once, with identity and role from their server-signed ticket", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Andre", "Mark"]));
    await eventually(() => expect(names(andre.snapshot())).toEqual(["Andre", "Mark"]));
    expect(mark.snapshot().roster.find((e) => e.name === "Andre")).toMatchObject({
      userId: USERS.andre.id,
      role: "member",
      voiceChannelId: null,
    });
    expect(mark.snapshot().role).toBe("owner");
    expect(mark.userId).toBe(USERS.mark.id);
  });

  it("propagates voice channel and mic state, which is all presence says about voice", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    andre.update({ voiceChannelId: VOICE, mic: "unmuted", activity: "simulating" });
    await eventually(() =>
      expect(mark.snapshot().roster.find((e) => e.userId === USERS.andre.id)).toMatchObject({
        voiceChannelId: VOICE,
        mic: "unmuted",
        activity: "simulating",
      }),
    );
  });

  it("ignores presence that claims to be someone else or is not signed by the server", async () => {
    const mark = await join("mark");
    await join("andre");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    const topic = projectTopic(PROJECT);

    // Jay copies Andre's ticket but can only sign with Jay's own key.
    const jayKeys = await generateSessionKeys();
    const andreKeys = await generateSessionKeys();
    const andreTicket = (await server.issue("andre", andreKeys.publicJwk)).ticket;
    const envelope = await signEnvelope(
      {
        ticket: andreTicket,
        kind: "presence",
        seq: 99,
        at: now,
        data: {
          voiceChannelId: VOICE,
          mic: "unmuted",
          deafened: false,
          activity: "building",
          workspaceId: "",
          focus: null,
        },
      },
      jayKeys.privateKey,
    );
    hub.inject(topic, envelope);

    // A ticket from another project, correctly signed and used.
    const elsewhere = await server.issue("jay", jayKeys.publicJwk, OTHER_PROJECT);
    hub.inject(
      topic,
      await signEnvelope(
        {
          ticket: elsewhere.ticket,
          kind: "presence",
          seq: 1,
          at: now,
          data: {
            voiceChannelId: null,
            mic: "muted",
            deafened: false,
            activity: "building",
            workspaceId: "",
            focus: null,
          },
        },
        jayKeys.privateKey,
      ),
    );

    // Tampered payload under a valid signature, plus plain junk.
    const jayOwn = await server.issue("jay", jayKeys.publicJwk);
    const genuine = await signEnvelope(
      {
        ticket: jayOwn.ticket,
        kind: "presence",
        seq: 1,
        at: now,
        data: {
          voiceChannelId: null,
          mic: "muted",
          deafened: false,
          activity: "building",
          workspaceId: "",
          focus: null,
        },
      },
      jayKeys.privateKey,
    );
    hub.inject(topic, { ...genuine, data: { ...(genuine.data as object), voiceChannelId: VOICE } });
    hub.inject(topic, { hello: "world" });
    hub.inject(topic, null);

    await new Promise((r) => setTimeout(r, 30));
    expect(names(mark.snapshot())).toEqual(["Andre", "Mark"]);
    expect(
      mark.snapshot().roster.find((e) => e.userId === USERS.andre.id)?.voiceChannelId,
    ).toBeNull();

    // The genuine envelope, sent as is, is accepted even though a forgery reused its signature.
    hub.inject(topic, genuine);
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Andre", "Jay", "Mark"]));
    // ...and once it is cached, a tampered copy under the same signature still is not.
    hub.inject(topic, {
      ...genuine,
      seq: 100,
      data: { ...(genuine.data as object), voiceChannelId: VOICE },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(
      mark.snapshot().roster.find((e) => e.userId === USERS.jay.id)?.voiceChannelId,
    ).toBeNull();
  });

  it("removes members who leave or drop, and expires entries that stop refreshing", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    await andre.stop();
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Mark"]));

    // A stale entry someone keeps re-sending stops counting once it is too old.
    const keys = await generateSessionKeys();
    const jay = await server.issue("jay", keys.publicJwk);
    hub.inject(
      projectTopic(PROJECT),
      await signEnvelope(
        {
          ticket: jay.ticket,
          kind: "presence",
          seq: 1,
          at: now,
          data: {
            voiceChannelId: null,
            mic: "muted",
            deafened: false,
            activity: "observing",
            workspaceId: "",
            focus: null,
          },
        },
        keys.privateKey,
      ),
    );
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Jay", "Mark"]));
    now += LIMITS.presenceExpiryMs + LIMITS.presenceHeartbeatMs;
    await vi.advanceTimersByTimeAsync(LIMITS.presenceHeartbeatMs);
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Mark"]));
  });

  it("drops a member's presence when their connection drops", async () => {
    const andre = await join("andre");
    const mark = await join("mark");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    hub.drop(projectTopic(PROJECT)); // the first client on the topic: Andre
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Mark"]));
    await eventually(() => expect(andre.snapshot().status).toBe("disconnected"));
  });

  it("renews its ticket before it expires and keeps heartbeating", async () => {
    let issued = 0;
    const session = new ProjectSession({
      projectId: PROJECT,
      transport: hub.transport,
      fetchTicket: async (key) => {
        issued += 1;
        return server.issue("andre", key);
      },
      now: clock,
    });
    sessions.push(session);
    await session.start();
    const mark = await join("mark");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    expect(issued).toBe(1);

    for (let t = 0; t < LIMITS.ticketTtlSec * 1000; t += LIMITS.presenceHeartbeatMs) {
      now += LIMITS.presenceHeartbeatMs;
      await vi.advanceTimersByTimeAsync(LIMITS.presenceHeartbeatMs);
    }
    expect(issued).toBeGreaterThan(1);
    // Mark's own ticket expired (his session renews too) and Andre is still listed.
    await eventually(() => expect(names(mark.snapshot())).toEqual(["Andre", "Mark"]));
  });

  it("stays within the realtime service's per-client presence budget", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const tracks: { at: number; payload: { data: { mic: string } } }[] = [];
    const counting: RealtimeTransport = {
      open(topic, handlers) {
        const channel = hub.transport.open(topic, handlers);
        return {
          ...channel,
          track: async (payload) => {
            tracks.push({ at: now, payload: payload as (typeof tracks)[number]["payload"] });
            await channel.track(payload);
          },
        };
      },
    };
    const session = new ProjectSession({
      projectId: PROJECT,
      transport: counting,
      fetchTicket: (key) => server.issue("andre", key),
      now: clock,
    });
    sessions.push(session);
    await session.start();
    await vi.advanceTimersByTimeAsync(10);
    // Someone hammering mute: 20 changes in 8 seconds.
    for (let i = 0; i < 20; i++) {
      session.update({ mic: i % 2 === 0 ? "unmuted" : "muted" });
      now += 400;
      await vi.advanceTimersByTimeAsync(400);
    }
    for (let t = 0; t < 60_000; t += 1000) {
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    // Signing runs on WebCrypto's thread pool, which fake timers do not drive: give the
    // last (held-back) update real time to finish.
    const deadline = Date.now() + 5000;
    while (tracks.at(-1)?.payload.data.mic !== "muted" && Date.now() < deadline)
      await new Promise((r) => setImmediate(r));
    for (const { at } of tracks) {
      const inWindow = tracks.filter((u) => u.at >= at && u.at - at < LIMITS.presenceWindowMs);
      expect(inWindow.length).toBeLessThanOrEqual(LIMITS.presenceMaxUpdates);
    }
    // Nothing is lost: the final state went out.
    expect(tracks.at(-1)?.payload.data.mic).toBe("muted");
  });

  it("shows state changes at once even when the presence budget is spent", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    for (let i = 0; i < 6; i++) {
      andre.update({ mic: i % 2 === 0 ? "unmuted" : "muted" });
      await new Promise((r) => setTimeout(r, LIMITS.presenceCoalesceMs + 50));
    }
    andre.update({ voiceChannelId: VOICE });
    await eventually(
      () =>
        expect(
          mark.snapshot().roster.find((e) => e.userId === USERS.andre.id)?.voiceChannelId,
        ).toBe(VOICE),
      // Far below the 30 s a held-back presence update would take.
      3000,
    );
    // Our own entry always reflects our own state.
    expect(andre.snapshot().roster.find((e) => e.userId === USERS.andre.id)?.voiceChannelId).toBe(
      VOICE,
    );

    // A broadcast state cannot make someone appear online.
    const keys = await generateSessionKeys();
    const jay = await server.issue("jay", keys.publicJwk);
    hub.injectBroadcast(
      projectTopic(PROJECT),
      await signEnvelope(
        {
          ticket: jay.ticket,
          kind: "presence",
          seq: 1,
          at: now,
          data: {
            voiceChannelId: VOICE,
            mic: "unmuted",
            deafened: false,
            activity: "building",
            workspaceId: "",
            focus: null,
          },
        },
        keys.privateKey,
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(names(mark.snapshot())).toEqual(["Andre", "Mark"]);
  });

  it("ends the session when the server refuses a ticket", async () => {
    const session = new ProjectSession({
      projectId: PROJECT,
      transport: hub.transport,
      fetchTicket: async () => {
        throw new TicketRefused("You are not a member of this project.");
      },
      now: clock,
    });
    await session.start();
    expect(session.snapshot().status).toBe("unauthorized");
    expect(hub.size).toBe(0);
  });
});

describe("collaboration events", () => {
  it("delivers signed events with the sender's verified identity", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    const received: ReceivedEvent[] = [];
    mark.onEvent((e) => received.push(e));
    await andre.send({
      type: "design.revision",
      versionId: "88888888-8888-4888-8888-888888888888",
      versionNumber: 4,
      label: "Thicker shield",
    });
    await andre.send({
      type: "view.share",
      camera: { position: [4, 3, 2], target: [0, 1, 0], projection: "perspective" },
      focus: ["vessel-1"],
      note: "Look at this weld",
    });
    await eventually(() => expect(received).toHaveLength(2));
    expect(received[0]).toMatchObject({
      from: { userId: USERS.andre.id, name: "Andre", role: "member" },
      event: { type: "design.revision", versionNumber: 4 },
    });
    expect(received[1]?.event).toMatchObject({ type: "view.share", focus: ["vessel-1"] });
  });

  it("refuses revision notices from viewers, on both ends", async () => {
    const mark = await join("mark");
    const jay = await join("jay");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    const revision = {
      type: "design.revision",
      versionId: "88888888-8888-4888-8888-888888888888",
      versionNumber: 5,
      label: null,
    } as const;
    await expect(jay.send(revision)).rejects.toThrow(/role/);

    const received: ReceivedEvent[] = [];
    mark.onEvent((e) => received.push(e));
    const keys = await generateSessionKeys();
    const ticket = (await server.issue("jay", keys.publicJwk)).ticket;
    hub.injectBroadcast(
      projectTopic(PROJECT),
      await signEnvelope(
        { ticket, kind: "collab", seq: 1, at: now, data: revision },
        keys.privateKey,
      ),
    );
    // Viewers may still share a view.
    await jay.send({
      type: "view.share",
      camera: { position: [0, 0, 5], target: [0, 0, 0], projection: "orthographic" },
      focus: [],
      note: null,
    });
    await eventually(() => expect(received).toHaveLength(1));
    expect(received[0]?.event.type).toBe("view.share");
  });

  it("drops a flood from one member", async () => {
    const mark = await join("mark");
    const andre = await join("andre");
    await eventually(() => expect(mark.snapshot().roster).toHaveLength(2));
    const received: ReceivedEvent[] = [];
    mark.onEvent((e) => received.push(e));
    for (let i = 0; i < 30; i++) {
      await andre.send({
        type: "view.share",
        camera: { position: [i, 0, 5], target: [0, 0, 0], projection: "perspective" },
        focus: [],
        note: null,
      });
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(10);
  });
});
