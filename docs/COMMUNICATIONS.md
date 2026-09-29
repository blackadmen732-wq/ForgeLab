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
  builder / multiplayer engine ── design saves, revision notices, share view
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

| Package                 | Contents                                                                                                                                                                                                          | Depends on                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `@forgelab/protocol`    | roles and the permission matrix; id/topic/room helpers; presence and event schemas with validators; message model with object references; signed envelopes (WebCrypto ECDSA P-256, identical in browser and Node) | nothing                      |
| `@forgelab/multiplayer` | presence roster (verify, dedupe, expire), collaboration bus, `RealtimeTransport` interface, in-memory transport for tests                                                                                         | `protocol`                   |
| `@forgelab/voice`       | `VoiceClient` state machine (join/leave, mute, deafen, push-to-talk, devices, speaking, listen-only), `VoiceTransport` interface, LiveKit adapter (loaded on demand)                                              | `protocol`, `livekit-client` |

`apps/web` supplies the Supabase Realtime adapter and the UI. `api-src` holds the server
endpoints. Nothing in `sim-core` knows any of this exists.

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

**Listen-only.** If microphone permission is denied or no input device exists, the user
joins listen-only and the panel says why. Viewers are listen-only by role.

**Push-to-talk** gates the published track (hold a key; default `` ` ``). **Deafen**
stops playback of all remote audio and mutes the microphone.

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
one entry (the newest state wins), and entries that stop refreshing expire after 45 s
even if Realtime never delivers a leave. Tickets are renewed before expiry.

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
`chat:<channel id>`, whose Realtime policy requires `can_view`. History is a paginated
select. Content is rendered as text, never as HTML.

## 9. Shared project integration (multiplayer engine V1)

- Members with `can_edit_design` open the shared project read-write; viewers read-only.
- **No silent overwrites.** Every save names the version it was based on
  (`parent_version_id`); the database rejects a save whose parent is no longer the latest
  (`409`-style `P0001: stale_version`). The saver sees who saved last and chooses to load
  theirs, keep editing a copy, or overwrite deliberately.
- After a save, the client broadcasts a signed `design.revision` event; collaborators
  see "Andre saved v12 — Load".
- **Share View**: a signed `view.share` event carries the sender's camera pose and
  focused components. Recipients get a notice; _View_ moves their own camera. Nothing
  is controlled remotely.

Real-time, component-level co-editing (`component_updated { project_id, component_id,
user_id, operation, revision, timestamp }`) is specified in `@forgelab/protocol` but not
implemented: it needs operation transforms or per-component locks, and is the next
multiplayer milestone.

## 10. Privacy

V1 voice is live only: no recording, no transcription, nothing stored server-side. The
SFU forwards packets; LiveKit is configured without egress. Adding either requires an
explicit product and privacy design, visible consent and a separate storage policy.

## 11. Configuration

| Variable                | Where   | Purpose                                                   |
| ----------------------- | ------- | --------------------------------------------------------- |
| `VITE_LIVEKIT_URL`      | browser | `wss://…` of the LiveKit deployment (public)              |
| `LIVEKIT_API_KEY`       | server  | LiveKit key id                                            |
| `LIVEKIT_API_SECRET`    | server  | signs room tokens; derives opaque room names              |
| `LIVEKIT_URL`           | server  | `https://…` for room administration (evictions)           |
| `FORGELAB_PRESENCE_KEY` | server  | ECDSA P-256 private key (PKCS#8 PEM) for presence tickets |

Without LiveKit variables the voice controls explain that voice is not configured; chat,
presence and editing work regardless.

## 12. Scope

**V1 (this work):** membership and roles, invites, General + custom channels, join/leave
voice, mute, deafen, push-to-talk and open mic, device selection, speaking indicator,
member list, text messages, online/channel presence, server authorization, shared
project saves with conflict protection, revision notices, Share View, clean
reconnect/disconnect.

**Later:** private-channel member management UI, moderation (server mute, kick from
voice), object references rendered from `refs`, voice quality settings, large-room
optimizations, mobile voice, real-time co-editing, follow-user, recording or
transcription (only with explicit privacy design).
