import {
  ROLE_PERMISSIONS,
  findRefs,
  normaliseMessage,
  parseChatRow,
  personalWorkspaceId,
  type Activity,
  type ChatMessage,
  type Permission,
  type ProjectRole,
} from "@forgelab/protocol";
import { ProjectSession, type SessionSnapshot } from "@forgelab/multiplayer";
import {
  VoiceClient,
  createLiveKitTransport,
  presenceMic,
  type MicMode,
  type VoiceState,
} from "@forgelab/voice";
import {
  fetchPresenceTicket,
  fetchVoiceToken,
  getMyRole,
  listChannels,
  listMembers,
  listMessages,
  sendMessage,
  type Channel,
  type Member,
} from "../lib/collab.js";
import { safeStorage } from "../lib/storage.js";
import { requireSupabase } from "../lib/supabase.js";
import { subscribeChat, supabaseTransport } from "./realtime.js";

export interface RevisionNotice {
  readonly fromName: string;
  readonly fromUserId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly label: string | null;
}

export interface CollabState {
  readonly role: ProjectRole | null;
  readonly loading: boolean;
  /** Fatal: the team features cannot be shown (not a member, removed, offline at start). */
  readonly error: string | null;
  /** Non-fatal: live presence is unavailable, but chat and saving still work. */
  readonly presenceError: string | null;
  readonly members: readonly Member[];
  readonly channels: readonly Channel[];
  readonly session: SessionSnapshot;
  readonly textChannelId: string | null;
  readonly messages: readonly ChatMessage[];
  readonly chat: "loading" | "live" | "offline";
  readonly chatError: string | null;
  readonly voice: VoiceState;
  readonly revision: RevisionNotice | null;
}

const VOICE_PREFS = "forgelab.voice.v1";
const MAX_MESSAGES = 200;

interface VoicePrefs {
  muted?: boolean;
  mode?: MicMode;
  inputDeviceId?: string | null;
  outputDeviceId?: string | null;
}

/**
 * Everything live about one shared project for the signed-in member: who is here, the
 * channels, the open text channel, and their voice connection. Each layer degrades on
 * its own — voice failing never stops chat, and neither stops the design from saving.
 */
export class CollabController {
  readonly voice: VoiceClient;
  private session: ProjectSession | null = null;
  private state: CollabState;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private chatUnsubscribe: (() => void) | null = null;
  /** Users we already re-read the member list for. */
  private readonly asked = new Set<string>();
  /**
   * Bumped by every start and stop. Async work checks it before touching state, so a
   * stop (or React's development double-mount) cleanly abandons whatever was in flight.
   */
  private generation = 0;

  constructor(
    readonly projectId: string,
    readonly userId: string,
  ) {
    const prefs = safeStorage.getJson<VoicePrefs>(VOICE_PREFS, {});
    this.voice = new VoiceClient({
      requestToken: fetchVoiceToken,
      createTransport: () =>
        createLiveKitTransport({ debug: safeStorage.get("forgelab.debugVoice") === "1" }),
      preferences: {
        muted: prefs.muted === true,
        mode: prefs.mode === "push-to-talk" ? "push-to-talk" : "open",
        inputDeviceId: typeof prefs.inputDeviceId === "string" ? prefs.inputDeviceId : null,
        outputDeviceId: typeof prefs.outputDeviceId === "string" ? prefs.outputDeviceId : null,
      },
    });
    this.state = {
      role: null,
      loading: true,
      error: null,
      presenceError: null,
      members: [],
      channels: [],
      session: { status: "connecting", role: null, self: IDLE_SELF(userId), roster: [] },
      textChannelId: null,
      messages: [],
      chat: "loading",
      chatError: null,
      voice: this.voice.getState(),
      revision: null,
    };
  }

  getState = (): CollabState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  can(permission: Permission): boolean {
    return this.state.role !== null && ROLE_PERMISSIONS[this.state.role].includes(permission);
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    const stale = () => generation !== this.generation;
    this.set({ loading: true, error: null });
    try {
      const [role, members, channels] = await Promise.all([
        getMyRole(this.projectId),
        listMembers(this.projectId),
        listChannels(this.projectId),
      ]);
      if (stale()) return;
      if (role === null) {
        this.set({ loading: false, error: "You're not a member of this project." });
        return;
      }
      this.set({ role, members, channels, loading: false });
      const general = channels[0];
      if (general !== undefined) void this.selectTextChannel(general.id);
    } catch (error) {
      if (!stale()) this.set({ loading: false, error: message(error) });
      return;
    }

    this.cleanups.push(
      this.voice.subscribe((voice) => {
        this.set({ voice });
        this.session?.update({
          voiceChannelId: voice.phase === "idle" ? null : voice.channelId,
          mic: presenceMic(voice),
          deafened: voice.deafened,
        });
        safeStorage.setJson(VOICE_PREFS, {
          muted: voice.muted,
          mode: voice.mode,
          inputDeviceId: voice.inputDeviceId,
          outputDeviceId: voice.outputDeviceId,
        } satisfies VoicePrefs);
      }),
    );
    await this.startSession(stale);
  }

