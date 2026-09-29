# ForgeLab communications: channels, voice, chat, presence

ForgeLab voice is **channel-based communication**, like voice channels in a chat app,
built into a collaborative reactor sandbox. **Position in the 3D sandbox has no effect on
who hears whom.** You hear exactly the people connected to the same voice channel.

## 1. What existed before this work

| Area        | State (V0.1)                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Auth        | Supabase Auth (email/password, OAuth-ready), PKCE, `AuthProvider` in `apps/web/src/lib/auth.tsx`               |
| Database    | Supabase Postgres; single-owner `projects`, append-only `project_versions`, RLS + column grants                |
| Server      | One Vercel Node function (`/api/verify`) built with esbuild into `.vercel/output`                              |
| Realtime    | **None.** `@supabase/realtime-js` 2.117 was installed (transitively) but unused; Realtime was disabled locally |
| Multiplayer | **None.** Projects had exactly one editor (the owner); others could view and fork                              |
| Voice       | **None.** No WebRTC or SFU library installed                                                                   |
| Packages    | `shared`, `materials`, `sim-core`, `sim-runner`, `reactor-components`, `test-utils`                            |

Reusable: Supabase Auth for identity, Postgres + RLS for durable authorization, the
function build pipeline for server endpoints, the editor store's camera requests for
"show me this" events, and `@supabase/realtime-js` (private channels authorized by RLS,
presence, broadcast) for ephemeral state.

Missing: project membership and roles, channels, messages, invites, audit trail, a
central permission model, realtime presence, a voice transport, and a way to stop two
members' saves overwriting each other.

## 2. Layers and why they are separate

```
CLIENT (apps/web)
  builder / multiplayer engine ── design saves, conflict handling, revision notices
  voice client                 ── @forgelab/voice → livekit-client (WebRTC)
  text chat                    ── Postgres rows, delivered by Realtime broadcast
  presence                     ── @forgelab/multiplayer over Supabase Realtime presence

BACKEND
  Supabase Auth                ── identity (JWT)
  Postgres + RLS               ── projects, members, roles, channels, messages, invites, audit
  /api/comms/ticket            ── signs a short-lived presence certificate
  /api/voice/token             ── authorizes a channel and mints a short-lived room token
  /api/comms/remove-member     ── removes a member and evicts them from voice
  Supabase Realtime            ── ephemeral presence + chat delivery (private, RLS-authorized)
  LiveKit SFU                  ── audio only
```

| Layer               | Owns                                          | Must never                                   |
| ------------------- | --------------------------------------------- | -------------------------------------------- |
| Postgres            | who may do what; messages; channels; audit    | carry audio or high-frequency state          |
| Realtime (presence) | online / channel / mic / activity / workspace | be trusted without a signature; be persisted |
| Voice (SFU)         | audio, speaking, mute of live tracks          | touch reactor state or the database          |
| Multiplayer engine  | design revisions, collaboration events        | depend on voice                              |

Failures stay inside their layer: if LiveKit is down, chat, presence, editing and
simulation keep working; if Realtime drops, saves and chat history are unaffected and
presence rebuilds on reconnect.

## 3. Packages

| Package                 | Contents                                                                                                                                                                                                          | Depends on            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `@forgelab/protocol`    | roles and the permission matrix; id/topic/room helpers; presence and event schemas with validators; message model with object references; signed envelopes (WebCrypto ECDSA P-256, identical in browser and Node) | nothing               |
| `@forgelab/multiplayer` | `ProjectSession` (signed presence, ticket renewal, rate budget, signed collaboration events), `PresenceRoster` (verify, dedupe, expire), `RealtimeTransport` interface, in-memory transport for tests             | `protocol`            |
| `@forgelab/voice`       | `VoiceClient` state machine (join/leave, mute, deafen, push-to-talk, devices, speaking, listen-only, rejoin), `VoiceTransport` interface, LiveKit adapter (loaded on demand)                                      | `livekit-client` only |

`apps/web/src/collab` holds the Supabase Realtime adapter, the `CollabController` that
ties the layers together for one open project, and the UI (team panel, voice panel,
manage dialog, shared-save banners); `apps/web/src/lib/collab.ts` is the data access.
`api-src` holds the server endpoints. `packages/protocol/src/boundaries.test.ts` enforces
the dependency rules: protocol depends on nothing, multiplayer and voice never import each
other, and no simulation package imports any of them.

`livekit-client` 2.22.3 is the only dependency this work added. It is a separate
~145 kB (gzip) chunk that downloads the first time someone joins voice.

## 4. Data model (migration `20260930000100_collaboration.sql`)

- `project_members (project_id, user_id, role, joined_at, invited_by)` — role is
  `owner | admin | member | viewer`. The owner row is created by trigger and cannot be
  removed or demoted except by transferring ownership (later).
