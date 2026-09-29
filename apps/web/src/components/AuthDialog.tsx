import { GithubMark } from "./BrandIcons.js";
import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth.js";
import { toast } from "../lib/toast.js";
import { Dialog } from "./Dialog.js";

const USERNAME = /^[a-z0-9_]{3,24}$/;

/** Sign in, create an account, or request a password reset. Rendered once by the root. */
export function AuthDialog() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const mode = auth.dialog;
  if (mode === null) return null;

  const switchTo = (next: typeof mode) => {
    setError(null);
    setSent(null);
    auth.openAuth(next, auth.dialogReason ?? undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "sign-up" && !USERNAME.test(username)) {
      setError("Usernames are 3–24 characters: lowercase letters, digits and underscores.");
      return;
    }
    if (mode !== "reset" && password.length < 8) {
      setError("Passwords are at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "sign-in") {
        await auth.signIn(email.trim(), password);
        toast("success", "Signed in");
        auth.closeAuth();
      } else if (mode === "sign-up") {
        const { confirmEmail } = await auth.signUp(email.trim(), password, username);
        if (confirmEmail)
          setSent(
            `We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`,
          );
        else {
          toast("success", "Account created", `Welcome, ${username}.`);
          auth.closeAuth();
        }
      } else {
        await auth.sendPasswordReset(email.trim());
        setSent(`If an account exists for ${email.trim()}, a reset link is on its way.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "sign-in"
      ? "Sign in to ForgeLab"
      : mode === "sign-up"
        ? "Create your account"
        : "Reset your password";

  return (
    <Dialog title={title} onClose={auth.closeAuth}>
      {auth.dialogReason !== null && <p className="callout">{auth.dialogReason}</p>}
      {sent !== null ? (
        <>
          <p>{sent}</p>
          <button type="button" className="btn" onClick={() => switchTo("sign-in")}>
            Back to sign in
          </button>
        </>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {mode !== "reset" && (
            <div className="oauth">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void auth.signInWithOAuth("github").catch((e: Error) => setError(e.message))
                }
              >
                <GithubMark /> Continue with GitHub
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void auth.signInWithOAuth("google").catch((e: Error) => setError(e.message))
                }
              >
                <span aria-hidden="true" className="oauth__g">
                  G
                </span>{" "}
                Continue with Google
              </button>
              <div className="divider">
                <span>or with email</span>
              </div>
            </div>
          )}
          {mode === "sign-up" && (
            <label className="field">
              <span className="field__label">Username</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoComplete="username"
                required
                maxLength={24}
                placeholder="e.g. ada_lovelace"
              />
              <span className="field__hint">Shown on your public designs and leaderboards.</span>
            </label>
          )}
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode !== "reset" && (
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                required
                minLength={8}
              />
            </label>
          )}
          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {mode === "sign-in"
              ? "Sign in"
              : mode === "sign-up"
                ? "Create account"
                : "Send reset link"}
          </button>
          <div className="auth-switch">
            {mode === "sign-in" && (
              <>
                <button type="button" className="link" onClick={() => switchTo("reset")}>
                  Forgot password?
                </button>
                <button type="button" className="link" onClick={() => switchTo("sign-up")}>
                  Create an account
                </button>
              </>
            )}
            {mode !== "sign-in" && (
              <button type="button" className="link" onClick={() => switchTo("sign-in")}>
                I already have an account
              </button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}
