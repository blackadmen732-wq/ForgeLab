import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loading } from "../components/States.js";
import { safeNext } from "../lib/redirect.js";
import { getSupabase } from "../lib/supabase.js";

export function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(
    params.get("error_description") ?? params.get("error"),
  );

  useEffect(() => {
    if (error !== null) return;
    let live = true;
    void (async () => {
      const supabase = await getSupabase();
      if (supabase === null) {
        if (live) setError("Cloud features are not configured on this deployment.");
        return;
      }
      // The client exchanges the PKCE code in the URL on creation (detectSessionInUrl).
      const code = params.get("code");
      const { data } = await supabase.auth.getSession();
      if (data.session === null && code !== null) {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error !== null) {
          if (live) setError(exchanged.error.message);
          return;
        }
      }
      if (live) void navigate(safeNext(params.get("next")), { replace: true });
    })();
    return () => {
      live = false;
    };
  }, [error, navigate, params]);

  return (
    <section className="page page--narrow">
      {error === null ? (
        <Loading label="Signing you in" />
      ) : (
        <div className="empty" role="alert">
          <h3>Sign-in didn't complete</h3>
          <p>{error}</p>
          <a className="btn" href="/">
            Home
          </a>
        </div>
      )}
    </section>
  );
}
