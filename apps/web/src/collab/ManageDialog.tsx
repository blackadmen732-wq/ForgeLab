import { Check, Copy, Hash, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  LIMITS,
  PROJECT_ROLES,
  ROLE_LABELS,
  canAssignRole,
  canRemoveMember,
  type ProjectRole,
} from "@forgelab/protocol";
import { Dialog } from "../components/Dialog.js";
import {
  createChannel,
  createInvite,
  deleteChannel,
  inviteUrl,
  listInvites,
  removeMember,
  renameChannel,
  revokeInvite,
  setMemberRole,
} from "../lib/collab.js";
import { confirmDialog } from "../lib/confirm.js";
import { relativeTime } from "../lib/format.js";
import { errorMessage, toast } from "../lib/toast.js";
import { useAsync } from "../lib/useAsync.js";
import { useCollab, useCollabController } from "./context.js";

type Tab = "members" | "invites" | "channels";

/**
 * Members, invites and channels. The buttons shown follow the caller's role, but every
 * action is decided by the database (and audited there); a refusal is shown as-is.
 */
export function ManageDialog({ onClose }: { onClose: () => void }) {
  const controller = useCollabController();
  const [tab, setTab] = useState<Tab>("members");
  if (controller === null) return null;
  const tabs: [Tab, string, boolean][] = [
    ["members", "Members", true],
    ["invites", "Invite", controller.can("can_invite")],
    ["channels", "Channels", controller.can("can_manage_channel")],
  ];
  return (
    <Dialog title="Project team" onClose={onClose} wide>
      <div className="segmented" role="tablist" aria-label="Section">
        {tabs
          .filter(([, , allowed]) => allowed)
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="manage">
        {tab === "members" && <MembersTab />}
        {tab === "invites" && <InvitesTab />}
        {tab === "channels" && <ChannelsTab />}
      </div>
    </Dialog>
  );
}

async function run(action: () => Promise<unknown>, success: string, after: () => void) {
  try {
    await action();
    toast("success", success, undefined, 2000);
    after();
  } catch (error) {
    toast("error", "That didn't work", errorMessage(error));
  }
}

function MembersTab() {
  const controller = useCollabController()!;
  const members = useCollab((s) => s.members) ?? [];
  const myRole = useCollab((s) => s.role) ?? null;
  const refresh = () => controller.announceTeamChange();

  return (
    <ul className="manage__list">
      {members.map((m) => {
        const name = m.profile?.display_name || m.profile?.username || "Member";
        const me = m.user_id === controller.userId;
        const assignable =
          myRole === null
            ? []
            : PROJECT_ROLES.filter((r) => r !== "owner" && canAssignRole(myRole, m.role, r));
        return (
          <li key={m.user_id} className="manage__row">
            <span className="manage__name">
              {name}
              {me && <span className="dim"> (you)</span>}
              {m.profile && <span className="dim"> @{m.profile.username}</span>}
            </span>
            {!me && assignable.length > 0 && m.role !== "owner" ? (
              <select
                className="input"
                aria-label={`Role for ${name}`}
                value={m.role}
                onChange={(e) =>
                  void run(
                    () =>
                      setMemberRole(controller.projectId, m.user_id, e.target.value as ProjectRole),
                    `${name} is now ${ROLE_LABELS[e.target.value as ProjectRole].toLowerCase()}`,
                    refresh,
                  )
                }
              >
                {[m.role, ...assignable.filter((r) => r !== m.role)].map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="badge">{ROLE_LABELS[m.role]}</span>
            )}
            {!me && myRole !== null && canRemoveMember(myRole, m.role) && (
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label={`Remove ${name}`}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Remove ${name}?`,
                    body: "They lose access to the design, channels and voice right away, including any voice call they're in.",
                    confirmLabel: "Remove",
                    danger: true,
                  });
                  if (ok)
                    await run(
                      () => removeMember(controller.projectId, m.user_id),
                      `${name} removed`,
                      refresh,
                    );
                }}
              >
                <Trash2 />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function InvitesTab() {
  const controller = useCollabController()!;
  const myRole = useCollab((s) => s.role) ?? "viewer";
  const invites = useAsync(() => listInvites(controller.projectId), [controller.projectId]);
  const [role, setRole] = useState<Exclude<ProjectRole, "owner">>("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const offer = (["admin", "member", "viewer"] as const).filter(
    (r) => myRole === "owner" || (myRole === "admin" && r !== "admin"),
  );

  const create = async () => {
    try {
      const code = await createInvite(controller.projectId, role);
      setLink(inviteUrl(code));
      setCopied(false);
      invites.reload();
    } catch (error) {
      toast("error", "Couldn't create an invite", errorMessage(error));
    }
  };

  return (
    <div className="manage__invites">
      <div className="row">
        <label className="field">
          <span className="field__label">Join as</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {offer.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--primary" onClick={() => void create()}>
          <Link2 /> Create invite link
        </button>
      </div>
      {link !== null && (
        <div className="manage__link">
          <input
            className="input mono"
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              void navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => toast("info", "Copy the link from the box"),
              )
            }
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </button>
          <p className="dim field__hint">
            Shown once. Works for 7 days and up to 10 people; anyone with it can join as{" "}
            {ROLE_LABELS[role].toLowerCase()}.
          </p>
        </div>
      )}
      <h3 className="manage__subhead">Active invites</h3>
      <ul className="manage__list">
        {(invites.data ?? [])
          .filter(
            (i) =>
              i.revoked_at === null && new Date(i.expires_at) > new Date() && i.uses < i.max_uses,
          )
          .map((invite) => (
            <li key={invite.id} className="manage__row">
              <span className="manage__name">
                {ROLE_LABELS[invite.role]} invite
                <span className="dim">
                  {" "}
                  · {invite.uses}/{invite.max_uses} used · expires {relativeTime(invite.expires_at)}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() =>
                  void run(() => revokeInvite(invite.id), "Invite revoked", invites.reload)
                }
              >
                Revoke
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

function ChannelsTab() {
  const controller = useCollabController()!;
  const channels = useCollab((s) => s.channels) ?? [];
  const [name, setName] = useState("");
  const refresh = () => controller.announceTeamChange();
  return (
    <div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === "") return;
          void run(
            () => createChannel(controller.projectId, name),
            `#${name.trim()} created`,
            () => {
              setName("");
              refresh();
            },
          );
        }}
      >
        <input
          className="input"
          value={name}
          maxLength={LIMITS.channelNameMaxChars}
          placeholder="New channel name, e.g. Reactor Team"
          aria-label="New channel name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={name.trim() === ""}>
          Create channel
        </button>
      </form>
      <p className="dim field__hint">Each channel has its own text chat and its own voice room.</p>
      <ul className="manage__list">
        {channels.map((c) => (
          <li key={c.id} className="manage__row">
            <span className="manage__name">
              <Hash aria-hidden="true" /> {c.name}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                const next = window.prompt("Rename channel", c.name);
                if (next !== null && next.trim() !== "" && next.trim() !== c.name)
                  void run(() => renameChannel(c.id, next), "Channel renamed", refresh);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={`Delete ${c.name}`}
              disabled={channels.length <= 1}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Delete #${c.name}?`,
                  body: "Its messages are deleted, and nobody can join its voice room again.",
                  confirmLabel: "Delete channel",
                  danger: true,
                });
                if (ok) await run(() => deleteChannel(c.id), "Channel deleted", refresh);
              }}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
