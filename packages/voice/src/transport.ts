/**
 * What the voice client needs from an SFU connection. The LiveKit adapter implements it
 * in the browser; tests use a fake. Audio never flows through ForgeLab's own servers,
 * database or storage — the transport talks to the SFU directly with a short-lived token
 * that grants one room.
 */
export interface VoiceParticipant {
  readonly identity: string;
  readonly name: string;
  readonly micEnabled: boolean;
  readonly isLocal: boolean;
}

export type DisconnectCause =
  /** We asked to leave. */
  | "client"
  /** A moderator (or member removal) ended our session: do not rejoin. */
  | "removed"
  | "room-deleted"
  /** The same user joined from another tab. */
  | "duplicate"
  /** Anything else: the connection was lost. */
  | "network";

export type TransportEvent =
  | { readonly type: "participants"; readonly participants: readonly VoiceParticipant[] }
  | { readonly type: "speakers"; readonly identities: readonly string[] }
  | { readonly type: "reconnecting" }
  | { readonly type: "reconnected" }
  | { readonly type: "disconnected"; readonly cause: DisconnectCause }
  | { readonly type: "playback-blocked"; readonly blocked: boolean }
  | { readonly type: "devices-changed" };

export type MicProblem = "denied" | "no-device" | "failed";

export class MicrophoneError extends Error {
  constructor(
    readonly problem: MicProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface ConnectOptions {
  readonly inputDeviceId: string | null;
  readonly outputDeviceId: string | null;
}

export interface VoiceTransport {
  connect(url: string, token: string, options: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  /** Publishes (or mutes) the microphone. Rejects with MicrophoneError. */
  setMicrophone(enabled: boolean): Promise<void>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  /** Deafen: stop receiving and playing everyone else's audio. */
  setRemoteAudio(enabled: boolean): Promise<void>;
  /** Resumes playback that the browser's autoplay policy blocked (needs a user gesture). */
  startAudio(): Promise<void>;
  on(listener: (event: TransportEvent) => void): () => void;
}

export interface AudioDevice {
  readonly deviceId: string;
  readonly label: string;
}
