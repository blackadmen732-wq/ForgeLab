import {
  MicrophoneError,
  type DisconnectCause,
  type MicProblem,
  type TransportEvent,
  type VoiceParticipant,
  type VoiceTransport,
} from "./transport.js";

/**
 * ForgeLab's channel voice client. Voice is routed by channel membership only: joining a
 * channel means hearing everyone in that channel and nobody else, wherever they are in
 * the sandbox. One channel at a time; joining another leaves the first.
 */
export type VoicePhase = "idle" | "joining" | "connected" | "reconnecting";
export type MicMode = "open" | "push-to-talk";
/** Why this member is listen-only, if they are. */
export type MicBlock = null | "viewer" | MicProblem;

export interface VoiceMember extends VoiceParticipant {
  readonly speaking: boolean;
}

export interface VoiceState {
  readonly phase: VoicePhase;
  readonly channelId: string | null;
  /** The last failure, in words a person can act on. Cleared by the next join. */
  readonly error: string | null;
  readonly canSpeak: boolean;
  readonly micBlock: MicBlock;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly mode: MicMode;
  readonly pttHeld: boolean;
  /** Whether our microphone is actually live right now. */
  readonly transmitting: boolean;
  readonly members: readonly VoiceMember[];
  readonly playbackBlocked: boolean;
  readonly inputDeviceId: string | null;
  readonly outputDeviceId: string | null;
}

export interface VoiceToken {
  readonly url: string;
  readonly token: string;
  readonly canSpeak: boolean;
}

/** Thrown by `requestToken` when the server refuses; never retried. */
export class VoiceDenied extends Error {}

export interface VoiceClientOptions {
  /** POST /api/voice/token — the server decides whether we may join. */
  readonly requestToken: (channelId: string) => Promise<VoiceToken>;
  /** Creates a transport; the LiveKit adapter is loaded only when someone joins voice. */
  readonly createTransport: () => Promise<VoiceTransport>;
  readonly reconnectDelaysMs?: readonly number[];
  readonly preferences?: Partial<
    Pick<VoiceState, "muted" | "mode" | "inputDeviceId" | "outputDeviceId">
  >;
}

const MIC_MESSAGES: Record<Exclude<MicBlock, null>, string> = {
  viewer: "Viewers listen only.",
  denied: "Microphone access was blocked. You can still listen.",
  "no-device": "No microphone found. You can still listen.",
  failed: "The microphone could not be started. You can still listen.",
};

export function micBlockMessage(block: MicBlock): string | null {
  return block === null ? null : MIC_MESSAGES[block];
}

/** The mic state other members see in presence. */
export function presenceMic(state: VoiceState): "unmuted" | "muted" | "unavailable" {
  if (state.channelId === null || state.micBlock !== null)
    return state.micBlock === null ? "muted" : "unavailable";
  if (state.deafened || (state.mode === "open" && state.muted)) return "muted";
  return "unmuted";
}

export class VoiceClient {
  private state: VoiceState;
  private readonly listeners = new Set<(state: VoiceState) => void>();
  private transport: VoiceTransport | null = null;
  private unlisten: (() => void) | null = null;
  private participants: readonly VoiceParticipant[] = [];
  private speakers = new Set<string>();
  /** Bumped on every join/leave so late results of an abandoned attempt are discarded. */
  private generation = 0;
  private micAcquired = false;
  private readonly delays: readonly number[];

  constructor(private readonly options: VoiceClientOptions) {
    this.delays = options.reconnectDelaysMs ?? [1000, 3000, 8000];
    this.state = {
      phase: "idle",
      channelId: null,
      error: null,
      canSpeak: false,
      micBlock: null,
      muted: options.preferences?.muted ?? false,
      deafened: false,
      mode: options.preferences?.mode ?? "open",
      pttHeld: false,
      transmitting: false,
      members: [],
      playbackBlocked: false,
      inputDeviceId: options.preferences?.inputDeviceId ?? null,
      outputDeviceId: options.preferences?.outputDeviceId ?? null,
    };
  }

