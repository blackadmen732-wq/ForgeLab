# ForgeLab V0.1 — launch candidate report

**Status:** feature-complete for the V0.1 scope and passing its acceptance test end to end
against a real Supabase stack and the production build. **Not yet deployed:** no
production Supabase project or Vercel project has been provisioned (see _Blockers_).

## Addendum: teams, channels and voice

Added after the V0.1 candidate; details in `docs/COMMUNICATIONS.md`. Projects now have
members (owner, admin, member, viewer) invited by link; every project has channels
(General plus any the admins create), each with its own text chat and its own voice
room. Voice is **channel-based**: you hear exactly the people in the same voice channel,
wherever they are in the design. Audio goes browser → LiveKit SFU → browser only; the
server hands out five-minute single-room tokens after asking Postgres, as the caller,
whether they may join. Presence (online, voice channel, mic, activity) is signed with a
server-certified per-tab key so nobody can appear as someone else. Shared saves carry
their parent version, so a teammate's save can never be silently overwritten.

`e2e/collaboration.mjs` passes **15/15** against local Supabase (Auth, Postgres,
Realtime) and a local LiveKit server, with two Chromium instances using synthetic
microphones: invite and join, presence, live chat with a component link, markup shown as
text, a new channel reaching everyone, both in General voice with speaking indicators,
mute and deafen seen by the other side, switching channels changing who hears whom, a
teammate's save announced and loaded, a stale save caught as a conflict and resolved
without loss, removal ending voice and access, and presence clearing when a tab closes.
The original 17-step acceptance test still passes.

The run found and fixed real problems before passing: Supabase Realtime closes a
client's channel after 5 presence updates in 30 s (voice state changes exceeded it — now
budgeted, with signed broadcasts for immediate updates and automatic resubscription);
new members were missing from others' member lists; members' saves tried to update the
owner-only project row; LiveKit logged routine disconnects as console errors.

## Acceptance test

`e2e/acceptance.mjs` drives Chromium through the full loop against local Supabase
(Postgres 17, GoTrue, PostgREST, Storage via `supabase start`) and the Vercel Build Output
served locally. **17/17 steps pass:**

1. Guest opens the builder; an empty workspace is offered first.
2. Loads the interactive starter (reference plant, primary pump off).
3. Simulates; "Pump lost flow" appears with a cause naming the switched-off pump.
4. Fixes it in Build mode (command palette → pump → Enabled).
5. Re-runs: no loss of flow, gross electric > 0.
6. Save prompts sign-in; sign-up completes the pending save as a cloud project.
7. An edit autosaves (Unsaved → Saving → Saved).
8. Reload restores the design (name and the pump fix) from the cloud.
9. Publishes with a viewport thumbnail uploaded to Storage.
10. Submits a score; the server recomputes it (≈ 6 s) and records it.
11. The verified entry appears on the fusion-gain leaderboard.
12. The public project page shows the verified results.
13. A second user signs up from the project page and forks it (action resumes after sign-up).
14. Lineage and fork count are recorded.
15. Discover lists the published design.
16. A guest cannot open the private fork.
17. No uncaught page errors during the run.

The run found and fixed five real bugs before passing (ambiguous PostgREST join in the
verifier, rename-only changes skipped by autosave, fork not resuming after sign-in,
double-scaled leaderboard units, gizmo captured in thumbnails).

## Implemented

**3D workspace.** Full-viewport builder: top bar (editable name, save status,
undo/redo, Build/Simulate switch, SIMULATE/STOP, Save, Publish, more menu, account);
collapsible tool rail; parts drawer with search, category chips and drag-or-click placement;
contextual inspector with beginner sections and an Advanced expansion; bottom timeline.
Camera: orbit, pan, zoom, perspective/orthographic, front/right/top/iso, frame
selected/all, orientation gizmo. Editing: move/rotate gizmos (group-aware), duplicate
(copies internal links), delete, multi-select (Shift), box select (B or Shift-drag),
grid/angle snapping, socket snapping with automatic connection, Alt override, Connect tool
with type checking, hide/isolate/show all, numeric placement, pin, contents mass,
parametric dimensions, material, role parameters; undo/redo (100 steps); shortcut
overlay (?); command palette (Ctrl K) including "add part" and "go to part".

