/** Only same-site paths are followed after sign-in, never absolute or protocol-relative URLs. */
export function safeNext(next: string | null, fallback = "/projects"): string {
  if (next === null || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  if ([...next].some((ch) => ch.charCodeAt(0) < 0x20)) return fallback;
  return next;
}
