import { FolderOpen, LogIn, LogOut, Settings, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth.js";
import { Avatar } from "./Avatar.js";

export function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (auth.status === "offline-only") {
    return (
      <span
        className="badge"
        data-tip="This deployment has no cloud configured; designs save in this browser."
      >
        Local mode
      </span>
    );
  }
  if (auth.status === "loading") return <span className="spinner" aria-label="Loading account" />;
  if (auth.status === "guest") {
    return (
      <button type="button" className="btn btn--sm" onClick={() => auth.openAuth("sign-in")}>
        <LogIn /> Sign in
      </button>
    );
  }
  const name =
    auth.profile?.display_name || auth.profile?.username || auth.user?.email || "Account";
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar path={auth.profile?.avatar_path} name={name} size={24} />
      </button>
      {open && (
        <div className="menu__list" role="menu">
          <div className="menu__head">
            <strong>{name}</strong>
            {auth.profile && <span className="dim">@{auth.profile.username}</span>}
          </div>
          <Link
            role="menuitem"
            className="menu__item"
            to="/projects"
            onClick={() => setOpen(false)}
          >
            <FolderOpen /> My projects
          </Link>
          {auth.profile && (
            <Link
              role="menuitem"
              className="menu__item"
              to={`/profile/${auth.profile.username}`}
              onClick={() => setOpen(false)}
            >
              <User /> Public profile
            </Link>
          )}
          <Link
            role="menuitem"
            className="menu__item"
            to="/settings"
            onClick={() => setOpen(false)}
          >
            <Settings /> Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              void auth.signOut();
            }}
          >
            <LogOut /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
