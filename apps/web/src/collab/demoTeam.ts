import {
  WORK_TRANSITIONS,
  findRefs,
  projectWorkspaceId,
  type ChatMessage,
  type PresenceEntry,
  type PresenceState,
  type WorkOrder,
} from "@forgelab/protocol";
import type { ReceivedEvent, SessionSnapshot } from "@forgelab/multiplayer";
import type { TransportEvent, VoiceParticipant, VoiceTransport } from "@forgelab/voice";
import type { Channel, Member } from "../lib/collab.js";
import { CollabController, type CollabPorts, type SessionPort } from "./controller.js";
import {
  DEMO_CHANNELS,
  DEMO_HOME_CHANNEL,
  DEMO_PROJECT_ID,
  DEMO_SELF_ID,
  DEMO_TEAMMATES,
  DEMO_TICK_SEC,
  demoClock,
  demoFrame,
  demoTargets,
  type DemoFrame,
  type DemoPart,
} from "./demoScript.js";
import type { WorkOrderPort } from "./workOrders.js";

/**
 * Demo teammates: the production collaboration controller, panels, orbs and minimap,
 * driven by a script instead of a server (see demoScript.ts).
 *
 * Only the controller's ports are replaced. Nothing reaches a network, a database or an
 * audio device: the "voice" transport opens no microphone and plays no sound, chat stays
 * in this tab, and every surface that draws from a demo controller labels itself as demo.
 * It exists so the layout can be seen, tested and checked without a deployment.
 */

const BASE_TIME = Date.parse("2026-11-11T09:00:00Z");
const iso = (minutes: number) => new Date(BASE_TIME + minutes * 60_000).toISOString();
const uuid = (block: number, n: number) =>
  `de000000-0000-4000-8000-0000000${block.toString(16)}${n.toString(16).padStart(4, "0")}`;

const SELF_STATE: PresenceState = {
  voiceChannelId: null,
  mic: "muted",
  deafened: false,
  activity: "building",
  workspaceId: projectWorkspaceId(DEMO_PROJECT_ID),
  focus: null,
  action: null,
};

function members(): Member[] {
  const row = (id: string, name: string, role: Member["role"], order: number): Member => ({
    user_id: id,
    role,
    joined_at: iso(-10_000 + order),
    profile: { username: name.toLowerCase(), display_name: name, avatar_path: null },
  });
  return [
    ...DEMO_TEAMMATES.map((t, i) => row(t.id, t.name, t.role, i)),
    row(DEMO_SELF_ID, "You", "member", DEMO_TEAMMATES.length),
  ];
}

function channels(): Channel[] {
  return DEMO_CHANNELS.map((c, position) => ({
    id: c.id,
    project_id: DEMO_PROJECT_ID,
    name: c.name,
    position,
    is_private: false,
    created_at: iso(-10_000),
  }));
}

/** The script's clock: real elapsed time, or a pinned moment for tests and screenshots. */
class DemoClock {
  private readonly startedAt = Date.now();
  private pinned: number | null = null;
  now(): number {
    return demoClock(this.pinned ?? (Date.now() - this.startedAt) / 1000);
  }
  pin(seconds: number | null): void {
    this.pinned = seconds;
  }
  get isPinned(): boolean {
    return this.pinned !== null;
  }
}

/** The scripted presence session: the viewer's own state plus the script's roster. */
class DemoSession implements SessionPort {
  private self: PresenceState = SELF_STATE;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private scripted: readonly PresenceEntry[] = [];
  private status: SessionSnapshot["status"] = "connecting";

  snapshot(): SessionSnapshot {
    const me: PresenceEntry = {
      ...this.self,
      userId: DEMO_SELF_ID,
      name: "You",
      role: "member",
      seenAt: 0,
      seq: 0,
    };
    return {
      status: this.status,
      role: "member",
      self: this.self,
      roster:
        this.status === "connected"
          ? [...this.scripted, me].sort(
              (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
            )
          : [],
    };
  }

  setRoster(roster: readonly PresenceEntry[]): void {
    if (sameRoster(this.scripted, roster)) return;
    this.scripted = roster;
    this.emit();
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onEvent(_listener: (event: ReceivedEvent) => void): () => void {
    return () => undefined;
  }
  async start(): Promise<void> {
    this.status = "connected";
    this.emit();
  }
  async stop(): Promise<void> {
    this.status = "disconnected";
    this.emit();
  }
  update(patch: Partial<PresenceState>): void {
    const next = { ...this.self, ...patch };
    if ((Object.keys(next) as (keyof PresenceState)[]).every((k) => next[k] === this.self[k]))
      return;
    this.self = next;
    this.emit();
  }
  /** Nothing is sent anywhere: there is nobody on the other end. */
  async send(): Promise<void> {}

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

const SHOWN = ["voiceChannelId", "mic", "activity", "focus", "action"] as const;
function sameRoster(a: readonly PresenceEntry[], b: readonly PresenceEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i]!;
    return entry.userId === other.userId && SHOWN.every((k) => entry[k] === other[k]);
  });
}

