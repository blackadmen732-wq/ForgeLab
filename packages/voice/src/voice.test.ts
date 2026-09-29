import { describe, expect, it } from "vitest";
import {
  MicrophoneError,
  VoiceClient,
  VoiceDenied,
  presenceMic,
  type TransportEvent,
  type VoiceClientOptions,
  type VoiceToken,
  type VoiceTransport,
} from "./index.js";

const GENERAL = "33333333-3333-4333-8333-333333333333";
const REACTOR = "44444444-4444-4444-8444-444444444444";

class FakeTransport implements VoiceTransport {
  calls: string[] = [];
  micError: MicrophoneError | null = null;
  private listeners = new Set<(event: TransportEvent) => void>();

  async connect(url: string, token: string) {
    this.calls.push(`connect ${url} ${token}`);
    this.fire({
      type: "participants",
      participants: [
        { identity: "me", name: "Mark", micEnabled: false, isLocal: true },
        { identity: "andre", name: "Andre", micEnabled: true, isLocal: false },
      ],
    });
  }
  async disconnect() {
    this.calls.push("disconnect");
  }
  async setMicrophone(enabled: boolean) {
    if (this.micError) throw this.micError;
    this.calls.push(`mic ${enabled}`);
  }
  async setInputDevice(id: string) {
    this.calls.push(`input ${id}`);
  }
  async setOutputDevice(id: string) {
    this.calls.push(`output ${id}`);
  }
  async setRemoteAudio(enabled: boolean) {
    this.calls.push(`remote ${enabled}`);
  }
  async startAudio() {}
  on(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  fire(event: TransportEvent) {
    for (const l of this.listeners) l(event);
  }
  get mic() {
    return this.calls.filter((c) => c.startsWith("mic ")).at(-1) ?? "never";
  }
}

function setup(
  options: Partial<VoiceClientOptions> & {
    grant?: (channelId: string, n: number) => Promise<VoiceToken>;
  } = {},
) {
  const transports: FakeTransport[] = [];
  const requests: string[] = [];
  const client = new VoiceClient({
    requestToken: async (channelId) => {
      requests.push(channelId);
      return options.grant
        ? options.grant(channelId, requests.length)
        : { url: "wss://sfu", token: `t-${channelId.slice(0, 4)}`, canSpeak: true };
    },
    createTransport: async () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    reconnectDelaysMs: [1, 1],
    ...options,
  });
  return { client, transports, requests, last: () => transports.at(-1)! };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe("joining and leaving", () => {
  it("joins a channel's room with a server-issued token and opens the mic", async () => {
    const { client, last, requests } = setup();
    await client.join(GENERAL);
    expect(requests).toEqual([GENERAL]);
    expect(last().calls[0]).toBe("connect wss://sfu t-3333");
    expect(client.getState()).toMatchObject({
      phase: "connected",
      channelId: GENERAL,
      canSpeak: true,
      transmitting: true,
      micBlock: null,
    });
    expect(last().mic).toBe("mic true");
    expect(client.getState().members.map((m) => m.name)).toEqual(["Mark", "Andre"]);
    expect(presenceMic(client.getState())).toBe("unmuted");
  });

  it("never opens the microphone when joining muted", async () => {
    const { client, last } = setup({ preferences: { muted: true } });
    await client.join(GENERAL);
    expect(client.getState().transmitting).toBe(false);
    expect(last().mic).toBe("never");
    expect(presenceMic(client.getState())).toBe("muted");
  });

  it("is in one channel at a time: joining another leaves the first", async () => {
    const { client, transports } = setup();
    await client.join(GENERAL);
    await client.join(REACTOR);
    expect(transports).toHaveLength(2);
    expect(transports[0]!.calls.at(-1)).toBe("disconnect");
    expect(client.getState().channelId).toBe(REACTOR);
    await client.leave();
    expect(transports[1]!.calls.at(-1)).toBe("disconnect");
    expect(client.getState()).toMatchObject({ phase: "idle", channelId: null, members: [] });
  });

  it("reports a refusal from the server and creates no connection", async () => {
    const { client, transports } = setup({
      grant: async () => {
        throw new VoiceDenied("You cannot join voice in that channel.");
      },
    });
    await client.join(GENERAL);
    expect(transports).toHaveLength(0);
    expect(client.getState()).toMatchObject({
      phase: "idle",
      channelId: null,
      error: "You cannot join voice in that channel.",
    });
  });

  it("abandons a join that is superseded by leave", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, transports } = setup({
      grant: async () => {
        await gate;
        return { url: "wss://sfu", token: "t", canSpeak: true };
      },
    });
    const joining = client.join(GENERAL);
    expect(client.getState().phase).toBe("joining");
    await client.leave();
    release();
    await joining;
    expect(transports).toHaveLength(0);
    expect(client.getState().phase).toBe("idle");
  });
});

