import { createHmac, randomUUID } from "node:crypto";

/**
 * LiveKit access tokens are HS256 JWTs signed with the API secret. Minting them needs
 * nothing but HMAC, so the server does not take a dependency for it. Grants follow
 * https://docs.livekit.io/home/get-started/authentication/.
 */
export interface VoiceGrant {
  readonly room: string;
  readonly roomJoin?: boolean;
  readonly canPublish?: boolean;
  readonly canSubscribe?: boolean;
  readonly canPublishData?: boolean;
  readonly canPublishSources?: readonly string[];
  readonly canUpdateOwnMetadata?: boolean;
  readonly roomAdmin?: boolean;
}

export interface AccessTokenInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly identity: string;
  readonly name?: string;
  readonly metadata?: string;
  readonly ttlSec: number;
  readonly grant: VoiceGrant;
  readonly nowSec: number;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function mintAccessToken(input: AccessTokenInput): string {
  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    iss: input.apiKey,
    sub: input.identity,
    jti: randomUUID(),
    nbf: input.nowSec - 5,
    exp: input.nowSec + input.ttlSec,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    video: input.grant,
  };
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signature = createHmac("sha256", input.apiSecret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Removes a participant from a room through LiveKit's Twirp RoomService. Used when a
 * member is removed from a project: they can no longer get a token, and this ends the
 * session they already have. A participant who is not in the room is not an error.
 */
export async function removeParticipant(
  env: { adminUrl: string; apiKey: string; apiSecret: string },
  room: string,
  identity: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"removed" | "absent"> {
  const token = mintAccessToken({
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
    identity: "forgelab-server",
    ttlSec: 60,
    grant: { room, roomAdmin: true },
    nowSec: Math.floor(Date.now() / 1000),
  });
  const response = await fetchImpl(
    `${env.adminUrl.replace(/\/$/, "")}/twirp/livekit.RoomService/RemoveParticipant`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ room, identity }),
    },
  );
  if (response.ok) return "removed";
  if (response.status === 404) return "absent";
  const text = await response.text().catch(() => "");
  if (/not[_ ]found|does not exist/i.test(text)) return "absent";
  throw new Error(`LiveKit RemoveParticipant failed (${response.status}).`);
}
