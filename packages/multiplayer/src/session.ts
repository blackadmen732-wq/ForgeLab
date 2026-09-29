import {
  IDLE_PRESENCE,
  LIMITS,
  generateSessionKeys,
  importPublicKey,
  parseCollabEvent,
  permissionsFor,
  peekTicket,
  projectTopic,
  signEnvelope,
  verifyEnvelope,
  type CollabEvent,
  type PresenceEntry,
  type PresenceState,
  type ProjectRole,
  type PublicJwk,
  type TicketClaims,
} from "@forgelab/protocol";
import { PRESENCE_KIND, PresenceRoster } from "./roster.js";
import type { ConnectionStatus, ProjectChannel, RealtimeTransport } from "./transport.js";

export const EVENT_KIND = "collab";

export interface IssuedTicket {
  readonly ticket: string;
  readonly serverKey: PublicJwk;
}

/** Thrown by `fetchTicket` when the server refuses (the caller is not, or no longer, a member). */
export class TicketRefused extends Error {}

export type SessionStatus = ConnectionStatus | "unauthorized";

export interface SessionSnapshot {
  readonly status: SessionStatus;
  readonly role: ProjectRole | null;
  readonly self: PresenceState;
  readonly roster: readonly PresenceEntry[];
}

export interface ReceivedEvent {
  readonly from: { readonly userId: string; readonly name: string; readonly role: ProjectRole };
  readonly at: number;
  readonly event: CollabEvent;
}

export interface ProjectSessionOptions {
  readonly projectId: string;
  readonly transport: RealtimeTransport;
  /** Asks the server to certify this session's public key (POST /api/comms/ticket). */
  readonly fetchTicket: (publicKey: PublicJwk) => Promise<IssuedTicket>;
  readonly initial?: Partial<PresenceState>;
  readonly now?: () => number;
}

/** Most collaboration events a single member may deliver per 10 s before being ignored. */
const EVENT_BURST = 10;

/**
 * One member's live connection to a project: publishes their signed presence, keeps the
 * verified roster, and exchanges signed collaboration events. Voice is not handled here —
 * presence only *reports* which voice channel someone is in.
 */
export class ProjectSession {
  private readonly now: () => number;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private readonly eventListeners = new Set<(event: ReceivedEvent) => void>();
  private readonly eventCounts = new Map<string, { windowStart: number; count: number }>();
  private readonly eventKeys = new Map<string, { claims: TicketClaims; key: CryptoKey }>();