**Simulate mode.** Web Worker session at 1/2/5/10×/max, pause, single step, reset.
Overlays: material, stress, temperature, power, coolant, magnetic, plasma, failures —
each driven by one engine output. Cutaway and x-ray. Plasma glow inside burning vessels.
Live plant KPIs, four sparklines, failure list with causal chains and load paths; clicking
any event or chain link selects the part and flies the camera to it. Live inspector values
per part.

**Onboarding.** Empty workspace by default; start dialog (continue draft, blank project,
interactive starter, blueprints: reference plant, structural rig, overload demo, 384-part
benchmark); contextual hints, with a five-step run → fail → understand → fix → re-run
walkthrough for the starter.

**Site.** Landing ("Build anything. Physics decides.", Start Building / Explore Designs,
feature sections, loop), Projects, Discover (trending/newest/most forked/most liked,
search, paging), Leaderboards (only categories the physics supports), public project page
(likes, fork, lineage, named versions, verified results, report), profiles, settings
(profile, avatar upload, password, local data), auth callback, 404.

**Accounts and cloud.** Email/password sign-up, sign-in, sign-out, password reset,
session restore, OAuth buttons (GitHub, Google) wired to Supabase; guests can do
everything except cloud features. Local draft autosave always; cloud autosave (2.5 s
debounce; Saved / Saving… / Unsaved / Offline / Save failed with retry); named versions;
version history with restore; crash/offline recovery prompt when the browser holds newer
changes than the cloud; unsaved-change guard on navigation and unload. Publish/unpublish
with thumbnail; fork with lineage (and changes made while viewing are kept); likes;
reports; avatars and thumbnails in Storage (resized client-side, EXIF stripped).

**Server verification.** `POST /api/verify` (Vercel Node 22 function) recomputes the
standard 600 s scenario from the saved version; see _Security_.

**Polish.** Loading screen, empty states, error boundaries (app and 3D view), WebGL
unsupported page, WebGL context-loss notice, small-screen notice, offline banner, toasts,
confirm dialogs, tooltips, reduced motion, skip link, focus-trapped labelled dialogs,
keyboard operation of every panel. Dark graphite UI with colour reserved for physical state.

