import {
  Headphones,
  HeadphoneOff,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Settings2,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  listAudioDevices,
  micBlockMessage,
  supportsOutputSelection,
  type AudioDevice,
} from "@forgelab/voice";
import { isTypingTarget } from "../lib/platform.js";
import { useCollab, useCollabController } from "./context.js";

/** Push-to-talk key: the backquote key, below Escape, which no builder shortcut uses. */
export const PTT_CODE = "Backquote";

/**
 * The compact, always-visible voice panel: which channel you're in, who's there, who's
 * talking, and the controls. Shown only while connected to a voice channel.
 */
export function VoiceBar() {
  const controller = useCollabController();
  const voice = useCollab((s) => s.voice);
  const channels = useCollab((s) => s.channels);
  const [settings, setSettings] = useState(false);

  // Push-to-talk: hold the key anywhere in the workspace except while typing.
  useEffect(() => {
    if (controller === null || voice?.mode !== "push-to-talk" || voice.channelId === null) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== PTT_CODE || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      void controller.voice.pushToTalk(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== PTT_CODE) return;
      void controller.voice.pushToTalk(false);
    };
    const blur = () => void controller.voice.pushToTalk(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [controller, voice?.mode, voice?.channelId]);

  if (controller === null || voice === undefined || voice.channelId === null) return null;
  const channel = channels?.find((c) => c.id === voice.channelId);
  const client = controller.voice;
  const connecting = voice.phase === "joining" || voice.phase === "reconnecting";
  const block = micBlockMessage(voice.micBlock);
  const micOff =
    voice.micBlock !== null || voice.deafened || (voice.mode === "open" && voice.muted);

  return (
    <section className="voicebar" aria-label="Voice">
      <header className="voicebar__head">
        <span className={`voicebar__dot${connecting ? " is-pending" : ""}`} aria-hidden="true" />
        <strong className="voicebar__channel">{(channel?.name ?? "Voice").toUpperCase()}</strong>
        <span className="dim" role="status">
          {voice.phase === "joining"
            ? "Connecting…"
            : voice.phase === "reconnecting"
              ? "Reconnecting…"
              : `${voice.members.length} connected`}
        </span>
      </header>

      {voice.members.length > 0 && (
        <ul className="voicebar__members" aria-label="In this voice channel">
          {voice.members.map((m) => (
            <li
              key={m.identity}
              className={`voicebar__member${m.speaking ? " is-speaking" : ""}`}
              data-tip={`${m.name}${m.isLocal ? " (you)" : ""}${m.micEnabled ? "" : " · muted"}`}
            >
              <span className="voicebar__initial" aria-hidden="true">
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="visually-hidden">
                {m.name}
                {m.speaking ? ", speaking" : ""}
                {m.micEnabled ? "" : ", muted"}
              </span>
              {!m.micEnabled && <MicOff className="voicebar__muted" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}

      {block !== null && <p className="voicebar__note">{block}</p>}
      {voice.mode === "push-to-talk" && voice.micBlock === null && !voice.deafened && (
        <p className="voicebar__note">{voice.pttHeld ? "Transmitting…" : "Hold ` to talk"}</p>
      )}
      {voice.playbackBlocked && (
        <button type="button" className="btn btn--sm" onClick={() => void client.resumePlayback()}>
          <Volume2 /> Click to hear the channel
        </button>
      )}

      <div className="voicebar__controls">
        <button
          type="button"
          className={`btn btn--icon btn--sm${micOff ? " is-off" : ""}`}
          aria-pressed={voice.muted}
          aria-label={voice.muted ? "Unmute" : "Mute"}
          data-tip={voice.muted ? "Unmute" : "Mute"}
          disabled={voice.micBlock !== null || connecting}
          onClick={() => void client.setMuted(!voice.muted)}
        >
          {micOff ? <MicOff /> : <Mic />}
        </button>
        <button
          type="button"
          className={`btn btn--icon btn--sm${voice.deafened ? " is-off" : ""}`}
          aria-pressed={voice.deafened}
          aria-label={voice.deafened ? "Undeafen" : "Deafen"}
          data-tip={voice.deafened ? "Undeafen" : "Deafen — stop hearing and talking"}
          disabled={connecting}
          onClick={() => void client.setDeafened(!voice.deafened)}
        >
          {voice.deafened ? <HeadphoneOff /> : <Headphones />}
        </button>
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Voice settings"
          aria-expanded={settings}
          data-tip="Voice settings"
          onClick={() => setSettings(!settings)}
        >
          <Settings2 />
        </button>
        <button
          type="button"
          className="btn btn--icon btn--sm btn--danger"
          aria-label="Leave voice"
          data-tip="Leave voice"
          onClick={() => void client.leave()}
        >
          {connecting ? <Loader2 className="spin" /> : <PhoneOff />}
        </button>
      </div>
      {settings && <VoiceSettings onClose={() => setSettings(false)} />}
    </section>
  );
}

function VoiceSettings({ onClose }: { onClose: () => void }) {
  const controller = useCollabController()!;
  const voice = useCollab((s) => s.voice)!;
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const canPickOutput = supportsOutputSelection();

  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([
        listAudioDevices("audioinput"),
        canPickOutput ? listAudioDevices("audiooutput") : Promise.resolve([]),
      ]).then(([i, o]) => {
        if (!live) return;
        setInputs(i);
        setOutputs(o);
      });
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [canPickOutput]);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div className="voicebar__settings" ref={ref} role="group" aria-label="Voice settings">
      <label className="field">
        <span className="field__label">Microphone</span>
        <select
          className="input"
          value={voice.inputDeviceId ?? ""}
          disabled={inputs.length === 0}
          onChange={(e) => void controller.voice.setInputDevice(e.target.value)}
        >
          {voice.inputDeviceId === null && <option value="">System default</option>}
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {canPickOutput ? (
        <label className="field">
          <span className="field__label">Speaker</span>
          <select
            className="input"
            value={voice.outputDeviceId ?? ""}
            disabled={outputs.length === 0}
            onChange={(e) => void controller.voice.setOutputDevice(e.target.value)}
          >
            {voice.outputDeviceId === null && <option value="">System default</option>}
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="dim voicebar__note">This browser plays voice on the system speaker.</p>
      )}
      <fieldset className="field">
        <legend className="field__label">Input mode</legend>
        <div className="segmented">
          <button
            type="button"
            className={voice.mode === "open" ? "is-active" : ""}
            aria-pressed={voice.mode === "open"}
            onClick={() => void controller.voice.setMode("open")}
          >
            Open mic
          </button>
          <button
            type="button"
            className={voice.mode === "push-to-talk" ? "is-active" : ""}
            aria-pressed={voice.mode === "push-to-talk"}
            onClick={() => void controller.voice.setMode("push-to-talk")}
          >
            Push to talk (`)
          </button>
        </div>
      </fieldset>
      <p className="dim voicebar__note">
        Voice is live only — never recorded or transcribed. Everyone in this channel hears you,
        wherever they are in the design.
      </p>
    </div>
  );
}