  private status: SessionStatus = "connecting";
  private self: PresenceState;
  private keys: Awaited<ReturnType<typeof generateSessionKeys>> | null = null;
  private ticket: { value: string; claims: TicketClaims } | null = null;
  private serverKey: CryptoKey | null = null;
  private roster: PresenceRoster | null = null;
  private channel: ProjectChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private publishing: Promise<void> = Promise.resolve();
  private stopped = false;
  private lastPublished = 0;
  /** When recent presence updates were sent, for the per-client rate limit. */
  private sent: number[] = [];
  /** A coalesced state change waiting to go out. */
  private pendingChange: ReturnType<typeof setTimeout> | null = null;
  /** A presence update held back by the rate limit. */
  private pendingTrack: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ProjectSessionOptions) {
    this.now = options.now ?? Date.now;
    this.self = { ...IDLE_PRESENCE, ...options.initial };
  }

  snapshot(): SessionSnapshot {
    const me = this.userId;
    return {
      status: this.status,
      role: this.ticket?.claims.role ?? null,
      self: this.self,
      // Our own entry always shows our current state, not what the network last carried.
      roster: (this.roster?.list() ?? []).map((e) =>
        e.userId === me ? { ...e, ...this.self } : e,
      ),
    };
  }

  /** The user id the server certified for this session. */
  get userId(): string | null {
    return this.ticket?.claims.sub ?? null;
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: ReceivedEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(): Promise<void> {
    this.keys = await generateSessionKeys();
    if (!(await this.renewTicket())) return;
    if (this.stopped) return;

    const topic = projectTopic(this.options.projectId);
    this.channel = this.options.transport.open(topic, {
      presence: (payloads) => void this.onPresence(payloads),
      broadcast: (payload) => void this.onBroadcast(payload),
      status: (status) => this.onStatus(status),
    });
    this.timer = setInterval(() => void this.tick(), LIMITS.presenceHeartbeatMs);
  }

  /** Changes this member's presence (voice channel, mic state, activity, focus...). */
  update(patch: Partial<PresenceState>): void {
    const next = { ...this.self, ...patch };
    if ((Object.keys(next) as (keyof PresenceState)[]).every((k) => next[k] === this.self[k]))
      return;
    this.self = next;
    this.emit();
    if (this.pendingChange === null && !this.stopped) {
      this.pendingChange = setTimeout(() => {
        this.pendingChange = null;
        void this.publish(true);
      }, LIMITS.presenceCoalesceMs);
    }
  }

  /** Sends a collaboration event to everyone else in the project. */
  async send(event: CollabEvent): Promise<void> {
    if (this.channel === null || this.ticket === null || this.keys === null)
      throw new Error("Not connected to the project.");
    if (!allowedToSend(this.ticket.claims.role, event))
      throw new Error("Your role cannot send that.");
    const envelope = await signEnvelope(
      { ticket: this.ticket.value, kind: EVENT_KIND, seq: ++this.seq, at: this.now(), data: event },
      this.keys.privateKey,
    );
    await this.channel.broadcast(envelope);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const timer of [this.pendingChange, this.pendingTrack])
      if (timer !== null) clearTimeout(timer);
    this.pendingChange = null;
    this.pendingTrack = null;
    const channel = this.channel;
    this.channel = null;
    if (channel !== null) {
      await channel.untrack().catch(() => undefined);
      await channel.close().catch(() => undefined);
    }
    this.status = "disconnected";
    this.emit();
  }

  /* ------------------------------------------------------------------------------ */

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** Returns false when the server refused, which ends the session. */
  private async renewTicket(): Promise<boolean> {
    if (this.keys === null) return false;
    try {
      const issued = await this.options.fetchTicket(this.keys.publicJwk);
      const claims = peekTicket(issued.ticket);
      if (claims === null) throw new Error("The server returned an unreadable ticket.");
      if (this.serverKey === null) {
        this.serverKey = await importPublicKey(issued.serverKey);
        this.roster = new PresenceRoster({
          serverKey: this.serverKey,
          projectId: this.options.projectId,
          now: this.now,
        });
      }
      this.ticket = { value: issued.ticket, claims };
      return true;
    } catch (error) {
      if (error instanceof TicketRefused) {
        await this.stop();
        this.status = "unauthorized";
        this.emit();
        return false;
      }
      if (this.ticket === null) {
        this.status = "disconnected";
        this.emit();
        throw error;
      }
      return true; // keep the current ticket; the next heartbeat tries again
    }
  }

  private async tick(): Promise<void> {
    const ticket = this.ticket;
    if (ticket !== null && this.now() >= (ticket.claims.exp - LIMITS.ticketRenewBeforeSec) * 1000) {
      if (!(await this.renewTicket())) return;
    }
    if (this.roster?.prune()) this.emit();
    if (this.now() - this.lastPublished >= LIMITS.presenceHeartbeatMs - 1000) await this.publish();
  }

  /**
   * Sends our state. A change is broadcast at once (so the channel list and mute icons
   * update immediately) and tracked as presence (so members who arrive later see it) as
   * the realtime service's per-client presence budget allows; a held-back presence update
   * carries whatever the state is by the time it goes out.
   */
  private publish(broadcast = false): Promise<void> {
    this.publishing = this.publishing.then(async () => {
      const { channel, ticket, keys } = this;
      if (channel === null || ticket === null || keys === null || this.status !== "connected")
        return;
      const envelope = await signEnvelope(
        {
          ticket: ticket.value,
          kind: PRESENCE_KIND,
          seq: ++this.seq,
          at: this.now(),
          data: this.self,
        },
        keys.privateKey,
      );
      if (broadcast) await channel.broadcast(envelope).catch(() => undefined);
      // The budget is counted when an update is actually sent, not when it was asked for.
      const now = this.now();
      this.sent = this.sent.filter((t) => now - t < LIMITS.presenceWindowMs);
      if (this.sent.length >= LIMITS.presenceMaxUpdates) {
        this.holdTrack(now);
        return;
      }
      if (this.pendingTrack !== null) clearTimeout(this.pendingTrack);
      this.pendingTrack = null;
      this.sent.push(now);
      this.lastPublished = now;
      await channel.track(envelope).catch(() => undefined);
    });
    return this.publishing;
  }

  /** Sends the latest state as presence once the oldest update leaves the window. */
  private holdTrack(now: number): void {
    if (this.pendingTrack !== null || this.stopped) return;
    this.pendingTrack = setTimeout(
      () => {
        this.pendingTrack = null;
        void this.publish(false);
      },
      LIMITS.presenceWindowMs - (now - this.sent[0]!) + 50,
    );
  }

  private onStatus(status: ConnectionStatus): void {
    if (this.stopped || this.status === "unauthorized") return;
    this.status = status;
    this.emit();
    // Presence does not survive a reconnect; publish again whenever the socket is back.
    if (status === "connected") void this.publish();
  }

  private async onPresence(payloads: readonly unknown[]): Promise<void> {
    if (this.roster !== null && (await this.roster.sync(payloads))) this.emit();
  }

  private async onBroadcast(payload: unknown): Promise<void> {
    if (this.serverKey === null || this.roster === null) return;
    if ((payload as { kind?: unknown } | null)?.kind === PRESENCE_KIND) {
      if (await this.roster.update(payload)) this.emit();
      return;
    }
    const verified = await verifyEnvelope(payload, {
      serverKey: this.serverKey,
      projectId: this.options.projectId,
      nowMs: this.now(),
      keys: this.eventKeys,
    });
    if (verified === null || verified.kind !== EVENT_KIND) return;
    if (verified.claims.sub === this.userId) return;
    const event = parseCollabEvent(verified.data);
    if (event === null || !allowedToSend(verified.claims.role, event)) return;
    if (!this.withinBurst(verified.claims.sub)) return;
    if (this.eventKeys.size > 200) this.eventKeys.clear();

    const received: ReceivedEvent = {
      from: { userId: verified.claims.sub, name: verified.claims.name, role: verified.claims.role },
      at: verified.at,
      event,
    };
    for (const listener of this.eventListeners) listener(received);
  }

  private withinBurst(userId: string): boolean {
    const now = this.now();
    const entry = this.eventCounts.get(userId);
    if (entry === undefined || now - entry.windowStart > 10_000) {
      this.eventCounts.set(userId, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= EVENT_BURST;
  }
}

/**
 * Who may send what: a revision notice needs edit rights, a team-change notice needs
 * rights to manage the team, and anyone who can view may share a view.
 */
export function allowedToSend(role: ProjectRole, event: CollabEvent): boolean {
  const permissions = permissionsFor(role);
  switch (event.type) {
    case "design.revision":
      return permissions.has("can_edit_design");
    case "team.changed":
      return permissions.has("can_invite") || permissions.has("can_manage_channel");
    case "view.share":
      return permissions.has("can_view");
  }
}
