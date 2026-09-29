import "./collab.css";
import { Hash, Headphones, MicOff, Send, Settings, UserPlus, Users, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  LIMITS,
  ROLE_LABELS,
  segments,
  type ChatMessage,
  type PresenceEntry,
} from "@forgelab/protocol";
import { voiceSupported } from "@forgelab/voice";
import { errorMessage, toast } from "../lib/toast.js";
import { useCollab, useCollabController } from "./context.js";

const NO_MESSAGES: readonly ChatMessage[] = [];
const ACTIVITY_LABELS = { building: "Building", simulating: "Simulating", observing: "Observing" };

/**
 * The team side panel: channels (each with its voice occupants and a text chat), and who
 * is in the project. Voice routing is by channel only; the panel shows who is in which
 * channel, never who is "near" whom.
 */
export function TeamPanel({
  onClose,
  onManage,
  onFocusComponent,
  componentExists,
}: {
  onClose: () => void;
  onManage: () => void;
  onFocusComponent: (id: string) => void;
  componentExists: (id: string) => boolean;
}) {
  const controller = useCollabController();
  const state = useCollab((s) => s);
  if (controller === null || state === undefined) return null;

  const online = state.session.roster.length;
  const canManage = controller.can("can_invite") || controller.can("can_manage_channel");

  return (
    <aside className="team" aria-label="Team">
      <header className="team__head">
        <Users aria-hidden="true" />
        <h2>Team</h2>
        <span className="dim">{online > 0 ? `${online} online` : ""}</span>
        <span className="team__spacer" />
        {canManage && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label="Members, invites and channels"
            data-tip="Members, invites and channels"
            onClick={onManage}
          >
            {controller.can("can_invite") ? <UserPlus /> : <Settings />}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Close team panel"
          onClick={onClose}
        >
          <X />
        </button>
      </header>

      {state.loading ? (
        <p className="team__empty dim">Loading…</p>
      ) : state.error !== null ? (
        <p className="team__empty form-error" role="alert">
          {state.error}
        </p>
      ) : (
        <>
          {state.presenceError !== null && (
            <p className="team__warning" role="status">
              Live presence is unavailable: {state.presenceError}
            </p>
          )}
          <Channels />
          <Chat
            key={state.textChannelId}
            onFocusComponent={onFocusComponent}
            componentExists={componentExists}
          />
          <Members />
        </>
      )}
    </aside>
  );
}

function Channels() {
  const controller = useCollabController()!;
  const channels = useCollab((s) => s.channels) ?? [];
  const roster = useCollab((s) => s.session.roster) ?? [];
  const voice = useCollab((s) => s.voice)!;
  const textChannelId = useCollab((s) => s.textChannelId);
  const canVoice = controller.can("can_join_voice") && voiceSupported();

  return (
    <nav className="team__channels" aria-label="Channels">
      <ul>
        {channels.map((channel) => {
          const inVoice = roster.filter((e) => e.voiceChannelId === channel.id);
          const here = voice.channelId === channel.id;
          return (
            <li key={channel.id} className="channel">
              <div className="channel__row">
                <button
                  type="button"
                  className={`channel__name${textChannelId === channel.id ? " is-active" : ""}`}
                  aria-current={textChannelId === channel.id ? "true" : undefined}
                  onClick={() => void controller.selectTextChannel(channel.id)}
                >
                  <Hash aria-hidden="true" /> {channel.name}
                </button>
                {canVoice && (
                  <button
                    type="button"
                    className={`btn btn--sm${here ? " btn--primary" : ""}`}
                    aria-label={
                      here ? `Leave voice in ${channel.name}` : `Join voice in ${channel.name}`
                    }
                    onClick={() =>
                      void (here ? controller.voice.leave() : controller.voice.join(channel.id))
                    }
                  >
                    <Headphones /> {here ? "Leave" : "Join"}
                  </button>
                )}
              </div>
              {inVoice.length > 0 && (
                <ul className="channel__voice" aria-label={`In voice in ${channel.name}`}>
                  {inVoice.map((entry) => (
                    <VoiceOccupant key={entry.userId} entry={entry} here={here} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!voiceSupported() && (
        <p className="dim team__note">This browser can't do voice; chat still works.</p>
      )}
      {voice.error !== null && voice.phase === "idle" && (
        <p className="form-error team__note" role="alert">
          {voice.error}
        </p>
      )}
    </nav>
  );
}

function VoiceOccupant({ entry, here }: { entry: PresenceEntry; here: boolean }) {
  // Speaking comes from the SFU, so it's only known for the channel we're connected to.
  const speaking = useCollab(
    (s) => here && s.voice.members.some((m) => m.identity === entry.userId && m.speaking),
  );
  return (
    <li className={`channel__occupant${speaking ? " is-speaking" : ""}`}>
      <span className="channel__initial" aria-hidden="true">
        {entry.name.slice(0, 1).toUpperCase()}
      </span>
      {entry.name}
      {speaking && <span className="visually-hidden">, speaking</span>}
      {entry.mic !== "unmuted" && (
        <MicOff aria-label={entry.mic === "unavailable" ? "Listening only" : "Muted"} />
      )}
    </li>
  );
}

function Chat({
  onFocusComponent,
  componentExists,
}: {
  onFocusComponent: (id: string) => void;
  componentExists: (id: string) => boolean;
}) {
  const controller = useCollabController()!;
  const messages = useCollab((s) => s.messages) ?? NO_MESSAGES;
  const chat = useCollab((s) => s.chat);
  const chatError = useCollab((s) => s.chatError);
  const channel = useCollab((s) => s.channels.find((c) => c.id === s.textChannelId));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const canSend = controller.can("can_send_messages");

  useLayoutEffect(() => {
    const el = list.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (draft.trim() === "" || sending) return;
    setSending(true);
    try {
      await controller.send(draft, componentExists);
      setDraft("");
    } catch (error) {
      toast("error", "Message not sent", errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  if (channel === undefined) return null;
  return (
    <section className="chat" aria-label={`Messages in ${channel.name}`}>
      <header className="chat__head">
        <Hash aria-hidden="true" />
        <strong>{channel.name}</strong>
        {chat === "offline" && <span className="chat__status">offline</span>}
      </header>
      <ol className="chat__list" ref={list} aria-live="polite">
        {chat === "loading" && <li className="dim chat__empty">Loading messages…</li>}
        {chat !== "loading" && messages.length === 0 && (
          <li className="dim chat__empty">No messages yet. Say hello.</li>
        )}
        {messages.map((m, i) => (
          <Message
            key={m.id}
            message={m}
            continued={i > 0 && messages[i - 1]!.userId === m.userId}
            onFocusComponent={onFocusComponent}
          />
        ))}
      </ol>
      {chatError !== null && <p className="form-error team__note">{chatError}</p>}
      {canSend ? (
        <form
          className="chat__composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="input"
            rows={2}
            value={draft}
            maxLength={LIMITS.messageMaxChars}
            placeholder={`Message #${channel.name} — @part-id links a component`}
            aria-label={`Message #${channel.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="submit"
            className="btn btn--icon btn--sm"
            aria-label="Send"
            disabled={sending || draft.trim() === ""}
          >
            <Send />
          </button>
        </form>
      ) : (
        <p className="dim team__note">Viewers can read messages but not send them.</p>
      )}
    </section>
  );
}

function Message({
  message,
  continued,
  onFocusComponent,
}: {
  message: ChatMessage;
  continued: boolean;
  onFocusComponent: (id: string) => void;
}) {
  const controller = useCollabController()!;
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className={`message${continued ? " message--continued" : ""}`}>
      {!continued && (
        <div className="message__meta">
          <strong>{controller.memberName(message.userId)}</strong>
          <time dateTime={message.createdAt}>{time}</time>
        </div>
      )}
      {/* Text only: React escapes it, and nothing here is ever parsed as HTML. */}
      <p className="message__body">
        {segments(message.content, message.refs).map((part, i) =>
          "ref" in part && part.ref.kind === "component" ? (
            <button
              key={i}
              type="button"
              className="message__ref"
              data-tip="Show this component"
              onClick={() => onFocusComponent(part.ref.id)}
            >
              {part.text}
            </button>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
    </li>
  );
}

function Members() {
  const members = useCollab((s) => s.members) ?? [];
  const roster = useCollab((s) => s.session.roster) ?? [];
  const channels = useCollab((s) => s.channels) ?? [];
  const [open, setOpen] = useState(true);
  const byId = new Map(roster.map((e) => [e.userId, e]));
  const sorted = [...members].sort(
    (a, b) => Number(byId.has(b.user_id)) - Number(byId.has(a.user_id)),
  );
  return (
    <section className="team__members">
      <button
        type="button"
        className="team__section-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Members · {members.length}
      </button>
      {open && (
        <ul>
          {sorted.map((m) => {
            const live = byId.get(m.user_id);
            const name = m.profile?.display_name || m.profile?.username || "Member";
            const voiceIn = live?.voiceChannelId
              ? channels.find((c) => c.id === live.voiceChannelId)?.name
              : undefined;
            return (
              <li key={m.user_id} className={`member${live ? " is-online" : ""}`}>
                <span className="member__dot" aria-hidden="true" />
                <span className="member__name">{name}</span>
                <span className="member__detail dim">
                  {live
                    ? `${ACTIVITY_LABELS[live.activity]}${voiceIn ? ` · in ${voiceIn}` : ""}`
                    : "Offline"}
                </span>
                <span className="badge">{ROLE_LABELS[m.role]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
