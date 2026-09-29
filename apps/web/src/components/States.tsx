import { CloudOff, LogIn, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> {label}…
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <TriangleAlert />
      <h3>Couldn't load this</h3>
      <p>{error.message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Renders children only when the cloud is configured (and, if `signedIn`, a user is signed in). */
export function CloudGate({
  children,
  signedIn = false,
  reason,
}: {
  children: ReactNode;
  signedIn?: boolean;
  reason?: string;
}) {
  const auth = useAuth();
  if (!env.cloudConfigured) {
    return (
      <Empty icon={<CloudOff />} title="Cloud features aren't configured here">
        <p>
          This deployment runs in local mode: the builder works and saves designs in your browser,
          but accounts, publishing and leaderboards need Supabase. See docs/DEPLOYMENT.md.
        </p>
        <Link className="btn btn--primary" to="/app">
          Open builder
        </Link>
      </Empty>
    );
  }
  if (signedIn && auth.status === "loading") return <Loading label="Restoring session" />;
  if (signedIn && auth.status !== "signed-in") {
    return (
      <Empty icon={<LogIn />} title="Sign in to continue">
        <p>{reason ?? "You need an account for this page."}</p>
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => auth.openAuth("sign-in", reason)}
          >
            Sign in
          </button>
          <button type="button" className="btn" onClick={() => auth.openAuth("sign-up", reason)}>
            Create account
          </button>
        </div>
      </Empty>
    );
  }
  return <>{children}</>;
}
