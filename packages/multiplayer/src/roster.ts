import {
  LIMITS,
  canonicalJson,
  parsePresenceState,
  verifyEnvelope,
  type PresenceEntry,
  type PresenceState,
  type TicketClaims,
  type VerifiedEnvelope,
} from "@forgelab/protocol";

export const PRESENCE_KIND = "presence";

interface Candidate {
  readonly claims: TicketClaims;
  readonly state: PresenceState;
  readonly seq: number;
  readonly at: number;
  readonly sig: string;
  /** Receiver's clock when this exact envelope was first seen. */
  readonly firstSeen: number;
}

/**
 * The project's online roster, rebuilt from the transport's full presence state.
 *
 * Identity, role and display name come from the server-signed ticket inside each
 * envelope, never from the payload, so a member cannot appear as someone else or claim a
 * higher role. Invalid, expired and foreign-project envelopes are dropped silently.
 * One entry per user: when the same person has several tabs open, the one in voice wins,
 * then the most recent.
 */
export class PresenceRoster {
  private entries = new Map<string, PresenceEntry & { readonly sig: string }>();
  /** Signature → verified envelope and its signed text. Only successes are cached. */
  private readonly verified = new Map<
    string,
    { envelope: VerifiedEnvelope; text: string; firstSeen: number }
  >();
  private readonly keys = new Map<string, { claims: TicketClaims; key: CryptoKey }>();

  constructor(
    private readonly options: {
      readonly serverKey: CryptoKey;
      readonly projectId: string;
      readonly now: () => number;
    },
  ) {}

  list(): readonly PresenceEntry[] {
    return [...this.entries.values()]
      .map(({ sig: _sig, ...entry }) => entry)
      .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  }

  get(userId: string): PresenceEntry | undefined {
    return this.list().find((e) => e.userId === userId);
  }

  /** Replaces the roster with the verified subset of `payloads`. Returns true if it changed. */
  async sync(payloads: readonly unknown[]): Promise<boolean> {
    const now = this.options.now();
    const best = new Map<string, Candidate>();
    for (const payload of payloads) {
      const candidate = await this.check(payload, now);
      if (candidate === null) continue;
      const current = best.get(candidate.claims.sub);
      if (current === undefined || prefer(candidate, current))
        best.set(candidate.claims.sub, candidate);
    }

    const next = new Map<string, PresenceEntry & { readonly sig: string }>();
    for (const [userId, c] of best) {
      // Measured on the receiver's clock from when this envelope first arrived, so a
      // member's clock skew does not matter and re-sending an old envelope does not
      // make it fresh again.
      const seenAt = c.firstSeen;
      if (now - seenAt > LIMITS.presenceExpiryMs) continue;
      next.set(userId, {
        ...c.state,
        userId,
        name: c.claims.name,
        role: c.claims.role,
        seenAt,
        seq: c.seq,
        sig: c.sig,
      });
    }
    const changed = !sameRoster(this.entries, next);
    this.entries = next;
    return changed;
  }

  /** Drops entries that have not been refreshed recently. Returns true if any were dropped. */
  prune(): boolean {
    const now = this.options.now();
    let changed = false;
    for (const [userId, entry] of this.entries) {
      if (now - entry.seenAt > LIMITS.presenceExpiryMs || now > this.ticketExpiry(entry.sig)) {
        this.entries.delete(userId);
        changed = true;
      }
    }
    return changed;
  }

  private ticketExpiry(sig: string): number {
    const verified = this.verified.get(sig);
    return verified ? verified.envelope.claims.exp * 1000 : 0;
  }

  private async check(payload: unknown, now: number): Promise<Candidate | null> {
    if (typeof payload !== "object" || payload === null) return null;
    const { ticket, kind, seq, at, data, sig } = payload as Record<string, unknown>;
    if (typeof sig !== "string") return null;
    let text: string;
    try {
      text = canonicalJson({ ticket, kind, seq, at, data });
    } catch {
      return null;
    }

    // A cache hit must be the identical signed body, so a forged payload that merely
    // reuses a valid signature can never borrow its verification.
    let verified = this.verified.get(sig)?.text === text ? this.verified.get(sig)!.envelope : null;
    if (verified === null) {
      if (this.verified.size > 500) this.verified.clear();
      if (this.keys.size > 200) this.keys.clear();
      verified = await verifyEnvelope(payload, {
        serverKey: this.options.serverKey,
        projectId: this.options.projectId,
        nowMs: now,
        keys: this.keys,
      });
      if (verified === null) return null;
      this.verified.set(sig, { envelope: verified, text, firstSeen: now });
    }
    if (verified.kind !== PRESENCE_KIND) return null;
    // A cached verification still has to be current: tickets expire, and an old signed
    // state replayed by someone else must stop counting.
    if (verified.claims.exp * 1000 < now) return null;
    if (Math.abs(now - verified.at) > LIMITS.clockSkewMs + LIMITS.presenceExpiryMs) return null;

    const state = parsePresenceState(verified.data);
    if (state === null) return null;
    const firstSeen = this.verified.get(sig)?.firstSeen ?? now;
    return { claims: verified.claims, state, seq: verified.seq, at: verified.at, sig, firstSeen };
  }
}

function prefer(a: Candidate, b: Candidate): boolean {
  const aVoice = a.state.voiceChannelId !== null;
  const bVoice = b.state.voiceChannelId !== null;
  if (aVoice !== bVoice) return aVoice;
  if (a.at !== b.at) return a.at > b.at;
  return a.seq > b.seq;
}

const VISIBLE = [
  "name",
  "role",
  "voiceChannelId",
  "mic",
  "deafened",
  "activity",
  "workspaceId",
  "focus",
] as const;

/** Heartbeats refresh signatures without changing anything anyone can see. */
function sameRoster(
  a: ReadonlyMap<string, PresenceEntry>,
  b: ReadonlyMap<string, PresenceEntry>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, entry] of a) {
    const other = b.get(id);
    if (other === undefined || VISIBLE.some((k) => other[k] !== entry[k])) return false;
  }
  return true;
}
