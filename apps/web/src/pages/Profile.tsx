import { UserX } from "lucide-react";
import { useParams } from "react-router";
import { Avatar } from "../components/Avatar.js";
import { ProjectCard } from "../components/ProjectCard.js";
import { CloudGate, Empty, ErrorState, Loading } from "../components/States.js";
import { getProfileByUsername, listPublicProjectsBy } from "../lib/api.js";
import { useAsync } from "../lib/useAsync.js";

function ProfileView({ username }: { username: string }) {
  const data = useAsync(async () => {
    const profile = await getProfileByUsername(username);
    if (profile === null) return null;
    return { profile, projects: await listPublicProjectsBy(profile.id) };
  }, [username]);
  if (data.status === "error") return <ErrorState error={data.error} onRetry={data.reload} />;
  if (data.data === undefined) return <Loading label="Loading profile" />;
  if (data.data === null) {
    return (
      <Empty icon={<UserX />} title={`No engineer called @${username}`}>
        <p>Check the spelling, or they may have changed their username.</p>
      </Empty>
    );
  }
  const { profile, projects } = data.data;
  const name = profile.display_name || profile.username;
  return (
    <>
      <header className="profile-head">
        <Avatar path={profile.avatar_path} name={name} size={72} />
        <div>
          <h1>{name}</h1>
          <p className="dim">
            @{profile.username} · joined {new Date(profile.created_at).toLocaleDateString()}
          </p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
      </header>
      <h2 className="section-title">Published designs</h2>
      {projects.length === 0 ? (
        <p className="dim">Nothing published yet.</p>
      ) : (
        <div className="grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} to={`/project/${p.id}`} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

export function Profile() {
  const { username = "" } = useParams();
  return (
    <section className="page">
      <CloudGate>
        <ProfileView username={username.toLowerCase()} />
      </CloudGate>
    </section>
  );
}