**Build and CI.** Vercel Build Output API (SPA + function + headers + SPA fallback);
secret-key scan of the browser bundle; `.env.example`; GitHub Actions: frozen install,
typecheck, lint, format check, tests, Vercel build, and an e2e job running the acceptance
test against `supabase start`. Both jobs pass on GitHub (run #1, commit `49e84ef`).

## Incomplete or deferred

- **Not deployed.** No production Supabase project or Vercel project exists yet.
- **Catalogue size.** 21 parametric parts and 5 sourced materials, against a long-term
  target of ~150 parts and ~48 materials. The factory (`define()` recipes with
  dimensions, sockets and presets) is ready for the next waves.
- **OAuth** is wired but untested end to end: providers must be enabled with client
  credentials in Supabase. **Password reset** is implemented but not e2e-tested (needs an
  email inbox; the local mail catcher was not started).
- **Deferred by the design brief:** real-time co-editing (component-level sync, soft
  locks), Share View / Follow UI, destruction spectacle, replay, avatars in the world.
  Out of scope: comments, payments, scripting, custom component creator, mobile editor,
  MHD, Monte Carlo, CFD, particle simulation. (Roles, channels, chat, voice and shared
  saves were added after V0.1 — see the addendum.)
- **Moderation UI** for reports does not exist (reports are stored).
- **GPU performance** was not measured on real hardware (container renders in software).
- **Instancing** of identical parts in the viewport (next step for very large designs).

## Supabase migrations

| File                                | Contents                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260929000100_core_schema.sql`    | profiles, projects, project_versions, simulation_runs, leaderboard_entries, project_likes, project_forks, reports; triggers (new-user profile, version numbering, autosave trimming to 50, like counts, published_at); `fork_project`, `discover_projects`, `leaderboard` |
| `20260929000200_rls_and_grants.sql` | RLS on every table; per-column grants; no browser writes to verified runs or leaderboard entries                                                                                                                                                                          |
| `20260929000300_storage.sql`        | public `thumbnails` (1 MB) and `avatars` (512 KB) buckets, image types only, owner-folder write policies                                                                                                                                                                  |
| `20260929000400_hardening.sql`      | revoke EXECUTE on trigger functions from clients                                                                                                                                                                                                                          |
| `20260930000100_collaboration.sql`  | project members and roles, channels, channel members, messages (with realtime delivery), invites, audit events, rate events; the permission matrix in SQL; parent-version check on saves; RLS for all of it and for private Realtime topics                               |

All five apply cleanly to Supabase Postgres 17 (`supabase start`) and to PGlite; `supabase
db lint` reports no issues.

## Tests

**310 automated tests, all passing** (228 at the V0.1 candidate; the rest cover the collaboration layers — see `docs/COMMUNICATIONS.md` §13), plus the 17-step acceptance test and the 15-step collaboration test.

| Suite                                                |       Tests |
| ---------------------------------------------------- | ----------: |
| sim-core: plant physics                              |          27 |
| sim-core: members (buckling, bending)                |          18 |
| sim-core: mass / structural / gravity                | 16 / 15 / 7 |
| sim-core: serialization / determinism / architecture | 14 / 13 / 7 |
| reactor-components: plant integration / components   |     16 / 13 |
| sim-runner: session + verification / benchmarks      |      14 / 3 |
| shared / materials                                   |      10 / 6 |
| Supabase RLS and grants (real Postgres via PGlite)   |          25 |
| `/api/verify` handler                                |           6 |
| web: editor store / env, redirects, formatting       |      11 / 7 |

The RLS suite was mutation-checked earlier (a deliberately weakened policy made it fail).

## Physics capabilities and limitations

Capabilities (all in `@forgelab/sim-core`, deterministic, fixed 1/60 s step, SI):
structural statics with axial, Euler/Johnson buckling and beam bending; DC electrical
networks; lumped thermal with conduction, convection, radiation and cryogenics; closed
single-phase coolant loops with pumps and heat exchangers; vacuum pressure balance;
ideal toroidal and solenoid fields with coil stress and quench; a 0D plasma with
IPB98(y,2) or Bohm confinement, heating, radiation and operational limits; Bosch–Hale D-T
fusion; exponential neutron attenuation into blankets; steam cycle and generator;
**net electric = gross − house load**; causal failure chains; model-confidence labels.

Reference results: the ITER-class reference plant burns at ≈ 180–210 MW fusion, Q ≈ 3.7–4.2,
and is net-negative over the standard run (large thermal inertia, 150 MW house load); a
DEMO-scale variant reaches roughly break-even. Nothing is tuned to pass.

Limitations: no shear/torsion/combined stress or frame compatibility; no spatial
temperature fields or temperature-dependent properties; no two-phase flow or transients;
no real coil geometry fields or inter-coil forces; no plasma profiles, MHD or divertor;
neutronics is attenuation, not transport; no tritium breeding ratio; controls are
threshold interlocks only; no degradation. Linear plasma devices are labelled
Experimental and never ranked. **ForgeLab does not validate real reactor designs.**

## Security

- **Browser holds only the publishable key.** The app refuses secret and service-role
  keys; the build fails if one is in a `VITE_` variable or in the built JavaScript.
- **RLS on every table, per-column grants.** Clients cannot write owner ids, counters,
  version numbers, lineage, `verified`, or any leaderboard entry. Private projects and
  their versions are owner-only; public projects expose only the latest and named
  versions. Tested (25 tests) and audited (`supabase db lint`, grant queries).
- **Scores are never trusted from the browser.** `/api/verify` receives only ids;
  validates the JWT with Supabase Auth; rate-limits (6 per 10 min per user, DB-backed);
  requires ownership and a public project; recomputes the canonical design hash and the
  scenario; writes with the service role. Body size limited; internal errors not leaked.
- **Headers:** strict CSP (`script-src 'self'`, no inline script), HSTS, nosniff,
  `X-Frame-Options: DENY` + `frame-ancestors 'none'`, Referrer-Policy,
  Permissions-Policy, COOP.
- **Auth redirects** follow same-site paths only (tested). PKCE flow.
- **Uploads** go only into the user's own folder, image types only, size-limited by the
  bucket, re-encoded client-side.

## Setup

See `docs/DEPLOYMENT.md` for step-by-step Supabase and Vercel setup.

| Variable                                               | Where           | Purpose                             |
| ------------------------------------------------------ | --------------- | ----------------------------------- |
| `VITE_SUPABASE_URL`                                    | browser (build) | Supabase project URL                |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                        | browser (build) | publishable key (RLS-constrained)   |
| `VITE_SITE_URL` (optional)                             | browser (build) | canonical origin for auth redirects |
| `SUPABASE_URL`                                         | server function | Supabase project URL                |
| `SUPABASE_SECRET_KEY`                                  | server function | secret key for verification writes  |
| `VITE_LIVEKIT_URL`                                     | build (CSP)     | LiveKit server for voice            |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | server function | voice tokens and evictions          |
| `FORGELAB_PRESENCE_KEY`                                | server function | signs presence tickets              |

## Routes

| Route                           | Page                                            |
| ------------------------------- | ----------------------------------------------- |
| `/`                             | Landing                                         |
| `/app`                          | Builder (new, draft or start dialog)            |
| `/app/:projectId`               | Builder with a cloud project (own or read-only) |
| `/projects`                     | My projects + local draft                       |
| `/discover`                     | Published designs                               |
| `/leaderboards`                 | Verified leaderboards                           |
| `/project/:id`                  | Public project page                             |
| `/profile/:username`            | Public profile                                  |
| `/settings`                     | Account settings                                |
| `/auth/callback`                | OAuth / email-link landing                      |
| `/invite#<code>`                | Accept a project invite                         |
| `POST /api/verify`              | Server verification                             |
| `POST /api/comms/ticket`        | Presence ticket for a project member            |
| `POST /api/voice/token`         | Five-minute token for one voice room            |
| `POST /api/comms/remove-member` | Remove a member and evict from voice            |

## Known bugs and rough edges

- Service connections are drawn as straight lines between sockets, through other parts.
- Opening Publish reframes the camera to capture a clean thumbnail.
- Undo keeps full design snapshots (memory grows with very large designs).
- `Tab` toggles Build/Simulate only when focus is on the canvas or page body (so keyboard
  navigation of controls keeps working).
- Dropping a part from the drawer places it on the ground plane; it lands on another part
  only via socket snapping (within 0.6 m).
- The R3F dependency logs a `THREE.Clock` deprecation warning.
- The 3D viewport itself is not screen-reader accessible (panels are).

## Blockers

- **Provisioning needs your go-ahead and credentials.** The only Supabase project on the
  connected account belongs to a different app (it already has a `profiles` table), so
  ForgeLab's migrations were deliberately not applied there. There are no Vercel projects
  yet. Creating either is an account-level action with possible billing implications.

## Next tasks

1. Create a dedicated Supabase project, `supabase db push`, configure auth URLs and
   providers; create the Vercel project and set the five variables; deploy.
2. Run the acceptance test against the preview deployment; test OAuth and password reset
   with real inboxes.
3. Parts wave 2 (heat sinks, divertor, cryostat, valves, capacitor banks, RF heating)
   and materials wave 2 (Inconel, Eurofer, REBCO, CuCrZr, graphite, water/helium data).
4. Instanced rendering for repeated parts; hose routing for service connections.
5. Moderation view for reports; email confirmation and CAPTCHA on sign-up.
6. Physics: temperature-dependent yield (hot structure is weak), TBR estimate, PID
   control, 1D plasma profiles.
