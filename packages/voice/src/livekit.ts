import type * as LiveKitModule from "livekit-client";
import type { RemoteTrackPublication, Room } from "livekit-client";
import {
  MicrophoneError,
  type AudioDevice,
  type ConnectOptions,
  type DisconnectCause,
  type TransportEvent,
  type VoiceTransport,
} from "./transport.js";

type LiveKit = typeof LiveKitModule;

/**
 * Loads the LiveKit client (a large module) only when someone joins voice, and adapts a
 * LiveKit room to ForgeLab's VoiceTransport. Audio only: no camera, no screen share, no
 * data channel — the server's token forbids them anyway.
 */
export async function createLiveKitTransport(
  options: { debug?: boolean } = {},
): Promise<VoiceTransport> {
  const lk = await import("livekit-client");
  // LiveKit logs routine events (such as its data channels closing when we leave) as
  // console errors. Failures that matter reach the user through VoiceClient's state, so
  // its own logging is off unless asked for.
  lk.setLogLevel(options.debug === true ? "debug" : "silent");
  return new LiveKitTransport(lk);
}

/** Microphones and speakers the browser reports. Labels are empty until mic permission. */
export async function listAudioDevices(kind: "audioinput" | "audiooutput"): Promise<AudioDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === kind && d.deviceId !== "")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || (kind === "audioinput" ? `Microphone ${i + 1}` : `Speaker ${i + 1}`),
    }));
}

/** Choosing a speaker needs HTMLMediaElement.setSinkId (not available in every browser). */
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** WebRTC and microphone capture are available at all. */
export function voiceSupported(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

class LiveKitTransport implements VoiceTransport {
  private room: Room | null = null;
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private readonly elements = new Set<HTMLMediaElement>();
  private remoteAudio = true;
  private leaving = false;

  constructor(private readonly lk: LiveKit) {}

  on(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(url: string, token: string, options: ConnectOptions): Promise<void> {
    const { Room, RoomEvent, Track } = this.lk;
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(options.inputDeviceId === null ? {} : { deviceId: options.inputDeviceId }),
      },
      ...(options.outputDeviceId === null
        ? {}
        : { audioOutput: { deviceId: options.outputDeviceId } }),
    });
    this.room = room;

    const participants = () => this.emitParticipants();
    room
      .on(RoomEvent.TrackSubscribed, (track, publication) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.dataset["forgelabVoice"] = "";
        element.muted = !this.remoteAudio;
        document.body.appendChild(element);
        this.elements.add(element);
        if (!this.remoteAudio) publication.setEnabled(false);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const element of track.detach()) {
          element.remove();
          this.elements.delete(element);
        }
      })
      .on(RoomEvent.ParticipantConnected, participants)
      .on(RoomEvent.ParticipantDisconnected, participants)
      .on(RoomEvent.ParticipantNameChanged, participants)
      .on(RoomEvent.TrackMuted, participants)
      .on(RoomEvent.TrackUnmuted, participants)
      .on(RoomEvent.TrackPublished, participants)
      .on(RoomEvent.TrackUnpublished, participants)
      .on(RoomEvent.LocalTrackPublished, participants)
      .on(RoomEvent.LocalTrackUnpublished, participants)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) =>
        this.emit({ type: "speakers", identities: speakers.map((s) => s.identity) }),
      )
      .on(RoomEvent.Reconnecting, () => this.emit({ type: "reconnecting" }))
      .on(RoomEvent.Reconnected, () => this.emit({ type: "reconnected" }))
      .on(RoomEvent.AudioPlaybackStatusChanged, () =>
        this.emit({ type: "playback-blocked", blocked: !room.canPlaybackAudio }),
      )
      .on(RoomEvent.MediaDevicesChanged, () => this.emit({ type: "devices-changed" }))
      .on(RoomEvent.Disconnected, (reason) => {
        this.cleanupElements();
        this.emit({ type: "disconnected", cause: this.leaving ? "client" : this.cause(reason) });
      });

    await room.connect(url, token, { autoSubscribe: true });
    this.emitParticipants();
  }

  async disconnect(): Promise<void> {
    this.leaving = true;
    const room = this.room;
    this.room = null;
    this.cleanupElements();
    if (room !== null) await room.disconnect(true);
  }

  async setMicrophone(enabled: boolean): Promise<void> {
    const room = this.requireRoom();
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError")
        throw new MicrophoneError("denied", "Microphone access was blocked.");
      if (
        name === "NotFoundError" ||
        name === "OverconstrainedError" ||
        name === "NotReadableError"
      )
        throw new MicrophoneError("no-device", "No usable microphone was found.");
      throw new MicrophoneError(
        "failed",
        error instanceof Error ? error.message : "Microphone failed.",
      );
    }
    this.emitParticipants();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice("audioinput", deviceId);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    if (!supportsOutputSelection()) return;
    await this.room?.switchActiveDevice("audiooutput", deviceId);
  }

  async setRemoteAudio(enabled: boolean): Promise<void> {
    this.remoteAudio = enabled;
    for (const element of this.elements) element.muted = !enabled;
    // Also stop the SFU from sending audio we are not going to play.
    const room = this.room;
    if (room === null) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        (publication as RemoteTrackPublication).setEnabled(enabled);
      }
    }
  }

  async startAudio(): Promise<void> {
    await this.room?.startAudio();
  }

  /* ------------------------------------------------------------------------------ */

  private requireRoom(): Room {
    if (this.room === null) throw new MicrophoneError("failed", "Not connected to voice.");
    return this.room;
  }

  private emit(event: TransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitParticipants(): void {
    const room = this.room;
    if (room === null) return;
    const all = [room.localParticipant, ...room.remoteParticipants.values()];
    this.emit({
      type: "participants",
      participants: all.map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        micEnabled: p.isMicrophoneEnabled,
        isLocal: p === room.localParticipant,
      })),
    });
  }

  private cleanupElements(): void {
    for (const element of this.elements) element.remove();
    this.elements.clear();
  }

  private cause(reason: number | undefined): DisconnectCause {
    const { DisconnectReason } = this.lk;
    switch (reason) {
      case DisconnectReason.CLIENT_INITIATED:
        return "client";
      case DisconnectReason.PARTICIPANT_REMOVED:
        return "removed";
      case DisconnectReason.ROOM_DELETED:
        return "room-deleted";
      case DisconnectReason.DUPLICATE_IDENTITY:
        return "duplicate";
      default:
        return "network";
    }
  }
}