- `project_invites (id, project_id, code_hash, role, created_by, expires_at, max_uses, uses)`
  — the invite code is shown once; only its SHA-256 is stored.
- `channels (id, project_id, name, position, is_private, settings, created_by, created_at)`
  — every channel has both voice and text. A `General` channel is created with the project.
- `channel_members (channel_id, user_id)` — access list for private channels.
- `messages (id, project_id, channel_id, user_id, content, refs, created_at, edited_at, deleted_at)`
  — `content` is plain text (≤ 2000 chars, no control characters); `refs` is a JSON array
  of object references (`{ kind: "component" | "run" | "failure" | "workspace" | "version", id, start, end }`)
  so `@magnet-34` can become a focus link without a schema change.
- `audit_events (id, project_id, actor_id, action, target_user_id, details, created_at)` —
  written by triggers for membership, role, invite and channel changes; readable by
  owners and admins.
- `rate_events (user_id, bucket, created_at)` — server-side rate limiting for the
  comms endpoints (service role only).

`project_id` on `messages` is denormalised from the channel and checked by trigger, so
every policy is a cheap membership lookup.

## 5. Authorization

One permission model, defined twice and tested to agree:

- **SQL** `public.channel_permissions(channel uuid) → text[]` and
  `public.project_role(project uuid) → role`, used by every RLS policy, RPC, Realtime
  policy and the API.
- **TypeScript** `@forgelab/protocol` `permissionsFor(role, channel)`, used by the UI
  only to decide what to _show_. A test compares both matrices.

| Permission           | owner |         admin         | member |     viewer      |
| -------------------- | :---: | :-------------------: | :----: | :-------------: |
| `can_view`           |   ✓   |           ✓           |   ✓    |        ✓        |
| `can_join_voice`     |   ✓   |           ✓           |   ✓    | ✓ (listen-only) |
| `can_speak`          |   ✓   |           ✓           |   ✓    |                 |
| `can_send_messages`  |   ✓   |           ✓           |   ✓    |                 |
| `can_edit_design`    |   ✓   |           ✓           |   ✓    |                 |
| `can_manage_channel` |   ✓   |           ✓           |        |                 |
| `can_invite`         |   ✓   |           ✓           |        |                 |
| `can_mute_others`    |   ✓   |           ✓           |        |                 |
| `can_remove_member`  |   ✓   | ✓ (not owners/admins) |        |                 |

Private channels additionally require a `channel_members` row, except for owners and
admins.

## 6. Voice

```
Microphone → browser processing (echo cancellation, noise suppression, AGC)
  → mute / push-to-talk gate → WebRTC → LiveKit SFU room → subscribers in that room only
```

1. The user clicks **Join** on a channel.
2. `POST /api/voice/token { channelId }` with the user's Supabase JWT.
3. The server validates the JWT with Supabase Auth, rate-limits, and asks Postgres —
   as that user — for `channel_permissions(channelId)`. The browser's user id is never
   read; identity comes from the verified token.
4. Without `can_join_voice`: 403. Otherwise the server signs a LiveKit access token
   (HS256, **5-minute** lifetime) for exactly one room, with `canPublish` only if the
   user has `can_speak`, `canPublishData: false`, and the Supabase user id as identity.
5. The room name is opaque: `fl_` + HMAC-SHA256(server secret, channel id). Knowing a
   room name grants nothing; the token's room grant is the gate, and it cannot be
   widened by the client.
6. The client connects over WebRTC. Speaking, mute and connection state come from
   LiveKit events and are never written to Postgres.
7. Leaving, closing the tab or losing the network ends the WebRTC session; LiveKit drops
   the participant after its ICE timeout.

Removing a member deletes their row (so no new token can be issued) and the
`/api/comms/remove-member` endpoint evicts them from every voice room of the project.

Deleting a channel prevents new tokens for its room; people already in it stay connected
until they leave (moderation-grade eviction is later work).

**The microphone is never opened while muted.** It is acquired the first time it should
go live; after that, muting silences the published track, so push-to-talk responds
instantly.

**Listen-only.** If microphone permission is denied or no input device exists, the user
stays connected to listen and the panel says why. Viewers are listen-only by role.

