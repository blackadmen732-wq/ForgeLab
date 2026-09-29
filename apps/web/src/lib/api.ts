import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssemblyFileV2 } from "@forgelab/sim-core";
import { env } from "./env.js";
import { requireSupabase } from "./supabase.js";

/**
 * ForgeLab's cloud data layer.
 *
 * Every call goes through the browser's Supabase client with the user's own session, so
 * row-level security decides what each call may read or write. Nothing here can set a
 * verified flag or write a leaderboard entry: those columns and tables are not granted to
 * browsers at all (see supabase/migrations). Scores are submitted to /api/verify, which
 * recomputes them on the server.
 */

export type Visibility = "private" | "public";
export type DiscoverSort = "trending" | "newest" | "most-forked" | "most-liked";

export interface Profile {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly bio: string;
  readonly avatar_path: string | null;
  readonly created_at: string;
}

/** Figures the author's browser reported with a save. Display only; never ranked. */
export interface ProjectStats {
  readonly massKg?: number;
  readonly netElectricW?: number;
  readonly fusionPowerW?: number;
  readonly confidence?: string;
}

export interface Project {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly thumbnail_path: string | null;
  readonly latest_version_id: string | null;
  readonly latest_version_number: number;
  readonly component_count: number;
  readonly stats: ProjectStats;
  readonly forked_from_project_id: string | null;
  readonly forked_from_version_id: string | null;
  readonly like_count: number;
  readonly fork_count: number;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectVersionMeta {
  readonly id: string;
  readonly project_id: string;
  readonly version_number: number;
  readonly engine_version: string;
  readonly design_hash: string;
  readonly label: string | null;
  readonly is_autosave: boolean;
  readonly created_at: string;
}

export interface ProjectVersion extends ProjectVersionMeta {
  readonly schema_version: number;
  readonly design: AssemblyFileV2;
}

export interface DiscoverRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly thumbnail_path: string | null;
  readonly like_count: number;
  readonly fork_count: number;
  readonly component_count: number;
  readonly stats: ProjectStats;
  readonly published_at: string | null;
  readonly updated_at: string;
  readonly forked_from_project_id: string | null;
  readonly owner_id: string;
  readonly owner_username: string;
  readonly owner_display_name: string;
  readonly owner_avatar_path: string | null;
  readonly engine_version: string | null;
}

export interface LeaderboardRow {
  readonly rank: number;
  readonly entry_id: string;
  readonly value: number;
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_path: string | null;
  readonly project_id: string;
  readonly project_name: string;
  readonly version_id: string;
  readonly engine_version: string;
  readonly confidence: string;
  readonly verified_at: string;
}

export interface LeaderboardEntry {
  readonly id: string;
  readonly category: string;
  readonly value: number;
  readonly version_id: string;
  readonly engine_version: string;
  readonly confidence: string;
  readonly verified_at: string;
}

export interface ForkLineage {
  readonly parent: { readonly id: string; readonly name: string; readonly owner: string } | null;
  readonly children: readonly {
    readonly id: string;
    readonly name: string;
    readonly owner: string;
    readonly created_at: string;
  }[];
}

const PROJECT_COLUMNS =
  "id, owner_id, name, slug, description, visibility, thumbnail_path, latest_version_id, latest_version_number, component_count, stats, forked_from_project_id, forked_from_version_id, like_count, fork_count, published_at, created_at, updated_at";
const VERSION_META_COLUMNS =
  "id, project_id, version_number, engine_version, design_hash, label, is_autosave, created_at";
const PROFILE_COLUMNS = "id, username, display_name, bio, avatar_path, created_at";

interface SupabaseError {
  readonly message: string;
  readonly code?: string;
}

function raise(error: SupabaseError): never {
  const thrown = new Error(friendlyError(error.message, error.code)) as Error & { code?: string };
  if (error.code !== undefined) thrown.code = error.code;
  throw thrown;
}

/** Unwraps a Supabase result whose data must be present. */
function check<T>(result: { data: T | null; error: SupabaseError | null }): T {
  if (result.error !== null) raise(result.error);
  if (result.data === null) throw new Error("The server returned no data.");
  return result.data;
}

/** Unwraps a result that may legitimately be empty (maybeSingle). */
function checkMaybe<T>(result: { data: T | null; error: SupabaseError | null }): T | null {
  if (result.error !== null) raise(result.error);
  return result.data;
}

/** For writes that return nothing. */
function checkOk(result: { error: SupabaseError | null }): void {
  if (result.error !== null) raise(result.error);
}

/** RPC results are untyped without generated types; name the row type here. */
async function rpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = (await supabase.rpc(fn, args)) as { data: T | null; error: SupabaseError | null };
  return check(result);
}

function friendlyError(message: string, code: string | undefined): string {
  if (code === "23505") return "That name is already taken.";
  if (code === "42501") return "You don't have permission to do that.";
  if (code === "PGRST116") return "Not found.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "You appear to be offline.";
  return message;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? "design" : slug;
}

