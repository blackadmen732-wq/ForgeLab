/**
 * `@forgelab/voice` — channel-based voice. Who hears whom is decided only by which voice
 * channel people have joined; position in the sandbox has no effect.
 *
 * Depends on no other ForgeLab package. The LiveKit adapter is imported dynamically, so
 * the SFU client is downloaded only when someone joins a voice channel.
 */
export * from "./transport.js";
export * from "./client.js";
export {
  createLiveKitTransport,
  listAudioDevices,
  supportsOutputSelection,
  voiceSupported,
} from "./livekit.js";