describe("listen-only", () => {
  it("keeps viewers listen-only and never touches their microphone", async () => {
    const { client, last } = setup({
      grant: async () => ({ url: "wss://sfu", token: "t", canSpeak: false }),
    });
    await client.join(GENERAL);
    expect(client.getState()).toMatchObject({
      phase: "connected",
      micBlock: "viewer",
      transmitting: false,
    });
    await client.setMuted(false);
    expect(last().mic).toBe("never");
    expect(presenceMic(client.getState())).toBe("unavailable");
  });

  it("stays connected to listen when the microphone is blocked", async () => {
    const { client, transports } = setup({
      createTransport: async () => {
        const t = new FakeTransport();
        t.micError = new MicrophoneError("denied", "blocked");
        transports.push(t);
        return t;
      },
    });
    await client.join(GENERAL);
    expect(client.getState()).toMatchObject({
      phase: "connected",
      micBlock: "denied",
      transmitting: false,
    });
    expect(transports[0]!.calls).toContain("remote true");
  });
});

describe("mute, deafen, push-to-talk", () => {
  it("deafening stops incoming audio and the mic; undeafening restores both", async () => {
    const { client, last } = setup();
    await client.join(GENERAL);
    await client.setDeafened(true);
    expect(last().calls.slice(-2)).toEqual(["remote false", "mic false"]);
    expect(presenceMic(client.getState())).toBe("muted");
    await client.setDeafened(false);
    expect(last().calls.slice(-2)).toEqual(["remote true", "mic true"]);

    await client.setDeafened(true);
    await client.setMuted(false); // unmuting also undeafens
    expect(client.getState()).toMatchObject({ deafened: false, transmitting: true });
  });

  it("transmits only while the push-to-talk key is held", async () => {
    const { client, last } = setup({ preferences: { mode: "push-to-talk" } });
    await client.join(GENERAL);
    expect(last().mic).toBe("never");
    await client.pushToTalk(true);
    expect(last().mic).toBe("mic true");
    expect(client.getState().transmitting).toBe(true);
    await client.pushToTalk(false);
    expect(last().mic).toBe("mic false");
    await client.setMode("open");
    expect(last().mic).toBe("mic true");
    await client.pushToTalk(true); // ignored in open-mic mode
    expect(client.getState().pttHeld).toBe(false);
  });

  it("marks who is speaking, and never shows us speaking while we are not transmitting", async () => {
    const { client, last } = setup();
    await client.join(GENERAL);
    last().fire({ type: "speakers", identities: ["andre", "me"] });
    const speaking = () =>
      client
        .getState()
        .members.filter((m) => m.speaking)
        .map((m) => m.name);
    expect(speaking()).toEqual(["Mark", "Andre"]);
    await client.setMuted(true);
    expect(speaking()).toEqual(["Andre"]);
  });

  it("switches devices on the live connection", async () => {
    const { client, last } = setup();
    await client.join(GENERAL);
    await client.setInputDevice("usb-mic");
    await client.setOutputDevice("headset");
    expect(last().calls.slice(-2)).toEqual(["input usb-mic", "output headset"]);
    expect(client.getState()).toMatchObject({
      inputDeviceId: "usb-mic",
      outputDeviceId: "headset",
    });
  });
});

describe("disconnects", () => {
  it("does not rejoin after being removed", async () => {
    const { client, last, requests } = setup();
    await client.join(GENERAL);
    last().fire({ type: "disconnected", cause: "removed" });
    await settle();
    expect(requests).toHaveLength(1);
    expect(client.getState()).toMatchObject({
      phase: "idle",
      error: "You were removed from voice.",
    });
  });

  it("rejoins after a lost connection with a fresh token, which the server may refuse", async () => {
    const { client, transports, requests } = setup({
      grant: async (_channel, n) => {
        if (n === 3) throw new VoiceDenied("You cannot join voice in that channel.");
        return { url: "wss://sfu", token: `t${n}`, canSpeak: true };
      },
    });
    await client.join(GENERAL);
    transports[0]!.fire({ type: "disconnected", cause: "network" });
    await settle();
    expect(requests).toHaveLength(2);
    expect(transports[1]!.calls[0]).toBe("connect wss://sfu t2");
    expect(client.getState()).toMatchObject({ phase: "connected", channelId: GENERAL });

    // Removed from the project meanwhile: the next rejoin is refused and voice ends.
    transports[1]!.fire({ type: "disconnected", cause: "network" });
    await settle();
    expect(client.getState()).toMatchObject({
      phase: "idle",
      channelId: null,
      error: "You cannot join voice in that channel.",
    });
  });

  it("ignores its own leave", async () => {
    const { client, last, requests } = setup();
    await client.join(GENERAL);
    last().fire({ type: "disconnected", cause: "client" });
    await settle();
    expect(requests).toHaveLength(1);
    expect(client.getState().phase).toBe("connected");
  });
});
