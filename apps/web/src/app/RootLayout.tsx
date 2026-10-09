import { WifiOff } from "lucide-react";
import { Outlet, useNavigation } from "react-router";
import { AuthDialog } from "../components/AuthDialog.js";
import { ConfirmHost } from "../components/ConfirmHost.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { Toasts } from "../components/Toasts.js";
import { AuthProvider } from "../lib/auth.js";
import { useOnline } from "../lib/platform.js";

export function RootLayout() {
  const navigation = useNavigation();
  const online = useOnline();
  return (
    <AuthProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {navigation.state === "loading" && <div className="route-progress" aria-hidden="true" />}
      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff aria-hidden="true" /> You're offline. The sandbox keeps working; cloud saves
          resume when you reconnect.
        </div>
      )}
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <AuthDialog />
      <ConfirmHost />
      <Toasts />
    </AuthProvider>
  );
}
