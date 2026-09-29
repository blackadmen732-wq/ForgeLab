# Deploying ForgeLab

ForgeLab is a static single-page app plus one server function, backed by Supabase.

| Piece             | Where it runs    | What it needs                                        |
| ----------------- | ---------------- | ---------------------------------------------------- |
| SPA (`apps/web`)  | Vercel CDN       | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `/api/verify`     | Vercel (Node 22) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server only)  |
| Auth, DB, Storage | Supabase         | the migrations in `supabase/migrations`              |

Without Supabase variables the site still builds and the builder works in **local-only
mode** (browser autosave, JSON import/export).

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
   `avatars` (512 KB) storage buckets with owner-folder policies.

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

   | Name                            | Value                       | Exposure        |
   | ------------------------------- | --------------------------- | --------------- |
   | `VITE_SUPABASE_URL`             | `https://<ref>.supabase.co` | browser         |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`          | browser         |
   | `VITE_SITE_URL` (optional)      | `https://<your-domain>`     | browser         |
   | `SUPABASE_URL`                  | `https://<ref>.supabase.co` | server function |
   | `SUPABASE_SECRET_KEY`           | `sb_secret_…`               | server function |

   Mark `SUPABASE_SECRET_KEY` as _Sensitive_. **Never** give it a `VITE_` prefix: the
   build fails if a secret key appears in any `VITE_` variable or in the built JavaScript,
   and the browser refuses to use one.

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
second user forks → lineage → discover → private project hidden from guests. CI runs the
same steps (`.github/workflows/ci.yml`, job `e2e`).

## 5. Security checklist

- [ ] Dedicated Supabase project; migrations applied with `db push`, not by hand.
- [ ] Only the publishable key in `VITE_*`; secret key only in `SUPABASE_SECRET_KEY`.
- [ ] Auth redirect URLs restricted to your domains.
- [ ] Email confirmation, leaked-password protection and CAPTCHA considered for sign-up.
- [ ] `pnpm test` passes — includes the RLS suite proving browsers cannot write
      verified runs, leaderboard entries, counters, owner ids or other users' data.
- [ ] Run Supabase's security advisor after deploying.
