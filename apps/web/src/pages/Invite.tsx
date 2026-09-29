import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CloudGate, Loading } from "../components/States.js";
import { acceptInvite } from "../lib/collab.js";
import { errorMessage } from "../lib/toast.js";

const PENDING_KEY = "forgelab.invite";

/** The code from the link, kept for this tab so it survives a sign-in redirect. */
function inviteCode(): string {
  const fromHash = decodeURIComponent(window.location.hash.slice(1)).trim();
  try {
    if (fromHash !== "") window.sessionStorage.setItem(PENDING_KEY, fromHash);
    return fromHash || (window.sessionStorage.getItem(PENDING_KEY) ?? "");
  } catch {
    return fromHash;
  }
}

/** /invite#<code> — joins the project the invite is for, then opens it. */
export function Invite() {
  useState(inviteCode); // capture before any sign-in redirect drops the fragment
  return (
    <section className="page page--narrow">
      <CloudGate signedIn reason="Sign in or create an account to accept this invite.">
        <Accept />
      </CloudGate>
    </section>
  );
}

function Accept() {
  const navigate = useNavigate();
  const [code] = useState(inviteCode);
  const valid = /^[0-9a-f]{64}$/.test(code);
  const [failure, setError] = useState<string | null>(null);
  const error = valid ? failure : "This invite link is incomplete. Ask for a new one.";
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !valid) return;
    started.current = true;
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // storage unavailable: nothing to clear
    }
    acceptInvite(code).then(
      (projectId) => void navigate(`/app/${projectId}?team=1`, { replace: true }),
      (e: unknown) => setError(errorMessage(e)),
    );
  }, [navigate, code, valid]);

  if (error === null) return <Loading label="Joining the project" />;
  return (
    <div className="empty" role="alert">
      <h3>Couldn't join</h3>
      <p>{error}</p>
      <Link className="btn" to="/projects">
        My projects
      </Link>
    </div>
  );
}
