import { isRouteErrorResponse, useRouteError } from "react-router";
import { CrashScreen } from "../components/ErrorBoundary.js";
import { NotFound } from "../pages/NotFound.js";

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  // A deploy replaced the chunk this tab was about to load: reload once to pick it up.
  if (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed/i.test(error.message)
  ) {
    const key = "forgelab.chunk-reload";
    if (sessionStorage.getItem(key) === null) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
      return null;
    }
  }
  return <CrashScreen error={error} />;
}
