import { base64url, fromBase64url, isUuid } from "./ids.js";
import { LIMITS } from "./limits.js";
import { isProjectRole, type ProjectRole } from "./roles.js";

/**
 * Signed presence and collaboration envelopes.
 *
 * Realtime presence on its own proves only that the sender could join the channel (RLS
 * checks project membership); it does not stop one member from publishing a state that
 * claims to be another. ForgeLab closes that gap with two signatures, both ECDSA P-256
 * over SHA-256 via WebCrypto (identical in browsers and Node):
 *
 *   1. The server issues a *ticket* binding { user id, project, role, display name,
 *      session public key, expiry } with the server's presence key.
 *   2. The client signs every envelope with the session private key it generated
 *      (non-extractable) and attaches the ticket.
 *
 * A receiver accepts an envelope only if the ticket verifies with the server's public key,
 * belongs to this project and has not expired, and the envelope verifies with the session
 * key the ticket certifies. Copying another member's ticket is useless without their
 * private key.
 */
export interface PublicJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface TicketClaims {
  readonly v: 1;
  readonly sub: string;
  readonly pid: string;
  readonly role: ProjectRole;
  readonly name: string;
  readonly key: PublicJwk;
  readonly iat: number;
  readonly exp: number;
}

export interface Envelope {
  readonly ticket: string;
  readonly kind: string;
  readonly seq: number;
  readonly at: number;
  readonly data: unknown;
  readonly sig: string;
}

export interface VerifiedEnvelope {
  readonly claims: TicketClaims;
  readonly kind: string;
  readonly seq: number;
  readonly at: number;
  readonly data: unknown;
}

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Deterministic JSON: object keys sorted, no whitespace. Rejects non-finite numbers. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}

function isPublicJwk(value: unknown): value is PublicJwk {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r["kty"] === "EC" &&
    r["crv"] === "P-256" &&
    typeof r["x"] === "string" &&
    typeof r["y"] === "string" &&
    r["d"] === undefined
  );
}

export function toPublicJwk(jwk: JsonWebKey): PublicJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y)
    throw new Error("Not a P-256 public key.");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function importPublicKey(jwk: PublicJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", { ...jwk, ext: true }, ALG, true, ["verify"]);
}

/** A per-session key pair; the private half cannot be exported from this tab. */
export async function generateSessionKeys(): Promise<{
  privateKey: CryptoKey;
  publicJwk: PublicJwk;
}> {
  const pair = (await crypto.subtle.generateKey(ALG, false, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicJwk: toPublicJwk(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  };
}

/** Server: loads the presence signing key from PKCS#8 PEM and derives its public JWK. */
export async function importServerKey(
  pem: string,
): Promise<{ privateKey: CryptoKey; publicJwk: PublicJwk }> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (body === "") throw new Error("Presence signing key is empty.");
  const der = fromBase64url(body.replace(/\+/g, "-").replace(/\//g, "_"));
  const extractable = await crypto.subtle.importKey("pkcs8", der, ALG, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", extractable);
  const privateKey = await crypto.subtle.importKey("pkcs8", der, ALG, false, ["sign"]);
  return { privateKey, publicJwk: toPublicJwk(jwk) };
}

async function sign(key: CryptoKey, text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign(SIGN, key, encoder.encode(text))));
}

async function verify(key: CryptoKey, sig: string, text: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify(SIGN, key, fromBase64url(sig), encoder.encode(text));
  } catch {
    return false;
  }
}

/* ---------------- tickets (server) ---------------- */

export async function signTicket(claims: TicketClaims, serverKey: CryptoKey): Promise<string> {
  const payload = base64url(encoder.encode(canonicalJson(claims)));
  return `${payload}.${await sign(serverKey, payload)}`;
}

function parseClaims(payload: string): TicketClaims | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(fromBase64url(payload)));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c["v"] !== 1 || !isUuid(c["sub"]) || !isUuid(c["pid"]) || !isProjectRole(c["role"]))
    return null;
  if (typeof c["name"] !== "string" || c["name"].length > 80 || !isPublicJwk(c["key"])) return null;
  if (!Number.isInteger(c["iat"]) || !Number.isInteger(c["exp"])) return null;
  return c as unknown as TicketClaims;
}

export async function verifyTicket(
  ticket: string,
  serverKey: CryptoKey,
  options: { projectId: string; nowMs: number },
): Promise<TicketClaims | null> {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const [payload, sig, extra] = ticket.split(".");
  if (payload === undefined || sig === undefined || extra !== undefined) return null;
  if (!(await verify(serverKey, sig, payload))) return null;
  const claims = parseClaims(payload);
  if (claims === null) return null;
  if (claims.pid !== options.projectId.toLowerCase()) return null;
  if (claims.exp * 1000 < options.nowMs) return null;
  return claims;
}

/** Reads a ticket's claims without verifying it (the client inspecting its own ticket). */
export function peekTicket(ticket: string): TicketClaims | null {
  const payload = ticket.split(".")[0];
  return payload === undefined ? null : parseClaims(payload);
}

/* ---------------- envelopes (clients) ---------------- */

export async function signEnvelope(
  input: { ticket: string; kind: string; seq: number; at: number; data: unknown },
  sessionKey: CryptoKey,
): Promise<Envelope> {
  const body = {
    ticket: input.ticket,
    kind: input.kind,
    seq: input.seq,
    at: input.at,
    data: input.data,
  };
  return { ...body, sig: await sign(sessionKey, canonicalJson(body)) };
}

/**
 * Verifies an untrusted envelope. `keys` caches ticket → session key so a stream of
 * presence updates costs one signature check each, not two.
 */
export async function verifyEnvelope(
  input: unknown,
  options: {
    serverKey: CryptoKey;
    projectId: string;
    nowMs: number;
    keys?: Map<string, { claims: TicketClaims; key: CryptoKey }>;
  },
): Promise<VerifiedEnvelope | null> {
  if (typeof input !== "object" || input === null) return null;
  const e = input as Record<string, unknown>;
  const { ticket, kind, seq, at, data, sig } = e;
  if (
    typeof ticket !== "string" ||
    typeof kind !== "string" ||
    kind.length > 40 ||
    typeof sig !== "string"
  )
    return null;
  if (!Number.isInteger(seq) || (seq as number) < 0 || !Number.isFinite(at)) return null;
  if (Math.abs((at as number) - options.nowMs) > LIMITS.clockSkewMs) return null;

  let entry = options.keys?.get(ticket);
  if (entry === undefined || entry.claims.exp * 1000 < options.nowMs) {
    const claims = await verifyTicket(ticket, options.serverKey, options);
    if (claims === null) return null;
    entry = { claims, key: await importPublicKey(claims.key) };
    options.keys?.set(ticket, entry);
  }
  let text: string;
  try {
    text = canonicalJson({ ticket, kind, seq, at, data });
  } catch {
    return null;
  }
  if (!(await verify(entry.key, sig, text))) return null;
  return { claims: entry.claims, kind, seq: seq as number, at: at as number, data };
}
