import { KeyRound, Trash2, Upload, UserCog } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Avatar } from "../components/Avatar.js";
import { CloudGate } from "../components/States.js";
import { removeImage, updateProfile, uploadImage, type Profile } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { confirmDialog } from "../lib/confirm.js";
import { resizeImage } from "../lib/images.js";
import { safeStorage } from "../lib/storage.js";
import { errorMessage, toast } from "../lib/toast.js";
import { LOCAL_DRAFT_KEY } from "../builder/store/persistence.js";

function ProfileSettings() {
  const auth = useAuth();
  if (auth.profile === null || auth.user === null) return <p className="dim">Loading profile…</p>;
  // Remount the form whenever the stored profile changes, so fields start from it.
  return (
    <ProfileForm
      key={`${auth.profile.id}:${auth.profile.username}:${auth.profile.avatar_path ?? ""}`}
      profile={auth.profile}
    />
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const [username, setUsername] = useState(profile.username);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      toast("error", "Invalid username", "3–24 lowercase letters, digits and underscores.");
      return;
    }
    setBusy(true);
    try {
      await updateProfile(profile.id, {
        username,
        display_name: displayName.trim(),
        bio: bio.trim(),
      });
      await auth.refreshProfile();
      toast("success", "Profile saved");
    } catch (error) {
      toast("error", "Couldn't save your profile", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setBusy(true);
    try {
      const blob = await resizeImage(file, 256, 256, { square: true });
      const path = await uploadImage("avatars", auth.user!.id, blob, "avatar");
      const previous = profile.avatar_path;
      await updateProfile(profile.id, { avatar_path: path });
      if (previous) await removeImage("avatars", previous).catch(() => undefined);
      await auth.refreshProfile();
      toast("success", "Avatar updated");
    } catch (error) {
      toast("error", "Couldn't upload that image", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-card" onSubmit={save}>
      <h2>
        <UserCog aria-hidden="true" /> Public profile
      </h2>
      <div className="avatar-row">
        <Avatar path={profile.avatar_path} name={displayName || username} size={64} />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadAvatar(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload /> Upload avatar
        </button>
        <span className="field__hint">
          PNG, JPEG or WebP. Cropped square and resized to 256 px in your browser.
        </span>
      </div>
      <label className="field">
        <span className="field__label">Username</span>
        <input
          className="input"
          value={username}
          maxLength={24}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
      </label>
      <label className="field">
        <span className="field__label">Display name</span>
        <input
          className="input"
          value={displayName}
          maxLength={60}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Bio</span>
        <textarea
          className="textarea"
          value={bio}
          maxLength={500}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Save profile
        </button>
      </div>
    </form>
  );
}

function PasswordSettings({ highlight }: { highlight: boolean }) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={`settings-card${highlight ? " settings-card--highlight" : ""}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (password.length < 8) {
          toast("error", "Choose a password of at least 8 characters.");
          return;
        }
        setBusy(true);
        try {
          await auth.updatePassword(password);
          setPassword("");
          toast("success", "Password updated");
        } catch (error) {
          toast("error", "Couldn't update the password", errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>
        <KeyRound aria-hidden="true" /> {highlight ? "Choose a new password" : "Password"}
      </h2>
      <p className="dim">Signed in as {auth.user?.email}</p>
      <label className="field">
        <span className="field__label">New password</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>
          Update password
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function LocalData() {
  return (
    <div className="settings-card">
      <h2>
        <Trash2 aria-hidden="true" /> This browser
      </h2>
      <p className="dim">
        ForgeLab keeps an autosaved draft of your latest design in this browser, even when signed
        out.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn--danger"
          onClick={async () => {
            const ok = await confirmDialog({
              title: "Clear the local draft?",
              body: "Cloud projects are not affected.",
              confirmLabel: "Clear",
              danger: true,
            });
            if (!ok) return;
            safeStorage.remove(LOCAL_DRAFT_KEY);
            toast("success", "Local draft cleared");
          }}
        >
          Clear local draft
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const [params] = useSearchParams();
  return (
    <section className="page page--narrow">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="stack">
        <CloudGate signedIn reason="Sign in to manage your profile and password.">
          {params.get("reset") === "1" && <PasswordSettings highlight />}
          <ProfileSettings />
          {params.get("reset") !== "1" && <PasswordSettings highlight={false} />}
        </CloudGate>
        <LocalData />
      </div>
    </section>
  );
}