**Push-to-talk** gates the published track (hold `` ` ``, the key below Escape; ignored
while typing). **Deafen** stops playback of all remote audio, asks the SFU to stop
sending it, and mutes the microphone; unmuting also undeafens.

**Reconnects.** LiveKit resumes brief network drops itself. If the session is lost, the
client asks for a _fresh_ token (so the server re-checks access) and rejoins, with
backoff; it does not rejoin after being removed, after the room is closed, or after the
same user joins voice from another tab.

**The voice panel** (top-left of the workspace while connected) shows the channel,
"N connected", each participant with a speaking ring and muted badge, and Mute, Deafen,
settings (microphone, speaker where `setSinkId` is supported, open mic or push-to-talk)
and Leave. If the browser blocks audio autoplay it offers a one-click "hear the channel".

## 7. Presence

Presence is ephemeral and lives in a Supabase Realtime **private** channel per project
(`project:<id>`). Joining requires the Realtime RLS policy: the user must be a project
member. Realtime presence alone cannot stop a member from claiming to be someone else,
so presence is signed:

1. On opening a project, the client generates a non-extractable ECDSA P-256 key pair.
2. `POST /api/comms/ticket { projectId, publicKey }`: the server checks membership and
   returns a **ticket** — `{ sub: userId, pid, role, name, key, exp (10 min) }` signed
   with the server's presence key — plus the server's public key.
3. Every presence state and collaboration event the client publishes is signed with its
   session key and carries the ticket.
4. Receivers verify the ticket (server signature, project, expiry) and the payload
   (session-key signature, monotonic sequence). Anything that fails is dropped.
   Copying someone's ticket is useless without their session private key.

The roster is keyed by verified user id, so reconnects and multiple tabs collapse into
one entry (the tab in voice wins, then the newest state), and entries that stop
refreshing expire after 90 s even if Realtime never delivers a leave (long enough for
browsers' once-a-minute timer throttling in background tabs). Tickets are renewed before
expiry; if the server refuses a renewal the session ends.

**Rate budget.** Supabase Realtime closes a client's channel after 5 presence updates in
30 s. The session therefore heartbeats every 20 s, sends at most 4 presence updates per
30 s window, and coalesces bursts (300 ms). So that mute, deafen and channel changes
still show up immediately, each change is _also_ sent as a signed broadcast. A broadcast
only refreshes the state of someone the presence set already lists; it can never make
anyone appear online. Members who arrive later see the latest state once the next
presence update goes out (within 30 s). If the server closes the channel anyway, the
adapter resubscribes with backoff.

The member list is re-read when a verified stranger appears in presence (someone just
accepted an invite) and when an owner or admin broadcasts a signed `team.changed`
after changing roles, members or channels. Role changes apply to an open project
immediately: a demoted member's editor becomes read-only, and a removed member loses the
team panel and voice.

```
{ userId, projectId, name, role, voiceChannelId, mic: "muted" | "unmuted" | "unavailable",
  deafened, activity: "building" | "simulating" | "observing", workspaceId, focus, seq, at }
```

Voice membership shown _inside_ a connected room comes from LiveKit (authoritative,
token identities). The channel list shows who is in _other_ voice channels from signed
presence.

## 8. Text chat

Messages are inserted directly with the user's JWT; RLS requires `can_send_messages` on
the channel, a trigger enforces 8 messages / 10 s per user per project, length and
character rules, and sets `user_id = auth.uid()` (the client cannot set it). An
`AFTER INSERT` trigger publishes the new row with `realtime.send` to the private topic
`chat:<channel id>`, whose Realtime policy requires `can_view`. The client subscribes
before loading the last 50 messages, de-duplicates by id, and validates every row
(`parseChatRow`) before rendering. Content is rendered as React text nodes, never as
HTML.

**Object references.** When a message is sent, `@id` handles that name a component in
the sender's current design are stored in `refs`; readers see them as links that select
the component and fly the camera to it. The other reference kinds (`run`, `failure`,
`workspace`, `version`) are in the schema but not produced yet.

## 9. Shared project integration (multiplayer engine V1)

- Members with `can_edit_design` open the shared project read-write; viewers read-only.
  Publishing and score submission stay with the owner, and the project row's name and
  listing stats are maintained by the owner's saves; teammates' saves are versions.
- **No silent overwrites.** Every save names the version it was based on
  (`parent_version_id`); the database rejects a save whose parent is no longer the latest
  (`P0001: stale_version`). Autosave pauses and the editor offers **Load theirs**
  (discard local changes, after confirmation) or **Keep mine** (save on top of theirs —
  their version stays in the history). Nothing is lost either way.
- After a save, the client broadcasts a signed `design.revision` event; collaborators
  see "Andre saved version 12 — Load it". Loading is always the reader's choice.
- **Share View** (`view.share`, the sender's camera pose and focused components) is
  specified, signed and permission-checked in the protocol, but has no UI yet.

Real-time, component-level co-editing (`component_updated { project_id, component_id,
user_id, operation, revision, timestamp }`) is specified in `@forgelab/protocol` but not
implemented: it needs operation transforms or per-component locks, and is the next
multiplayer milestone.

## 10. Privacy

V1 voice is live only: no recording, no transcription, nothing stored server-side. The
SFU forwards packets; LiveKit is configured without egress. Adding either requires an
explicit product and privacy design, visible consent and a separate storage policy.

## 11. Configuration

| Variable                   | Where  | Purpose                                                                                                           |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `VITE_LIVEKIT_URL`         | build  | `wss://…` of the LiveKit deployment; added to the CSP `connect-src` (clients get the URL from the token response) |
| `LIVEKIT_URL`              | server | `https://…` for room administration (evictions); defaults to `VITE_LIVEKIT_URL`                                   |
| `LIVEKIT_API_KEY`          | server | LiveKit key id                                                                                                    |
| `LIVEKIT_API_SECRET`       | server | signs room tokens and derives opaque room names (≥ 32 characters)                                                 |
| `FORGELAB_PRESENCE_KEY`    | server | ECDSA P-256 private key (PKCS#8 PEM; `\n` escapes allowed) — `node scripts/generate-presence-key.mjs`             |
| `SUPABASE_PUBLISHABLE_KEY` | server | lets the endpoints query Postgres _as the caller_; falls back to `VITE_SUPABASE_PUBLISHABLE_KEY`                  |

The build fails if a `VITE_` variable holds the LiveKit secret or a private key, or if
either appears in the browser bundle.

Without LiveKit variables the Join buttons explain that voice isn't configured; without
the presence key the team panel says live presence is unavailable. Chat, saving and
editing work regardless.

## 12. Scope

**V1 (this work):** membership and roles, invite links, General + custom channels,
join/leave voice, mute, deafen, push-to-talk and open mic, device selection, speaking
indicator, member list with activity, text chat with component links, online/channel
presence, server authorization, shared project saves with conflict protection, revision
notices, live role changes and removal (including voice eviction), clean
reconnect/disconnect.

**Later:** Share View / Follow / Jump UI, private-channel member management UI,
moderation (server mute, kick from voice, evict on channel deletion), the remaining
object-reference kinds, message history paging and unread counts, voice quality
settings, large-room optimizations, mobile voice, real-time co-editing, recording or
transcription (only with explicit privacy design).

## 13. Testing

| Suite                                       | What it proves                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` (20)                    | permission matrix, validators, forged / stolen / foreign-project tickets rejected, package boundaries                                                                                   |
| `packages/multiplayer` (12)                 | roster identity from tickets, tamper and replay handling, expiry, ticket renewal, the presence rate budget, broadcast fast path, event permissions and flood limits                     |
| `packages/voice` (14)                       | join/leave, one channel at a time, mic never opened while muted, viewers and blocked mics listen-only, deafen, push-to-talk, speaking, rejoin with fresh token, no rejoin after removal |
| `supabase/tests/collaboration.test.ts` (25) | membership, invites, channels, message rules and rate limit, Realtime topic authorization, stale-save rejection, roles, removal, audit                                                  |
| `api-src/comms.test.ts` (11)                | identity from the session only, token grants and lifetime, listen-only viewers, cross-project refusal, removal before eviction                                                          |
| `e2e/collaboration.mjs` (15 steps)          | two real browsers, real Supabase (Auth, Postgres, Realtime) and a real LiveKit SFU with synthetic microphones: every V1 flow end to end                                                 |

### Local end-to-end

With the acceptance-test setup from `docs/DEPLOYMENT.md` §4, also run LiveKit and give
the build and server its keys:

```bash
export LIVEKIT_API_KEY=forgelab LIVEKIT_API_SECRET=$(openssl rand -hex 32)
export VITE_LIVEKIT_URL=ws://localhost:7880 LIVEKIT_URL=http://localhost:7880
export FORGELAB_PRESENCE_KEY="$(node scripts/generate-presence-key.mjs)"
docker run -d --name livekit --network host -e LIVEKIT_KEYS="forgelab: $LIVEKIT_API_SECRET" \
  livekit/livekit-server:v1.13.7 --dev --bind 0.0.0.0 --node-ip 127.0.0.1
pnpm vercel-build && node scripts/serve-output.mjs 3000 &
node e2e/collaboration.mjs http://localhost:3000
```

## 14. Known limitations

- Late joiners can see someone's mute/channel state up to 30 s stale (the Realtime
  presence budget); people already in the project see changes immediately.
- New channels, role changes and removals reach other members through a signed
  `team.changed` notice; a member who misses it (offline at the time) sees the change on
  their next load or when their presence ticket renews.
- Removal takes effect at once in Postgres (no chat, no saves, no new voice or presence
  tokens) and in voice (eviction). A removed member's presence ticket, however, stays
  valid until it expires (at most 10 minutes), so a removed member who deliberately keeps
  a modified client open could still appear in the online list until then.
- LiveKit's own console logging is off by default (it reports routine disconnects as
  errors). Set `localStorage["forgelab.debugVoice"] = "1"` to turn it on.
