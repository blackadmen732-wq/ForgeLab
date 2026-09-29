import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, MessageRef, ProjectRole, PublicJwk } from "@forgelab/protocol";
import { parseChatRow } from "@forgelab/protocol";
import { TicketRefused, type IssuedTicket } from "@forgelab/multiplayer";
import { VoiceDenied, type VoiceToken } from "@forgelab/voice";
import { requireSupabase } from "./supabase.js";

/**
 * Team data: members, channels, messages and invites. Every call runs as the signed-in
 * user, so Postgres (RLS and the security-definer RPCs) decides what is allowed; the
 * browser's idea of its own role only decides which buttons to show.
 */
export interface MemberProfile {
  readonly username: string;
  readonly display_name: string;
  readonly avatar_path: string | null;
}

export interface Member {
  readonly user_id: string;
  readonly role: ProjectRole;
  readonly joined_at: string;
  readonly profile: MemberProfile | null;
}

export interface Channel {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly position: number;
  readonly is_private: boolean;
  readonly created_at: string;
}

export interface Invite {
  readonly id: string;
  readonly role: ProjectRole;
  readonly created_at: string;
  readonly expires_at: string;
  readonly max_uses: number;
  readonly uses: number;
  readonly revoked_at: string | null;
}

interface PgError {
  readonly message: string;
  readonly code?: string;
}

class CollabError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

/** The database's own messages are already written for people; keep them. */
function unwrap<T>(result: { data: T | null; error: PgError | null }): T {
  if (result.error !== null) {
    const message = /Failed to fetch|NetworkError/i.test(result.error.message)
      ? "You appear to be offline."
      : result.error.message.replace(/^rate_limited:\s*/, "");
    throw new CollabError(message.charAt(0).toUpperCase() + message.slice(1), result.error.code);
  }
  return result.data as T;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await requireSupabase();
  return unwrap((await supabase.rpc(fn, args)) as { data: T | null; error: PgError | null });
}

/* ---------------------------------------------------------------------------------- */

/** The caller's role in a project, or null if they are not a member. */
export async function getMyRole(projectId: string): Promise<ProjectRole | null> {
  const access = await rpc<{ role: ProjectRole } | null>("project_access", {
    p_project: projectId,
  });
  return access?.role ?? null;
}

export async function listMembers(projectId: string): Promise<Member[]> {
  const supabase = await requireSupabase();
  const rows = unwrap(
    await supabase
      .from("project_members")
      .select(
        "user_id, role, joined_at, profile:profiles!project_members_user_id_fkey(username, display_name, avatar_path)",
      )
      .eq("project_id", projectId)
      .order("joined_at")
      .returns<Member[]>(),
  );
  return rows ?? [];
}

export async function listChannels(projectId: string): Promise<Channel[]> {
  const supabase = await requireSupabase();
  return (
    unwrap(
      await supabase
        .from("channels")
        .select("id, project_id, name, position, is_private, created_at")
        .eq("project_id", projectId)
        .order("position")
        .order("created_at")
        .returns<Channel[]>(),
    ) ?? []
  );
}

export const createChannel = (projectId: string, name: string) =>
  rpc<string>("create_channel", { p_project: projectId, p_name: name.trim(), p_private: false });
export const renameChannel = (channelId: string, name: string) =>
  rpc<null>("rename_channel", { p_channel: channelId, p_name: name.trim() });
export const deleteChannel = (channelId: string) =>
  rpc<null>("delete_channel", { p_channel: channelId });

/* ---------------- messages ---------------- */

const MESSAGE_COLUMNS = "id, project_id, channel_id, user_id, content, refs, created_at";

/** The most recent messages in a channel, oldest first. */
export async function listMessages(channelId: string, limit = 50): Promise<ChatMessage[]> {
  const supabase = await requireSupabase();
  const rows =
    unwrap(
      await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<unknown[]>(),
    ) ?? [];
  return rows
    .map((row) => parseChatRow(row))
    .filter((m): m is ChatMessage => m !== null)
    .reverse();
}

/** The database sets the author, project and time; the browser sends only what was said. */
export async function sendMessage(
  channelId: string,
  content: string,
  refs: readonly MessageRef[] = [],
): Promise<ChatMessage> {
  const supabase = await requireSupabase();
  const row = unwrap(
    await supabase
      .from("messages")
      .insert({ channel_id: channelId, content: content.trim(), refs })
      .select(MESSAGE_COLUMNS)
      .single(),
  );
  const message = parseChatRow(row);
  if (message === null) throw new Error("The server returned an unreadable message.");
  return message;
}

/* ---------------- membership ---------------- */

export async function createInvite(
  projectId: string,
  role: Exclude<ProjectRole, "owner">,
  hours = 168,
  maxUses = 10,
): Promise<string> {
  return rpc<string>("create_invite", {
    p_project: projectId,
    p_role: role,
    p_hours: hours,
    p_max_uses: maxUses,
  });
}

export async function listInvites(projectId: string): Promise<Invite[]> {
  const supabase = await requireSupabase();
  return (
    unwrap(
      await supabase
        .from("project_invites")
        .select("id, role, created_at, expires_at, max_uses, uses, revoked_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<Invite[]>(),
    ) ?? []
  );
}

export const revokeInvite = (inviteId: string) =>
  rpc<null>("revoke_invite", { p_invite: inviteId });
export const acceptInvite = (code: string) => rpc<string>("accept_invite", { p_code: code.trim() });
export const setMemberRole = (projectId: string, userId: string, role: ProjectRole) =>
  rpc<null>("set_member_role", { p_project: projectId, p_user: userId, p_role: role });

/**
 * Removes a member (or leaves, when `userId` is yourself). Goes through the server so an
 * open voice session is ended too; falls back to the database alone where the endpoint is
 * not deployed.
 */
export async function removeMember(projectId: string, userId: string): Promise<void> {
  try {
    await callApi("/api/comms/remove-member", { projectId, userId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await rpc<null>("remove_member", { p_project: projectId, p_user: userId });
      return;
    }
    throw error;
  }
}

/* ---------------- server endpoints ---------------- */

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function accessToken(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new ApiError("Sign in first.", 401);
  return token;
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const supabase = await requireSupabase();
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await accessToken(supabase)}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("You appear to be offline.", 0);
  }
  const json = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok)
    throw new ApiError(json.error ?? `Request failed (${response.status}).`, response.status);
  return json;
}

export async function fetchPresenceTicket(
  projectId: string,
  publicKey: PublicJwk,
): Promise<IssuedTicket> {
  try {
    return await callApi<IssuedTicket>("/api/comms/ticket", { projectId, publicKey });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      throw new TicketRefused(error.message);
    if (error instanceof ApiError && (error.status === 404 || error.status === 503))
      throw new Error("Live presence isn't configured on this deployment.", { cause: error });
    throw error;
  }
}

export async function fetchVoiceToken(channelId: string): Promise<VoiceToken> {
  try {
    return await callApi<VoiceToken>("/api/voice/token", { channelId });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      throw new VoiceDenied(error.message);
    if (error instanceof ApiError && (error.status === 404 || error.status === 503))
      throw new VoiceDenied("Voice isn't configured on this deployment.");
    throw error;
  }
}

export function inviteUrl(code: string): string {
  // The code travels in the fragment, which browsers never send to a server or in a Referer.
  return `${window.location.origin}/invite#${encodeURIComponent(code)}`;
}
