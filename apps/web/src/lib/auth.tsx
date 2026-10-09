import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getProfileById, type Profile } from "./api.js";
import { env } from "./env.js";
import { getSupabase, requireSupabase } from "./supabase.js";

/**
 * Authentication state for the whole app.
 *
 * Guests are first-class: `status` is "guest" when nobody is signed in and "offline-only"
 * when the deployment has no cloud at all. The builder never waits on auth to open.
 */
export type AuthStatus = "loading" | "guest" | "signed-in" | "offline-only";

export interface AuthState {
  readonly status: AuthStatus;
  readonly user: User | null;
  readonly session: Session | null;
  readonly profile: Profile | null;
  readonly dialog: AuthDialogMode | null;
  openAuth(mode?: AuthDialogMode, reason?: string): void;
  closeAuth(): void;
  readonly dialogReason: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, username: string): Promise<{ confirmEmail: boolean }>;
  signInWithOAuth(provider: "github" | "google"): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

export type AuthDialogMode = "sign-in" | "sign-up" | "reset";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profileState, setProfileState] = useState<{
    userId: string;
    profile: Profile | null;
  } | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    env.cloudConfigured ? "loading" : "offline-only",
  );
  const [dialog, setDialog] = useState<AuthDialogMode | null>(null);
  const [dialogReason, setDialogReason] = useState<string | null>(null);

  useEffect(() => {
    if (!env.cloudConfigured) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void getSupabase().then(async (supabase) => {
      if (supabase === null || cancelled) return;
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      setStatus(data.session === null ? "guest" : "signed-in");
      const listener = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        setStatus(next === null ? "guest" : "signed-in");
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const userId = session?.user.id ?? null;
  // The profile belongs to whoever is signed in now; a stale one is never shown.
  const profile =
    profileState !== null && profileState.userId === userId ? profileState.profile : null;
  const loadProfile = useCallback(async () => {
    if (userId === null) return;
    const loaded = await getProfileById(userId).catch(() => null);
    setProfileState({ userId, profile: loaded });
  }, [userId]);

  useEffect(() => {
    if (userId === null) return;
    let live = true;
    getProfileById(userId).then(
      (loaded) => live && setProfileState({ userId, profile: loaded }),
      () => live && setProfileState({ userId, profile: null }),
    );
    return () => {
      live = false;
    };
  }, [userId]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user: session?.user ?? null,
      session,
      profile,
      dialog,
      dialogReason,
      openAuth(mode = "sign-in", reason) {
        setDialog(mode);
        setDialogReason(reason ?? null);
      },
      closeAuth() {
        setDialog(null);
        setDialogReason(null);
      },
      async signIn(email, password) {
        const supabase = await requireSupabase();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error !== null) throw new Error(authMessage(error.message));
      },
      async signUp(email, password, username) {
        const supabase = await requireSupabase();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username, display_name: username },
            emailRedirectTo: `${env.siteUrl}/auth/callback`,
          },
        });
        if (error !== null) throw new Error(authMessage(error.message));
        return { confirmEmail: data.session === null };
      },
      async signInWithOAuth(provider) {
        const supabase = await requireSupabase();
        const next = window.location.pathname + window.location.search;
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error !== null) throw new Error(authMessage(error.message));
      },
      async sendPasswordReset(email) {
        const supabase = await requireSupabase();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent("/settings?reset=1")}`,
        });
        if (error !== null) throw new Error(authMessage(error.message));
      },
      async updatePassword(password) {
        const supabase = await requireSupabase();
        const { error } = await supabase.auth.updateUser({ password });
        if (error !== null) throw new Error(authMessage(error.message));
      },
      async signOut() {
        const supabase = await requireSupabase();
        await supabase.auth.signOut();
        setProfileState(null);
      },
      refreshProfile: loadProfile,
    }),
    [status, session, profile, dialog, dialogReason, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}

function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message))
    return "Confirm your email address first — check your inbox.";
  if (/already registered/i.test(message)) return "An account with that email already exists.";
  if (/password should be/i.test(message)) return "Choose a password of at least 8 characters.";
  if (/Failed to fetch/i.test(message)) return "You appear to be offline.";
  return message;
}
