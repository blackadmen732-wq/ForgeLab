/**
 * `@forgelab/multiplayer` — a member's live connection to a shared project: the verified
 * presence roster and signed collaboration events, over any realtime transport.
 *
 * Depends only on `@forgelab/protocol`. It does not carry audio and does not know voice
 * exists beyond the `voiceChannelId` a member reports in presence; it does not touch the
 * simulation or the database.
 */
export * from "./transport.js";
export * from "./roster.js";
export * from "./session.js";
