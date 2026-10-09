import { LIMITS } from "./limits.js";

/**
 * Chat messages are plain text plus a list of references into the ForgeLab workspace.
 * V1 renders text only (never HTML). `refs` lets "Look at @magnet-34" become a link that
 * focuses the component, without a schema change when richer references arrive.
 */
export const REF_KINDS = Object.freeze([
  "component",
  "run",
  "failure",
  "workspace",
  "version",
] as const);
export type RefKind = (typeof REF_KINDS)[number];

export interface MessageRef {
  readonly kind: RefKind;
  readonly id: string;
  /** Character offsets of the reference in `content`. */
  readonly start: number;
  readonly end: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly projectId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly content: string;
  readonly refs: readonly MessageRef[];
  readonly createdAt: string;
}

/**
 * Normalises user input: trims, drops control characters except newline and tab, and
 * collapses runs of blank lines. Returns null when nothing sendable remains or the text is
 * too long (the database enforces the same rules).
 */
export function normaliseMessage(input: string): string | null {
  const cleaned = [...input]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0 || cleaned.length > LIMITS.messageMaxChars) return null;
  return cleaned;
}

const MENTION = /(^|[\s(])@([a-z0-9][a-z0-9-]{0,63})/gi;

/**
 * Finds `@id` mentions that name known workspace objects. Unknown handles stay plain text.
 */
export function findRefs(content: string, known: (id: string) => RefKind | null): MessageRef[] {
  const refs: MessageRef[] = [];
  for (const match of content.matchAll(MENTION)) {
    const id = match[2]!;
    const kind = known(id);
    if (kind === null) continue;
    const start = (match.index ?? 0) + match[1]!.length;
    refs.push({ kind, id, start, end: start + id.length + 1 });
    if (refs.length >= LIMITS.messageRefsMax) break;
  }
  return refs;
}

/** Validates stored or received refs against the content they index. */
export function parseRefs(input: unknown, content: string): MessageRef[] {
  if (!Array.isArray(input)) return [];
  const out: MessageRef[] = [];
  for (const r of input.slice(0, LIMITS.messageRefsMax)) {
    if (typeof r !== "object" || r === null) continue;
    const { kind, id, start, end } = r as Record<string, unknown>;
    if (typeof kind !== "string" || !(REF_KINDS as readonly string[]).includes(kind)) continue;
    if (typeof id !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(id)) continue;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const s = start as number;
    const e = end as number;
    if (s < 0 || e <= s || e > content.length) continue;
    out.push({ kind: kind as RefKind, id, start: s, end: e });
  }
  return out
    .sort((a, b) => a.start - b.start)
    .filter((r, i, all) => i === 0 || r.start >= all[i - 1]!.end);
}

/** Splits content into text and reference segments for rendering. */
export function segments(
  content: string,
  refs: readonly MessageRef[],
): ({ text: string } | { text: string; ref: MessageRef })[] {
  const out: ({ text: string } | { text: string; ref: MessageRef })[] = [];
  let at = 0;
  for (const ref of refs) {
    if (ref.start < at) continue;
    if (ref.start > at) out.push({ text: content.slice(at, ref.start) });
    out.push({ text: content.slice(ref.start, ref.end), ref });
    at = ref.end;
  }
  if (at < content.length) out.push({ text: content.slice(at) });
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a stored message row (from a query, or from the realtime delivery the
 * database sends on insert). Rows are untrusted input to the renderer like anything else.
 */
export function parseChatRow(input: unknown): ChatMessage | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  const { id, project_id, channel_id, user_id, content, refs, created_at } = r;
  if (![id, project_id, channel_id, user_id].every((v) => typeof v === "string" && UUID_RE.test(v)))
    return null;
  if (
    typeof content !== "string" ||
    content.length === 0 ||
    content.length > LIMITS.messageMaxChars
  )
    return null;
  if (typeof created_at !== "string" || Number.isNaN(Date.parse(created_at))) return null;
  return {
    id: id as string,
    projectId: project_id as string,
    channelId: channel_id as string,
    userId: user_id as string,
    content,
    refs: parseRefs(refs, content),
    createdAt: created_at,
  };
}
