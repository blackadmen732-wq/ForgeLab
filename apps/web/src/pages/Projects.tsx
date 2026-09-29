import { FolderPlus, HardDrive, LogOut, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ProjectCard } from "../components/ProjectCard.js";
import { CloudGate, Empty, ErrorState, Loading } from "../components/States.js";
import { ROLE_LABELS } from "@forgelab/protocol";
import { deleteProject, listMyProjects, type MyProject } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { confirmDialog } from "../lib/confirm.js";
import { env } from "../lib/env.js";
import { relativeTime } from "../lib/format.js";
import { safeStorage } from "../lib/storage.js";
import { removeMember } from "../lib/collab.js";
import { errorMessage, toast } from "../lib/toast.js";
import { useAsync } from "../lib/useAsync.js";
import { LOCAL_DRAFT_KEY, type LocalDraft } from "../builder/store/persistence.js";

function LocalDraftCard() {
  const draft = safeStorage.getJson<LocalDraft | null>(LOCAL_DRAFT_KEY, null);
  if (draft === null) return null;
  return (
    <div className="local-draft">
      <HardDrive aria-hidden="true" />
      <div>
        <strong>{draft.file.name}</strong>
        <span className="dim">
          {" "}
          · saved in this browser {relativeTime(draft.savedAt)} · {draft.file.components.length}{" "}
          components
        </span>
      </div>
      <Link className="btn btn--sm" to="/app?draft=1">
        Open
      </Link>
    </div>
  );
}

function ProjectList() {
  const auth = useAuth();
  const userId = auth.user!.id;
  const projects = useAsync(() => listMyProjects(userId), [userId]);
  const [menu, setMenu] = useState<string | null>(null);

  const leave = async (project: MyProject) => {
    setMenu(null);
    const ok = await confirmDialog({
      title: `Leave "${project.name}"?`,
      body: "You'll lose access to its design, channels and voice until someone invites you again.",
      confirmLabel: "Leave project",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeMember(project.id, userId);
      toast("success", "You left the project");
      projects.reload();
    } catch (error) {
      toast("error", "Couldn't leave the project", errorMessage(error));
    }
  };

  const remove = async (project: MyProject) => {
    setMenu(null);
    const ok = await confirmDialog({
      title: `Delete "${project.name}"?`,
      body: "This removes the project, every version, its likes and any leaderboard entries. Forks made by others keep their own copies.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(project.id);
      toast("success", "Project deleted");
      projects.reload();
    } catch (error) {
      toast("error", "Couldn't delete the project", errorMessage(error));
    }
  };

  if (projects.status === "error")
    return <ErrorState error={projects.error} onRetry={projects.reload} />;
  if (projects.data === undefined) return <Loading label="Loading your projects" />;
  if (projects.data.length === 0) {
    return (
      <Empty icon={<FolderPlus />} title="No cloud projects yet">
        <p>Open the builder, make something, and press Save — it will appear here.</p>
        <Link className="btn btn--primary" to="/app">
          New project
        </Link>
      </Empty>
    );
  }
  return (
    <div className="grid">
      {projects.data.map((project) => (
        <div key={project.id} className="card-wrap">
          <ProjectCard
            to={`/app/${project.id}`}
            project={{
              ...project,
              badge:
                project.role === "owner"
                  ? project.visibility === "public"
                    ? "Public"
                    : "Private"
                  : `Shared · ${ROLE_LABELS[project.role]}`,
            }}
          />
          <div className="card-actions">
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={`Actions for ${project.name}`}
              onClick={() => setMenu(menu === project.id ? null : project.id)}
            >
              <MoreHorizontal />
            </button>
            {menu === project.id && (
              <div className="menu__list" role="menu">
                {project.visibility === "public" && (
                  <Link className="menu__item" role="menuitem" to={`/project/${project.id}`}>
                    View public page
                  </Link>
                )}
                {project.role === "owner" ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item menu__item--danger"
                    onClick={() => void remove(project)}
                  >
                    <Trash2 /> Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item menu__item--danger"
                    onClick={() => void leave(project)}
                  >
                    <LogOut /> Leave project
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Projects() {
  const navigate = useNavigate();
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>My projects</h1>
          <p className="dim">
            Your projects and the ones you've been invited to. Cloud projects autosave while you
            work, and every named version is kept.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void navigate("/app?new=1")}
        >
          <FolderPlus /> New project
        </button>
      </header>
      <LocalDraftCard />
      {env.cloudConfigured ? (
        <CloudGate signedIn reason="Sign in to see the projects you've saved to the cloud.">
          <ProjectList />
        </CloudGate>
      ) : (
        <CloudGate>{null}</CloudGate>
      )}
    </section>
  );
}