/**
 * A voice "connection" to a scripted room. It reports who the script places in the
 * channel and who is speaking; it never touches a microphone or a loudspeaker.
 */
class DemoVoiceTransport implements VoiceTransport {
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private channelId: string | null = null;
  private micOn = false;

  constructor(private readonly onChange: () => void) {}

  get room(): string | null {
    return this.channelId;
  }

  async connect(_url: string, token: string): Promise<void> {
    this.channelId = token;
    this.micOn = false;
    this.onChange();
  }
  async disconnect(): Promise<void> {
    this.channelId = null;
    this.emit({ type: "disconnected", cause: "client" });
  }
  /** State only: the demo never opens a microphone. */
  async setMicrophone(enabled: boolean): Promise<void> {
    this.micOn = enabled;
    this.onChange();
  }
  async setInputDevice(): Promise<void> {}
  async setOutputDevice(): Promise<void> {}
  async setRemoteAudio(): Promise<void> {}
  async startAudio(): Promise<void> {}
  on(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pushes the script's picture of the connected room. */
  show(frame: DemoFrame): void {
    if (this.channelId === null) return;
    const inRoom = frame.roster.filter((e) => e.voiceChannelId === this.channelId);
    const participants: VoiceParticipant[] = [
      ...inRoom.map((e) => ({
        identity: e.userId,
        name: e.name,
        micEnabled: e.mic === "unmuted",
        isLocal: false,
      })),
      { identity: DEMO_SELF_ID, name: "You", micEnabled: this.micOn, isLocal: true },
    ];
    this.emit({ type: "participants", participants });
    const speaking = frame.speakers.filter((s) => inRoom.some((e) => e.userId === s.identity));
    this.emit({
      type: "speakers",
      identities: speaking.map((s) => s.identity),
      levels: Object.fromEntries(speaking.map((s) => [s.identity, s.level])),
    });
  }

  private emit(event: TransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export interface DemoTeam {
  readonly controller: CollabController;
  /** Tells the script which parts exist, so teammates hover over real ones. */
  setParts(parts: readonly DemoPart[]): void;
  /** Pins the script clock (tests, screenshots); null lets it run again. */
  setTime(seconds: number | null): void;
  /** Script time now, seconds into the loop. */
  time(): number;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Builds a demo team. Nothing runs until `start()`. */
export function createDemoTeam(): DemoTeam {
  const clock = new DemoClock();
  let parts: readonly DemoPart[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let session: DemoSession | null = null;
  const transports = new Set<DemoVoiceTransport>();
  /** What the viewer typed, per channel. It never leaves this tab. */
  const typed = new Map<string, ChatMessage[]>();
  /** Bumped by every start and stop, so a start that was overtaken does nothing more. */
  let run = 0;
  let orders: WorkOrder[] | null = null;
  const workListeners = new Set<() => void>();
  let sequence = 0;

  const refresh = () => {
    const frame = demoFrame(clock.now(), parts);
    session?.setRoster(frame.roster);
    for (const transport of transports) transport.show(frame);
  };

  /** Scripted chat backlog for the home channel; it links a real part when one exists. */
  const backlog = (channelId: string): ChatMessage[] => {
    if (channelId !== DEMO_HOME_CHANNEL) return [];
    const targets = demoTargets(parts);
    const exists = (id: string) => parts.some((p) => p.id === id);
    const by = (name: string) => DEMO_TEAMMATES.find((t) => t.name === name)!;
    const say = (name: string, minute: number, content: string): ChatMessage => ({
      id: uuid(2, minute),
      projectId: DEMO_PROJECT_ID,
      channelId,
      userId: by(name).id,
      content,
      refs: findRefs(content, (id) => (exists(id) ? "component" : null)),
      createdAt: iso(minute),
    });
    const coil = targets.get(by("Maya").id)?.[0];
    const mention = coil !== undefined && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(coil) ? ` @${coil}` : "";
    return [
      say("Alex", 1, "I'm on the vacuum pump. Give me a minute before anyone activates."),
      say("Maya", 2, `Editing the TF coil${mention} — I'm changing its conductor, hands off.`),
      say("Andre", 3, "Moving the coolant pipe clear of the platform."),
      say("Sam", 4, "Mic's off. I'm in the control settings."),
    ];
  };

  const scriptedOrders = (): WorkOrder[] => {
    const targets = demoTargets(parts);
    const by = (name: string) => DEMO_TEAMMATES.find((t) => t.name === name)!;
    const order = (
      n: number,
      patch: Pick<WorkOrder, "assignedTo" | "targetComponentId" | "taskType" | "title" | "status"> &
        Partial<WorkOrder>,
    ): WorkOrder => ({
      id: uuid(3, n),
      projectId: DEMO_PROJECT_ID,
      createdBy: by("Alex").id,
      targetVersionId: null,
      description: "Scripted demo job. Accepting or completing it changes nothing outside this tab.",
      priority: "normal",
      createdAt: iso(n),
      updatedAt: iso(n),
      completedAt: null,
      ...patch,
    });
    const out: WorkOrder[] = [];
    const coil = targets.get(by("Maya").id)?.[0];
    if (coil !== undefined)
      out.push(
        order(1, {
          assignedTo: by("Maya").id,
          targetComponentId: coil,
          taskType: "inspect",
          title: "Inspect the coil joint",
          status: "in_progress",
        }),
      );
    const pump = targets.get(by("Alex").id)?.[0];
    if (pump !== undefined)
      out.push(
        order(2, {
          assignedTo: DEMO_SELF_ID,
          targetComponentId: pump,
          taskType: "inspect",
          title: "Check the vacuum pump inlet",
          status: "offered",
          priority: "high",
        }),
      );
    return out;
  };

  const work: WorkOrderPort = {
    list: async () => (orders ??= scriptedOrders()),
    create: async (projectId, draft) => {
      sequence += 1;
      const now = new Date().toISOString();
      const created: WorkOrder = {
        id: uuid(4, sequence),
        projectId,
        createdBy: DEMO_SELF_ID,
        targetVersionId: null,
        status: "offered",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        ...draft,
      };
      orders = [created, ...(orders ?? scriptedOrders())];
      for (const changed of workListeners) changed();
      return created;
    },
    transition: async (order, status) => {
      const current = (orders ?? scriptedOrders()).find((w) => w.id === order.id);
      if (current === undefined || current.status !== order.status)
        throw new Error("This job changed; refresh and try again.");
      if (!WORK_TRANSITIONS[current.status].includes(status))
        throw new Error("That step isn't available for this job.");
      const now = new Date().toISOString();
      const next: WorkOrder = {
        ...current,
        status,
        updatedAt: now,
        completedAt: status === "completed" ? now : null,
      };
      orders = (orders ?? []).map((w) => (w.id === next.id ? next : w));
      for (const changed of workListeners) changed();
      return next;
    },
    subscribe: async (_projectId, changed) => {
      workListeners.add(changed);
      return () => workListeners.delete(changed);
    },
  };

  let prefs = { muted: true } as ReturnType<CollabPorts["voicePrefs"]["read"]>;
  const ports: CollabPorts = {
    getMyRole: async () => "member",
    listMembers: async () => members(),
    listChannels: async () => channels(),
    listMessages: async (channelId) => [...backlog(channelId), ...(typed.get(channelId) ?? [])],
    sendMessage: async (channelId, content, refs) => {
      sequence += 1;
      const message: ChatMessage = {
        id: uuid(5, sequence),
        projectId: DEMO_PROJECT_ID,
        channelId,
        userId: DEMO_SELF_ID,
        content,
        refs,
        createdAt: new Date().toISOString(),
      };
      typed.set(channelId, [...(typed.get(channelId) ?? []), message]);
      return message;
    },
    subscribeChat: async (_channelId, _onRow, onStatus) => {
      onStatus(true);
      return () => undefined;
    },
    openSession: async (_projectId, initial) => {
      session = new DemoSession();
      session.update(initial);
      return session;
    },
    voice: {
      requestToken: async (channelId) => ({ url: "demo:", token: channelId, canSpeak: true }),
      createTransport: async () => {
        const transport = new DemoVoiceTransport(refresh);
        transports.add(transport);
        transport.on((event) => {
          if (event.type === "disconnected") transports.delete(transport);
        });
        return transport;
      },
    },
    voicePrefs: {
      read: () => prefs,
      write: (next) => {
        prefs = next;
      },
    },
  };

  const controller = new CollabController(DEMO_PROJECT_ID, DEMO_SELF_ID, work, {
    ports,
    demo: true,
  });

  return {
    controller,
    setParts(next) {
      if (
        next.length === parts.length &&
        next.every((p, i) => p.id === parts[i]!.id && p.role === parts[i]!.role)
      )
        return;
      const first = parts.length === 0 && orders !== null && orders.length === 0;
      parts = next;
      // Scripted jobs point at real parts: write them once a design is there to point at.
      if (first) {
        orders = null;
        for (const changed of workListeners) changed();
      }
      refresh();
    },
    setTime(seconds) {
      clock.pin(seconds);
      refresh();
    },
    time: () => clock.now(),
    async start() {
      const mine = ++run;
      await controller.start();
      if (mine !== run) return;
      refresh();
      timer ??= setInterval(refresh, DEMO_TICK_SEC * 1000);
      // The viewer sits in the home channel, so its chat and who is speaking show the way
      // they would live.
      await controller.selectTextChannel(DEMO_HOME_CHANNEL);
      if (mine !== run) return;
      await controller.voice.join(DEMO_HOME_CHANNEL);
      if (mine !== run) {
        await controller.voice.leave();
        return;
      }
      refresh();
    },
    async stop() {
      run += 1;
      if (timer !== null) clearInterval(timer);
      timer = null;
      await controller.stop();
      transports.clear();
    },
  };
}