function randomSuffix(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* -------------------------------------------------------------------------------------- *
 * Profiles
 * -------------------------------------------------------------------------------------- */

export async function getProfileById(id: string): Promise<Profile | null> {
  const supabase = await requireSupabase();
  return checkMaybe(
    await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle<Profile>(),
  );
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const supabase = await requireSupabase();
  return checkMaybe(
    await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("username", username.toLowerCase())
      .maybeSingle<Profile>(),
  );
}

export async function updateProfile(
  id: string,
  changes: Partial<Pick<Profile, "username" | "display_name" | "bio" | "avatar_path">>,
): Promise<Profile> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("profiles")
      .update(changes)
      .eq("id", id)
      .select(PROFILE_COLUMNS)
      .single<Profile>(),
  );
}

/* -------------------------------------------------------------------------------------- *
 * Projects and versions
 * -------------------------------------------------------------------------------------- */

export async function listMyProjects(userId: string): Promise<Project[]> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false })
      .returns<Project[]>(),
  );
}

export async function listPublicProjectsBy(ownerId: string): Promise<Project[]> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("owner_id", ownerId)
      .eq("visibility", "public")
      .order("published_at", { ascending: false })
      .returns<Project[]>(),
  );
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await requireSupabase();
  return checkMaybe(
    await supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle<Project>(),
  );
}

async function insertProject(
  supabase: SupabaseClient,
  fields: { name: string; description?: string; stats?: ProjectStats },
): Promise<Project> {
  const base = slugify(fields.name);
  // Slugs are unique per owner. Try the plain slug first, then add a short suffix.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = attempt === 0 ? base : `${base.slice(0, 70)}-${randomSuffix()}`;
    const result = await supabase
      .from("projects")
      .insert({
        name: fields.name,
        slug,
        description: fields.description ?? "",
        stats: fields.stats ?? {},
      })
      .select(PROJECT_COLUMNS)
      .single<Project>();
    if (result.error?.code === "23505") continue;
    return check(result);
  }
  throw new Error("Could not choose a unique address for this project.");
}

export interface SaveVersionInput {
  readonly design: AssemblyFileV2;
  readonly designHash: string;
  readonly engineVersion: string;
  readonly label?: string;
  readonly autosave: boolean;
}

/** Creates a cloud project and its first version from a design. */
export async function createProject(
  name: string,
  version: SaveVersionInput,
  stats: ProjectStats,
): Promise<{ project: Project; version: ProjectVersionMeta }> {
  const supabase = await requireSupabase();
  const project = await insertProject(supabase, { name, stats });
  const saved = await saveVersion(project.id, {
    ...version,
    autosave: false,
    label: version.label ?? "Created",
  });
  return { project: { ...project, latest_version_id: saved.id }, version: saved };
}

/** Appends a version. The database numbers it and points the project at it. */
export async function saveVersion(
  projectId: string,
  input: SaveVersionInput,
): Promise<ProjectVersionMeta> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("project_versions")
      .insert({
        project_id: projectId,
        schema_version: input.design.schemaVersion,
        engine_version: input.engineVersion,
        design: input.design,
        design_hash: input.designHash,
        label: input.label ?? null,
        is_autosave: input.autosave,
      })
      .select(VERSION_META_COLUMNS)
      .single<ProjectVersionMeta>(),
  );
}

export async function updateProject(
  id: string,
  changes: Partial<
    Pick<Project, "name" | "description" | "visibility" | "thumbnail_path" | "stats">
  >,
): Promise<Project> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("projects")
      .update(changes)
      .eq("id", id)
      .select(PROJECT_COLUMNS)
      .single<Project>(),
  );
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = await requireSupabase();
  checkOk(await supabase.from("projects").delete().eq("id", id));
}

export async function listVersions(projectId: string): Promise<ProjectVersionMeta[]> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("project_versions")
      .select(VERSION_META_COLUMNS)
      .eq("project_id", projectId)
      .order("version_number", { ascending: false })
      .limit(100)
      .returns<ProjectVersionMeta[]>(),
  );
}

export async function getVersion(versionId: string): Promise<ProjectVersion | null> {
  const supabase = await requireSupabase();
  return checkMaybe(
    await supabase
      .from("project_versions")
      .select(`${VERSION_META_COLUMNS}, schema_version, design`)
      .eq("id", versionId)
      .maybeSingle<ProjectVersion>(),
  );
}

/** Forks a readable project into a new private project owned by the caller. */
export async function forkProject(projectId: string, name?: string): Promise<string> {
  const supabase = await requireSupabase();
  return rpc<string>(supabase, "fork_project", {
    p_source: projectId,
    ...(name === undefined ? {} : { p_name: name }),
  });
}

export async function getLineage(projectId: string): Promise<ForkLineage> {
  const supabase = await requireSupabase();
  const project = await getProject(projectId);
  let parent: ForkLineage["parent"] = null;
  if (project?.forked_from_project_id) {
    const row = checkMaybe(
      await supabase
        .from("projects")
        .select("id, name, profiles!projects_owner_id_fkey(username)")
        .eq("id", project.forked_from_project_id)
        .maybeSingle<{ id: string; name: string; profiles: { username: string } | null }>(),
    );
    if (row !== null) parent = { id: row.id, name: row.name, owner: row.profiles?.username ?? "" };
  }
  const children = check(
    await supabase
      .from("projects")
      .select("id, name, created_at, profiles!projects_owner_id_fkey(username)")
      .eq("forked_from_project_id", projectId)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(24)
      .returns<
        { id: string; name: string; created_at: string; profiles: { username: string } | null }[]
      >(),
  );
  return {
    parent,
    children: children.map((c) => ({
      id: c.id,
      name: c.name,
      owner: c.profiles?.username ?? "",
      created_at: c.created_at,
    })),
  };
}

