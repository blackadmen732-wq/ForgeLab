import { safeStorage } from "../lib/storage.js";
import { NO_BESTS, type Bests } from "./runReport.js";

/**
 * Personal bests per design, kept in this browser. A convenience for the player, not a
 * record: verified results are the server-recomputed leaderboard scores.
 */
const KEY = "forgelab.bests.v1";
const MAX_DESIGNS = 200;

type Store = Record<string, Bests & { readonly at: number }>;

function read(): Store {
  const raw = safeStorage.getJson<unknown>(KEY, {});
  return typeof raw === "object" && raw !== null ? (raw as Store) : {};
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function getBests(designKey: string): Bests {
  const entry = read()[designKey];
  if (entry === undefined) return NO_BESTS;
  return {
    peakFusionW: num(entry.peakFusionW, 0),
    peakGainQ: num(entry.peakGainQ, 0),
    longestBurnSec: num(entry.longestBurnSec, 0),
    bestMeanNetW: typeof entry.bestMeanNetW === "number" ? entry.bestMeanNetW : null,
  };
}

export function saveBests(designKey: string, bests: Bests): void {
  const store = read();
  store[designKey] = { ...bests, at: Date.now() };
  const keys = Object.keys(store);
  if (keys.length > MAX_DESIGNS) {
    keys
      .sort((a, b) => (store[a]!.at ?? 0) - (store[b]!.at ?? 0))
      .slice(0, keys.length - MAX_DESIGNS)
      .forEach((k) => delete store[k]);
  }
  safeStorage.setJson(KEY, store);
}
