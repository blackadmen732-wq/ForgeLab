/**
 * `@forgelab/sim-runner` — headless ForgeLab runs.
 *
 * Two consumers share it: the browser's Web Worker (interactive runs) and the server's
 * leaderboard verifier. Like sim-core it has no DOM, no React and no wall clock of its own.
 */
export { canonicalJson, sha256Hex } from "./sha256.js";
export {
  FRAME_FIELDS,
  HISTORY_INTERVAL_SEC,
  SESSION_SPEEDS,
  SimulationSession,
  frameScalar,
  type FrameField,
  type HistoryPoint,
  type SessionCommand,
  type SessionEvent,
  type SessionFrame,
  type SessionSpeed,
} from "./session.js";
export {
  LEADERBOARD_CATEGORIES,
  MAX_VERIFIED_COMPONENTS,
  MAX_VERIFIED_CONNECTIONS,
  STANDARD_SCENARIO,
  VERIFICATION_PROTOCOL_VERSION,
  VerificationError,
  claimMatches,
  designHash,
  runVerification,
  type CategoryScore,
  type LeaderboardCategory,
  type LeaderboardCategoryId,
  type VerificationOptions,
  type VerificationResult,
  type WindowAverages,
} from "./verification.js";
