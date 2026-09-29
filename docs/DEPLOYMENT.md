# Deploying ForgeLab

ForgeLab is a static single-page app plus a few server functions, backed by Supabase,
with a LiveKit SFU for voice.

| Piece                                           | Where it runs    | What it needs                                                                          |
| ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| SPA (`apps/web`)                                | Vercel CDN       | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_LIVEKIT_URL` (for the CSP) |
| `/api/verify`                                   | Vercel (Node 22) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server only)                                    |
| `/api/comms/ticket`, `/api/comms/remove-member` | Vercel (Node 22) | the above, plus `FORGELAB_PRESENCE_KEY` and the publishable key                        |
| `/api/voice/token`                              | Vercel (Node 22) | the above, plus `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                 |
| Auth, DB, Storage, Realtime                     | Supabase         | the migrations in `supabase/migrations`                                                |
| Voice (audio only)                              | LiveKit          | LiveKit Cloud or self-hosted `livekit-server`; no egress/recording                     |

Without Supabase variables the site still builds and the builder works in **local-only
mode** (browser autosave, JSON import/export). Without LiveKit variables everything but
voice works; without the presence key everything but live presence works. See
`docs/COMMUNICATIONS.md` for how the communication layers fit together.

## 1. Supabase

1. Create a **new, dedicated** Supabase project for ForgeLab. The migrations create
   `public.profiles`, `public.projects` and friends and must not be applied to a project
   that already has tables with those names.
2. Apply the schema with the Supabase CLI from the repository root:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies supabase/migrations in order
   ```

   This creates the tables, triggers, RLS policies, column grants, the `fork_project`,
   `discover_projects` and `leaderboard` functions, and the public `thumbnails` (1 MB) and
   `avatars` (512 KB) storage buckets with owner-folder policies; plus project members,
   channels, messages, invites and the audit trail, and the RLS policies on
   `realtime.messages` that authorize private Realtime channels.

   **Realtime → Settings**: turn off "Allow public access" so only private (RLS-authorized)
   channels can be joined.

3. **Authentication → URL configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/callback` (and your Vercel preview
     pattern, e.g. `https://*-<team>.vercel.app/auth/callback`, if you use previews).
4. **Authentication → Providers**
   - Email: enabled. Minimum password length 8 (the UI enforces 8). Email confirmation
     is recommended in production; the sign-up dialog handles both modes.
   - GitHub / Google (optional): enable and paste each provider's client id and secret.
     The UI already offers both buttons; a provider that is not enabled returns an error
     message from Supabase.
   - Consider enabling leaked-password protection and CAPTCHA for sign-up.
5. **Project Settings → API keys**: copy the project URL, the **publishable** key (for
   the browser) and a **secret** key (for the server function only).

## 2. Vercel

1. Import the GitHub repository as a new project. Leave **Root Directory** at the
   repository root. `vercel.json` sets the install and build commands:
   - install: `pnpm install --frozen-lockfile`
   - build: `pnpm vercel-build` — builds the SPA, bundles `/api/verify`, writes
     `.vercel/output` (Build Output API v3).
     Framework preset: _Other_. No output directory setting is needed.