/* -------------------------------------------------------------------------------------- *
 * Community
 * -------------------------------------------------------------------------------------- */

export async function discover(
  sort: DiscoverSort,
  options: { limit?: number; offset?: number; search?: string } = {},
): Promise<DiscoverRow[]> {
  const supabase = await requireSupabase();
  const search = options.search?.trim();
  return rpc<DiscoverRow[]>(supabase, "discover_projects", {
    p_sort: sort,
    p_limit: options.limit ?? 24,
    p_offset: options.offset ?? 0,
    p_search: search === undefined || search === "" ? null : search,
  });
}

export async function hasLiked(projectId: string, userId: string): Promise<boolean> {
  const supabase = await requireSupabase();
  const rows = check(
    await supabase
      .from("project_likes")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .returns<{ project_id: string }[]>(),
  );
  return rows.length > 0;
}

export async function setLiked(projectId: string, userId: string, liked: boolean): Promise<void> {
  const supabase = await requireSupabase();
  if (liked) {
    const result = await supabase.from("project_likes").insert({ project_id: projectId });
    if (result.error?.code === "23505") return;
    checkOk(result);
  } else {
    checkOk(
      await supabase
        .from("project_likes")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", userId),
    );
  }
}

export async function reportProject(projectId: string, reason: string): Promise<void> {
  const supabase = await requireSupabase();
  checkOk(await supabase.from("reports").insert({ project_id: projectId, reason }));
}

/* -------------------------------------------------------------------------------------- *
 * Leaderboards (read-only from the browser)
 * -------------------------------------------------------------------------------------- */

export async function leaderboard(category: string, limit = 50): Promise<LeaderboardRow[]> {
  const supabase = await requireSupabase();
  return rpc<LeaderboardRow[]>(supabase, "leaderboard", { p_category: category, p_limit: limit });
}

export async function projectLeaderboardEntries(projectId: string): Promise<LeaderboardEntry[]> {
  const supabase = await requireSupabase();
  return check(
    await supabase
      .from("leaderboard_entries")
      .select("id, category, value, version_id, engine_version, confidence, verified_at")
      .eq("project_id", projectId)
      .order("verified_at", { ascending: false })
      .returns<LeaderboardEntry[]>(),
  );
}

export interface VerifyResponse {
  readonly runId: string;
  readonly designHash: string;
  readonly engineVersion: string;
  readonly confidence: string;
  readonly totalMassKg: number;
  readonly averages: Readonly<Record<string, number>>;
  readonly scores: readonly {
    readonly category: string;
    readonly value: number;
    readonly eligible: boolean;
    readonly reason?: string;
    readonly entered: boolean;
  }[];
}

/**
 * Asks the server to recompute a saved version's score. The browser sends only which
 * version to verify; the server loads that design itself and runs the standard scenario.
 */
export async function requestVerification(
  projectId: string,
  versionId: string,
): Promise<VerifyResponse> {
  const supabase = await requireSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new Error("Sign in to submit a score.");
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ projectId, versionId }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & VerifyResponse;
  if (!response.ok) {
    throw new Error(
      body.error ??
        (response.status === 404
          ? "The verification service is not deployed here."
          : `Verification failed (${response.status}).`),
    );
  }
  return body;
}

/* -------------------------------------------------------------------------------------- *
 * Storage
 * -------------------------------------------------------------------------------------- */

export function publicImageUrl(
  bucket: "thumbnails" | "avatars",
  path: string | null,
): string | null {
  if (path === null || path === "" || !env.cloudConfigured) return null;
  const clean = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${clean}`;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Uploads into the caller's own folder; storage policies reject anything else. */
export async function uploadImage(
  bucket: "thumbnails" | "avatars",
  userId: string,
  blob: Blob,
  stem: string,
): Promise<string> {
  if (!IMAGE_TYPES.has(blob.type)) throw new Error("Images must be PNG, JPEG or WebP.");
  const limit = bucket === "avatars" ? 512 * 1024 : 1024 * 1024;
  if (blob.size > limit) throw new Error(`Images must be under ${Math.round(limit / 1024)} KB.`);
  const supabase = await requireSupabase();
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
  const path = `${userId}/${slugify(stem)}-${randomSuffix()}${randomSuffix()}.${extension}`;
  checkOk(
    await supabase.storage.from(bucket).upload(path, blob, {
      contentType: blob.type,
      cacheControl: "31536000",
      upsert: false,
    }),
  );
  return path;
}

export async function removeImage(bucket: "thumbnails" | "avatars", path: string): Promise<void> {
  const supabase = await requireSupabase();
  await supabase.storage.from(bucket).remove([path]);
}
