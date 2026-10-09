import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

/**
 * A disposable Postgres (PGlite, real Postgres compiled to WASM) with just enough of
 * Supabase's platform schema to run ForgeLab's migrations unchanged:
 *
 *  - roles anon, authenticated and service_role (BYPASSRLS), with Supabase's default
 *    privileges that GRANT EVERYTHING on new public tables to anon and authenticated —
 *    so the tests prove the migrations' REVOKEs actually take effect;
 *  - auth.users and auth.uid(), reading the JWT subject exactly as Supabase does;
 *  - storage.buckets, storage.objects (RLS enabled) and storage.foldername().
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const PLATFORM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      ),
      ''
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid default auth.uid(),
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
  declare parts text[];
  begin
    select string_to_array(name, '/') into parts;
    return parts[1:array_length(parts, 1) - 1];
  end
  $$;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;

  -- Supabase Realtime's authorization surface: policies on realtime.messages decide who
  -- may join, receive and publish on a topic; realtime.topic() is the topic being checked.
  -- realtime.send() is recorded in realtime.sent so tests can assert what was delivered.
  create schema realtime;
  grant usage on schema realtime to anon, authenticated, service_role;
  create table realtime.messages (
    id bigserial primary key,
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default true,
    inserted_at timestamptz not null default now()
  );
  alter table realtime.messages enable row level security;
  grant select, insert on realtime.messages to anon, authenticated, service_role;
  grant usage on sequence realtime.messages_id_seq to anon, authenticated, service_role;
  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')
  $$;
  grant execute on function realtime.topic() to anon, authenticated, service_role;
  create table realtime.sent (id bigserial primary key, topic text, event text, payload jsonb, private boolean);
  grant select on realtime.sent to service_role;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
  returns void language sql security definer as $$
    insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private)
  $$;
`;

export interface TestDatabase {
  readonly db: PGlite;
  /** Runs `sql` as a given user (uuid), as anon (null) or as the service role. */
  as<T = Record<string, unknown>>(
    who: string | null | "service",
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  signUp(id: string, email: string, meta?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await db.exec(PLATFORM);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  const as = async <T>(who: string | null | "service", sql: string, params: unknown[] = []) => {
    const role = who === "service" ? "service_role" : who === null ? "anon" : "authenticated";
    const claims = who === null || who === "service" ? "" : JSON.stringify({ sub: who, role });
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await db.exec(`set role ${role}`);
    try {
      const result = await db.query<T>(sql, params);
      return result.rows;
    } finally {
      await db.exec("reset role");
    }
  };

  return {
    db,
    as,
    async signUp(id, email, meta = {}) {
      await db.exec("reset role");
      await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
        id,
        email,
        JSON.stringify(meta),
      ]);
    },
    close: () => db.close(),
  };
}

/** A syntactically valid 64-hex design hash. */
export const HASH = "a".repeat(64);
export const DESIGN = JSON.stringify({
  schemaVersion: 2,
  name: "Test",
  components: [{ id: "a" }, { id: "b" }],
  connections: [],
});
