import { LEADERBOARD_CATEGORIES } from "@forgelab/sim-runner";
import { Flag, GitFork, Heart, Play, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar.js";
import { ConfidenceBadge } from "../components/ConfidenceBadge.js";
import { Dialog } from "../components/Dialog.js";
import { CloudGate, ErrorState, Loading } from "../components/States.js";
import {
  forkProject,
  getLineage,
  getProfileById,
  getProject,
  hasLiked,
  listVersions,
  projectLeaderboardEntries,
  publicImageUrl,
  reportProject,
  setLiked,
} from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { mass, megawatts, relativeTime } from "../lib/format.js";
import { errorMessage, toast } from "../lib/toast.js";
import { useAsync } from "../lib/useAsync.js";
import { NotFound } from "./NotFound.js";
import { formatScore } from "./Leaderboards.js";

function ReportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Report this design"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || reason.trim() === ""}
            onClick={async () => {
              setBusy(true);
              try {
                await reportProject(projectId, reason.trim());
                toast("success", "Report sent", "Thanks — a moderator will review it.");
                onClose();
              } catch (error) {
                toast("error", "Couldn't send the report", errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send report
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">What's wrong?</span>
        <textarea
          className="textarea"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </Dialog>
  );
}

function Detail({ id }: { id: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const userId = auth.user?.id ?? null;
  const data = useAsync(async () => {
    const project = await getProject(id);
    if (project === null) return null;
    const [owner, versions, entries, lineage] = await Promise.all([
      getProfileById(project.owner_id),
      listVersions(id),
      projectLeaderboardEntries(id),
      getLineage(id),
    ]);
    return { project, owner, versions, entries, lineage };
  }, [id]);
  const [liked, setLikedState] = useState(false);
  const [likeDelta, setLikeDelta] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (userId === null) return;
    void hasLiked(id, userId).then(setLikedState, () => undefined);
  }, [id, userId]);

  if (data.status === "error") return <ErrorState error={data.error} onRetry={data.reload} />;
  if (data.data === undefined) return <Loading label="Loading design" />;
  if (data.data === null) return <NotFound />;
  const { project, owner, versions, entries, lineage } = data.data;
  const isOwner = userId === project.owner_id;
  const likeCount = project.like_count + likeDelta;
  const thumb = publicImageUrl("thumbnails", project.thumbnail_path);
  const namedVersions = versions.filter((v) => !v.is_autosave);

  const requireAccount = (reason: string): boolean => {
    if (auth.status === "signed-in") return true;
    auth.openAuth("sign-in", reason);
    return false;
  };

  const toggleLike = async () => {
    if (!requireAccount("Sign in to like designs.") || userId === null) return;
    const next = !liked;
    setLikedState(next);
    setLikeDelta((d) => d + (next ? 1 : -1));
    try {
      await setLiked(project.id, userId, next);
    } catch (error) {
      setLikedState(!next);
      setLikeDelta((d) => d + (next ? -1 : 1));
      toast("error", "Couldn't update your like", errorMessage(error));
    }
  };

  const fork = async () => {
    if (!requireAccount("Sign in to fork this design into your own projects.")) return;
    setBusy(true);
    try {
      const newId = await forkProject(project.id);
      toast("success", "Forked", "The copy is private until you publish it.");
      void navigate(`/app/${newId}`);
    } catch (error) {
      toast("error", "Couldn't fork this design", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="project">
      <div className="project__hero">
        <div className="project__thumb">
          {thumb ? (
            <img src={thumb} alt={`${project.name} preview`} />
          ) : (
            <div className="card__placeholder" />
          )}
        </div>
        <div className="project__info">
          {project.visibility === "private" && (
            <span className="badge">Private — only you can see this</span>
          )}
          <h1>{project.name}</h1>
          {owner && (
            <Link to={`/profile/${owner.username}`} className="who">
              <Avatar
                path={owner.avatar_path}
                name={owner.display_name || owner.username}
                size={22}
              />
              {owner.display_name || owner.username}
              <span className="dim">@{owner.username}</span>
            </Link>
          )}
          {lineage.parent && (
            <p className="dim">
              <GitFork aria-hidden="true" className="inline-icon" /> Forked from{" "}
              <Link to={`/project/${lineage.parent.id}`}>{lineage.parent.name}</Link> by @
              {lineage.parent.owner}
            </p>
          )}
          {project.description && <p className="project__desc">{project.description}</p>}
          <div className="row">
            <Link className="btn btn--primary" to={`/app/${project.id}`}>
              <Play /> {isOwner ? "Open in builder" : "Open and run"}
            </Link>
            {!isOwner && (
              <button type="button" className="btn" onClick={() => void fork()} disabled={busy}>
                <GitFork /> Fork
              </button>
            )}
            <button
              type="button"
              className={`btn ${liked ? "btn--active" : ""}`}
              aria-pressed={liked}
              onClick={() => void toggleLike()}
              disabled={isOwner}
            >
              <Heart /> {likeCount}
            </button>
            <span className="dim">
              <GitFork aria-hidden="true" className="inline-icon" /> {project.fork_count} forks
            </span>
          </div>
          <dl className="stats">
            <div>
              <dt>Components</dt>
              <dd className="num">{project.component_count}</dd>
            </div>
            {typeof project.stats.massKg === "number" && (
              <div>
                <dt>Mass</dt>
                <dd className="num">{mass(project.stats.massKg)}</dd>
              </div>
            )}
            {typeof project.stats.netElectricW === "number" && (
              <div>
                <dt data-tip="Reported by the author's browser at the last save. Not verified.">
                  Net electric (last run)
                </dt>
                <dd className="num">{megawatts(project.stats.netElectricW)}</dd>
              </div>
            )}
            <div>
              <dt>Published</dt>
              <dd>{relativeTime(project.published_at ?? project.created_at)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <section className="project__section">
        <h2>
          <ShieldCheck aria-hidden="true" className="inline-icon" /> Verified results
        </h2>
        {entries.length === 0 ? (
          <p className="dim">No server-verified scores yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num-col">
                  Score
                </th>
                <th scope="col">Model</th>
                <th scope="col">Engine</th>
                <th scope="col">Verified</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {LEADERBOARD_CATEGORIES.find((c) => c.id === entry.category)?.name ??
                      entry.category}
                  </td>
                  <td className="num num-col">{formatScore(entry.category, entry.value)}</td>
                  <td>
                    <ConfidenceBadge level={entry.confidence} />
                  </td>
                  <td className="mono">{entry.engine_version}</td>
                  <td className="dim">{relativeTime(entry.verified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="project__cols">
        <section className="project__section">
          <h2>Versions</h2>
          {namedVersions.length === 0 ? (
            <p className="dim">Only the latest version is public.</p>
          ) : (
            <ul className="list">
              {namedVersions.map((v) => (
                <li key={v.id}>
                  <span className="mono">v{v.version_number}</span> {v.label ?? "Untitled version"}
                  <span className="dim"> · {relativeTime(v.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="project__section">
          <h2>Forks</h2>
          {lineage.children.length === 0 ? (
            <p className="dim">No public forks yet.</p>
          ) : (
            <ul className="list">
              {lineage.children.map((c) => (
                <li key={c.id}>
                  <Link to={`/project/${c.id}`}>{c.name}</Link>{" "}
                  <span className="dim">by @{c.owner}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!isOwner && (
        <button
          type="button"
          className="link dim report-link"
          onClick={() =>
            requireAccount("Sign in to report a design.") ? setReporting(true) : undefined
          }
        >
          <Flag aria-hidden="true" className="inline-icon" /> Report
        </button>
      )}
      {reporting && <ReportDialog projectId={project.id} onClose={() => setReporting(false)} />}
    </article>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <NotFound />;
  return (
    <section className="page">
      <CloudGate>
        <Detail id={id} />
      </CloudGate>
    </section>
  );
}
