/**
 * Roles and permissions — the TypeScript half of ForgeLab's single permission model.
 *
 * The database is the authority: `public.channel_permissions()` and the RLS policies in
 * supabase/migrations decide what actually happens. This module mirrors that matrix so
 * interfaces can decide what to *show* without scattering role checks through components.
 * `supabase/tests/collaboration.test.ts` asserts the two agree.
 */
export const PROJECT_ROLES = Object.freeze(["owner", "admin", "member", "viewer"] as const);
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PERMISSIONS = Object.freeze([
  "can_view",
  "can_join_voice",
  "can_speak",
  "can_send_messages",
  "can_edit_design",
  "can_manage_channel",
  "can_invite",
  "can_mute_others",
  "can_remove_member",
] as const);
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = ["can_view", "can_join_voice"];
const MEMBER: readonly Permission[] = [
  ...VIEWER,
  "can_speak",
  "can_send_messages",
  "can_edit_design",
];
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  "can_manage_channel",
  "can_invite",
  "can_mute_others",
  "can_remove_member",
];

export const ROLE_PERMISSIONS: Readonly<Record<ProjectRole, readonly Permission[]>> = Object.freeze(
  {
    owner: ADMIN,
    admin: ADMIN,
    member: MEMBER,
    viewer: VIEWER,
  },
);

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && (PROJECT_ROLES as readonly string[]).includes(value);
}

/** What a role may do in a channel. Private channels need a channel-member row below admin. */
export function permissionsFor(
  role: ProjectRole | null,
  channel: { readonly isPrivate: boolean; readonly isChannelMember: boolean } = {
    isPrivate: false,
    isChannelMember: false,
  },
): ReadonlySet<Permission> {
  if (role === null) return new Set();
  if (channel.isPrivate && role !== "owner" && role !== "admin" && !channel.isChannelMember) {
    return new Set();
  }
  return new Set(ROLE_PERMISSIONS[role]);
}

const RANK: Record<ProjectRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

/** Owners may remove anyone but an owner; admins may remove members and viewers. */
export function canRemoveMember(actor: ProjectRole, target: ProjectRole): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && RANK[target] < RANK.admin;
}

/** Owners assign admin/member/viewer; admins assign member/viewer to members and viewers. */
export function canAssignRole(actor: ProjectRole, target: ProjectRole, next: ProjectRole): boolean {
  if (target === "owner" || next === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && RANK[target] < RANK.admin && RANK[next] < RANK.admin;
}

export const ROLE_LABELS: Readonly<Record<ProjectRole, string>> = Object.freeze({
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
});