2. **Environment variables** (Production and Preview):

   | Name                            | Value                                              | Exposure        |
   | ------------------------------- | -------------------------------------------------- | --------------- |
   | `VITE_SUPABASE_URL`             | `https://<ref>.supabase.co`                        | browser         |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`                                 | browser         |
   | `VITE_SITE_URL` (optional)      | `https://<your-domain>`                            | browser         |
   | `SUPABASE_URL`                  | `https://<ref>.supabase.co`                        | server function |
   | `SUPABASE_SECRET_KEY`           | `sb_secret_…`                                      | server function |
   | `VITE_LIVEKIT_URL`              | `wss://<project>.livekit.cloud`                    | CSP at build    |
   | `LIVEKIT_URL` (optional)        | `https://<project>.livekit.cloud`                  | server function |
   | `LIVEKIT_API_KEY`               | LiveKit API key id                                 | server function |
   | `LIVEKIT_API_SECRET`            | LiveKit API secret                                 | server function |
   | `FORGELAB_PRESENCE_KEY`         | output of `node scripts/generate-presence-key.mjs` | server function |

   Mark `SUPABASE_SECRET_KEY`, `LIVEKIT_API_SECRET` and `FORGELAB_PRESENCE_KEY` as
   _Sensitive_. **Never** give them a `VITE_` prefix: the build fails if a secret appears
   in any `VITE_` variable or in the built JavaScript, and the browser refuses to use a
   secret Supabase key.

   **LiveKit**: create a LiveKit Cloud project (or run `livekit-server` behind TLS) and
   copy its URL and an API key/secret. Leave egress, recording and transcription off —
   V1 voice is live only.

3. Deploy. `config.json` in the build output adds:
   - `Content-Security-Policy` (scripts from self only; `connect-src` includes the
     Supabase URL the build was given and `*.supabase.co`), HSTS, `X-Content-Type-Options`,
     `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP;
   - one-year immutable caching for hashed assets, `no-cache` for the HTML shell;
   - SPA fallback to `index.html` for every non-file path, and JSON 404s under `/api/`.
     If Supabase is served from a custom domain, set `VITE_SUPABASE_URL` to it — the CSP is
     generated from that value at build time.
4. `/api/verify` runs up to 60 s with 1 GB memory. A standard verification of the
   16-part reference plant takes about 5 s of CPU; the 400-part design cap bounds the
   worst case.

## 3. Local development

```bash
pnpm install
cp .env.example apps/web/.env.local   # or leave unset for local-only mode
pnpm dev                              # http://localhost:5173
```

To develop against a local Supabase stack (Docker required):

```bash
npx supabase start                    # applies supabase/migrations
npx supabase status -o env            # URL, publishable and secret keys
```

Put the URL and publishable key in `apps/web/.env.local`. To exercise `/api/verify`
during `pnpm dev`, run `SUPABASE_URL=… SUPABASE_SECRET_KEY=… pnpm dev:api` in a second
terminal: it builds the output and serves it on :3000, and Vite proxies `/api` there.

## 4. Local end-to-end (acceptance test)

```bash
npx supabase start -x studio,imgproxy,mailpit,postgres-meta,supavisor,logflare,vector
export VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<publishable>
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=<secret>
export VITE_SITE_URL=http://localhost:3000
pnpm vercel-build
node scripts/serve-output.mjs 3000 &
node e2e/acceptance.mjs http://localhost:3000
```

The test drives Chromium through the whole loop: guest build → simulate → fail → fix →
sign up → cloud save → autosave → reload → publish → server verification → leaderboard →
second user forks → lineage → discover → private project hidden from guests.

`e2e/collaboration.mjs` drives two browsers through invites, presence, chat, channels,
voice, shared saves and removal; it additionally needs a local LiveKit server (see
`docs/COMMUNICATIONS.md` §13). CI runs both (`.github/workflows/ci.yml`, job `e2e`) with
throwaway keys generated per run.

## 5. Security checklist

- [ ] Dedicated Supabase project; migrations applied with `db push`, not by hand.
- [ ] Only the publishable key in `VITE_*`; secret key only in `SUPABASE_SECRET_KEY`.
- [ ] `LIVEKIT_API_SECRET` and `FORGELAB_PRESENCE_KEY` only in server variables; the
      presence key generated fresh for each environment.
- [ ] Realtime "Allow public access" off; LiveKit egress/recording off.
- [ ] Auth redirect URLs restricted to your domains.
- [ ] Email confirmation, leaked-password protection and CAPTCHA considered for sign-up.
- [ ] `pnpm test` passes — includes the RLS suite proving browsers cannot write
      verified runs, leaderboard entries, counters, owner ids or other users' data.
- [ ] Run Supabase's security advisor after deploying.
