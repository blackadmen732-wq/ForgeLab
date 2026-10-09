import { GitFork, Heart, Boxes } from "lucide-react";
import { Link } from "react-router";
import { publicImageUrl, type ProjectStats } from "../lib/api.js";
import { megawatts, relativeTime } from "../lib/format.js";
import { Avatar } from "./Avatar.js";

export interface ProjectCardData {
  readonly id: string;
  readonly name: string;
  readonly thumbnail_path: string | null;
  readonly like_count: number;
  readonly fork_count: number;
  readonly component_count: number;
  readonly stats: ProjectStats;
  readonly updated_at: string;
  readonly owner?: { username: string; display_name: string; avatar_path: string | null };
  readonly badge?: string;
}

export function ProjectCard({ project, to }: { project: ProjectCardData; to: string }) {
  const thumb = publicImageUrl("thumbnails", project.thumbnail_path);
  const net = project.stats.netElectricW;
  return (
    <Link to={to} className="card">
      <div className="card__thumb">
        {thumb === null ? (
          <div className="card__placeholder" aria-hidden="true" />
        ) : (
          <img src={thumb} alt="" loading="lazy" />
        )}
        {project.badge !== undefined && <span className="badge card__badge">{project.badge}</span>}
      </div>
      <div className="card__body">
        <h3 className="card__title">{project.name}</h3>
        {project.owner && (
          <div className="card__owner">
            <Avatar
              path={project.owner.avatar_path}
              name={project.owner.display_name || project.owner.username}
              size={18}
            />
            <span>{project.owner.display_name || project.owner.username}</span>
          </div>
        )}
        <div className="card__meta">
          <span data-tip="Components">
            <Boxes aria-hidden="true" /> {project.component_count}
          </span>
          <span data-tip="Likes">
            <Heart aria-hidden="true" /> {project.like_count}
          </span>
          <span data-tip="Forks">
            <GitFork aria-hidden="true" /> {project.fork_count}
          </span>
          {typeof net === "number" && (
            <span
              className={`num ${net > 0 ? "pos" : "neg"}`}
              data-tip="Net electric at last save (unverified)"
            >
              {megawatts(net)}
            </span>
          )}
          <span className="card__time">{relativeTime(project.updated_at)}</span>
        </div>
      </div>
    </Link>
  );
}