  private async startSession(stale: () => boolean): Promise<void> {
    const supabase = await requireSupabase();
    if (stale()) return;
    const session = new ProjectSession({
      projectId: this.projectId,
      transport: supabaseTransport(supabase),
      fetchTicket: (key) => fetchPresenceTicket(this.projectId, key),
      initial: { workspaceId: personalWorkspaceId(this.userId) },
    });
    this.session = session;
    this.cleanups.push(
      session.subscribe((snapshot) => {
        this.set({ session: snapshot });
        // Someone verified is here whom the member list doesn't know yet: they just joined.
        const unknown = snapshot.roster.filter(
          (e) =>
            !this.state.members.some((m) => m.user_id === e.userId) && !this.asked.has(e.userId),
        );
        if (unknown.length > 0) {
          for (const e of unknown) this.asked.add(e.userId);
          void this.refresh().catch(() => undefined);
        }
        if (snapshot.status === "unauthorized") {
          void this.voice.leave();
          this.set({ role: null, error: "You no longer have access to this project." });
        }
      }),
      session.onEvent((received) => {
        if (received.event.type === "team.changed") {
          void this.refresh().catch(() => undefined);
          return;
        }
        if (received.event.type !== "design.revision") return;
        this.set({
          revision: {
            fromName: received.from.name,
            fromUserId: received.from.userId,
            versionId: received.event.versionId,
            versionNumber: received.event.versionNumber,
            label: received.event.label,
          },
        });
      }),
    );
    try {
      await session.start();
    } catch (error) {
      if (!stale()) this.set({ presenceError: message(error) });
    }
    if (stale()) await session.stop();
  }

  async stop(): Promise<void> {
    this.generation += 1;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.chatUnsubscribe?.();
    this.chatUnsubscribe = null;
    const session = this.session;
    this.session = null;
    await Promise.allSettled([this.voice.leave(), session?.stop()]);
  }

  /* ---------------- data ---------------- */

  /** Re-reads role, members and channels (after a team change anyone announced). */
  async refresh(): Promise<void> {
    const generation = this.generation;
    const [role, members, channels] = await Promise.all([
      getMyRole(this.projectId),
      listMembers(this.projectId),
      listChannels(this.projectId),
    ]);
    if (generation !== this.generation) return;
    if (role === null) {
      await this.voice.leave();
      this.set({
        role: null,
        members: [],
        channels: [],
        error: "You no longer have access to this project.",
      });
      return;
    }
    this.set({ role, members, channels });
    if (!channels.some((c) => c.id === this.state.textChannelId) && channels[0])
      void this.selectTextChannel(channels[0].id);
  }

  /* ---------------- text chat ---------------- */

  async selectTextChannel(channelId: string): Promise<void> {
    if (this.state.textChannelId === channelId && this.chatUnsubscribe !== null) return;
    this.chatUnsubscribe?.();
    this.set({ textChannelId: channelId, messages: [], chat: "loading", chatError: null });
    const generation = this.generation;
    const supabase = await requireSupabase();
    if (generation !== this.generation || this.state.textChannelId !== channelId) return;
    // Subscribe first so nothing sent while the history loads is missed.
    this.chatUnsubscribe = subscribeChat(
      supabase,
      channelId,
      (row) => {
        const received = parseChatRow(row);
        if (received !== null && received.channelId === this.state.textChannelId)
          this.addMessages([received]);
      },
      (connected) => {
        if (this.state.textChannelId === channelId && this.state.chat !== "loading")
          this.set({ chat: connected ? "live" : "offline" });
      },
    );
    try {
      const history = await listMessages(channelId);
      if (this.state.textChannelId !== channelId) return;
      this.addMessages(history);
      this.set({ chat: "live" });
    } catch (error) {
      if (this.state.textChannelId === channelId)
        this.set({ chat: "offline", chatError: message(error) });
    }
  }

  /**
   * Sends to the open text channel. `@id` handles that name a component in the current
   * design become references the reader can click.
   */
  async send(text: string, componentExists: (id: string) => boolean): Promise<void> {
    const channelId = this.state.textChannelId;
    const content = normaliseMessage(text);
    if (channelId === null || content === null) return;
    const refs = findRefs(content, (id) => (componentExists(id) ? "component" : null));
    const sent = await sendMessage(channelId, content, refs);
    if (sent.channelId === this.state.textChannelId) this.addMessages([sent]);
  }

  private addMessages(incoming: readonly ChatMessage[]): void {
    const byId = new Map(this.state.messages.map((m) => [m.id, m]));
    for (const m of incoming) byId.set(m.id, m);
    const messages = [...byId.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(-MAX_MESSAGES);
    this.set({ messages });
  }

  /* ---------------- presence and collaboration ---------------- */

  setActivity(activity: Activity): void {
    this.session?.update({ activity });
  }

  /** Tells everyone else a new version exists. Saving itself went through Postgres. */
  announceRevision(version: { id: string; version_number: number; label: string | null }): void {
    if (!this.can("can_edit_design")) return;
    void this.session
      ?.send({
        type: "design.revision",
        versionId: version.id,
        versionNumber: version.version_number,
        label: version.label,
      })
      .catch(() => undefined);
  }

  /** After a membership or channel change: tell everyone to re-read the team. */
  announceTeamChange(): void {
    void this.refresh().catch(() => undefined);
    if (!this.can("can_invite") && !this.can("can_manage_channel")) return;
    void this.session?.send({ type: "team.changed" }).catch(() => undefined);
  }

  dismissRevision(): void {
    this.set({ revision: null });
  }

  memberName(userId: string): string {
    const member = this.state.members.find((m) => m.user_id === userId);
    if (member?.profile) return member.profile.display_name || member.profile.username;
    return this.state.session.roster.find((e) => e.userId === userId)?.name ?? "Former member";
  }

  private set(patch: Partial<CollabState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function IDLE_SELF(userId: string) {
  return {
    voiceChannelId: null,
    mic: "muted" as const,
    deafened: false,
    activity: "building" as const,
    workspaceId: personalWorkspaceId(userId),
    focus: null,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
