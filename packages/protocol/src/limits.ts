/** Limits shared by the database, the server endpoints and the clients. */
export const LIMITS = Object.freeze({
  messageMaxChars: 2000,
  messageRefsMax: 20,
  /** Messages per user per project in the rate window (enforced by trigger). */
  messageRateCount: 8,
  messageRateWindowSec: 10,
  channelNameMaxChars: 40,
  channelsPerProject: 50,
  /** Voice room tokens are only needed to join; LiveKit refreshes them in-session. */
  voiceTokenTtlSec: 300,
  voiceTokenRateCount: 20,
  voiceTokenRateWindowSec: 60,
  /** Presence tickets are renewed before they expire. */
  ticketTtlSec: 600,
  ticketRenewBeforeSec: 120,
  presenceHeartbeatMs: 20_000,
  /**
   * Roster entries not refreshed for this long are dropped, even without a leave event.
   * Longer than a minute because browsers throttle timers in hidden tabs to once a minute.
   */
  presenceExpiryMs: 90_000,
  /**
   * Supabase Realtime closes a client's channel after 5 presence updates in 30 s, so a
   * session sends at most 4 per window and coalesces bursts (mute, join, leave) into one.
   */
  presenceMaxUpdates: 4,
  presenceWindowMs: 30_000,
  presenceCoalesceMs: 300,
  /** Envelopes timestamped further than this from the receiver's clock are rejected. */
  clockSkewMs: 120_000,
  inviteMaxUses: 100,
  inviteMaxHours: 24 * 30,
});