  getState(): VoiceState {
    return this.state;
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Joins a channel's voice room, leaving any other first. */
  async join(channelId: string): Promise<void> {
    if (this.state.channelId === channelId && this.state.phase !== "idle") return;
    if (this.state.channelId !== null) await this.leave();
    const generation = ++this.generation;
    this.set({ phase: "joining", channelId, error: null, micBlock: null, pttHeld: false });
    try {
      await this.connect(channelId, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.teardown();
      this.set({ phase: "idle", channelId: null, error: describe(error) });
    }
  }

  async leave(): Promise<void> {
    this.generation += 1;
    await this.teardown();
    this.set({ phase: "idle", channelId: null, pttHeld: false });
  }

  setMuted(muted: boolean): Promise<void> {
    // Unmuting while deafened undeafens too, as people expect.
    this.set(muted ? { muted } : { muted, deafened: false });
    return this.apply();
  }

  setDeafened(deafened: boolean): Promise<void> {
    this.set({ deafened });
    return this.apply();
  }

  setMode(mode: MicMode): Promise<void> {
    this.set({ mode, pttHeld: false });
    return this.apply();
  }

  /** Push-to-talk key down / up. Ignored in open-mic mode. */
  pushToTalk(held: boolean): Promise<void> {
    if (this.state.mode !== "push-to-talk" || this.state.pttHeld === held) return Promise.resolve();
    this.set({ pttHeld: held });
    return this.apply();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    this.set({ inputDeviceId: deviceId });
    if (this.transport === null) return;
    await this.transport.setInputDevice(deviceId);
    // A device that works may lift a "no microphone" block.
    if (this.state.micBlock === "no-device" || this.state.micBlock === "failed") {
      this.set({ micBlock: null });
      await this.apply();
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.set({ outputDeviceId: deviceId });
    await this.transport?.setOutputDevice(deviceId);
  }

  /** Call from a click handler when `playbackBlocked` is true. */
  async resumePlayback(): Promise<void> {
    await this.transport?.startAudio();
    this.set({ playbackBlocked: false });
  }

  /* ------------------------------------------------------------------------------ */

  private set(patch: Partial<VoiceState>): void {
    const next = { ...this.state, ...patch };
    const transmitting =
      next.phase === "connected" &&
      next.canSpeak &&
      next.micBlock === null &&
      !next.deafened &&
      (next.mode === "open" ? !next.muted : next.pttHeld);
    const members = this.participants.map((p) => ({
      ...p,
      speaking: this.speakers.has(p.identity) && (!p.isLocal || transmitting),
    }));
    this.state = { ...next, transmitting, members };
    for (const listener of this.listeners) listener(this.state);
  }

  private async connect(channelId: string, generation: number): Promise<void> {
    const grant = await this.options.requestToken(channelId);
    if (generation !== this.generation) return;
    const transport = await this.options.createTransport();
    if (generation !== this.generation) return;
    this.transport = transport;
    this.micAcquired = false;
    this.unlisten = transport.on((event) => this.onTransport(event, generation));
    await transport.connect(grant.url, grant.token, {
      inputDeviceId: this.state.inputDeviceId,
      outputDeviceId: this.state.outputDeviceId,
    });
    if (generation !== this.generation) {
      await transport.disconnect().catch(() => undefined);
      return;
    }
    this.set({
      phase: "connected",
      canSpeak: grant.canSpeak,
      micBlock: grant.canSpeak ? null : "viewer",
    });
    await transport.startAudio().catch(() => undefined);
    await this.apply();
  }

  /** Brings the transport in line with mute / deafen / push-to-talk state. */
  private async apply(): Promise<void> {
    const transport = this.transport;
    if (transport === null || this.state.phase !== "connected") return;
    await transport.setRemoteAudio(!this.state.deafened);
    if (!this.state.canSpeak || this.state.micBlock !== null) return;

    const live = this.state.transmitting;
    // The microphone is opened the first time it should go live — never earlier, so
    // joining muted captures nothing. After that, muting keeps the track and only
    // silences it, so push-to-talk responds instantly.
    if (!live && !this.micAcquired) return;
    try {
      await transport.setMicrophone(live);
      this.micAcquired = true;
    } catch (error) {
      if (this.transport !== transport) return;
      this.set({ micBlock: error instanceof MicrophoneError ? error.problem : "failed" });
    }
  }

  private onTransport(event: TransportEvent, generation: number): void {
    if (generation !== this.generation) return;
    switch (event.type) {
      case "participants":
        this.participants = event.participants;
        this.set({});
        return;
      case "speakers":
        this.speakers = new Set(event.identities);
        this.set({});
        return;
      case "reconnecting":
        this.set({ phase: "reconnecting" });
        return;
      case "reconnected":
        this.set({ phase: "connected" });
        void this.apply();
        return;
      case "playback-blocked":
        this.set({ playbackBlocked: event.blocked });
        return;
      case "devices-changed":
        return;
      case "disconnected":
        void this.onDisconnected(event.cause, generation);
        return;
    }
  }

  private async onDisconnected(cause: DisconnectCause, generation: number): Promise<void> {
    if (cause === "client") return;
    const channelId = this.state.channelId;
    await this.teardown();
    if (generation !== this.generation || channelId === null) return;
    if (cause !== "network") {
      const reason = {
        removed: "You were removed from voice.",
        "room-deleted": "This voice channel was closed.",
        duplicate: "You joined voice from another tab.",
      }[cause];
      this.set({ phase: "idle", channelId: null, error: reason });
      return;
    }
    // Lost connection: get a fresh token (the server re-checks access) and rejoin.
    this.set({ phase: "reconnecting" });
    for (const delay of this.delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (generation !== this.generation) return;
      try {
        await this.connect(channelId, generation);
        return;
      } catch (error) {
        await this.teardown();
        if (error instanceof VoiceDenied) {
          if (generation === this.generation)
            this.set({ phase: "idle", channelId: null, error: error.message });
          return;
        }
      }
    }
    if (generation === this.generation)
      this.set({ phase: "idle", channelId: null, error: "Lost the voice connection." });
  }

  private async teardown(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.unlisten?.();
    this.unlisten = null;
    this.participants = [];
    this.speakers = new Set();
    this.micAcquired = false;
    if (transport !== null) await transport.disconnect().catch(() => undefined);
  }
}

function describe(error: unknown): string {
  if (error instanceof VoiceDenied) return error.message;
  if (error instanceof Error && error.message) return `Could not join voice: ${error.message}`;
  return "Could not join voice.";
}
