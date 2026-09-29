import { Component, type ErrorInfo, type ReactNode } from "react";

/** Catches render errors in a subtree and shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ForgeLab crashed:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <CrashScreen error={error} onRetry={this.reset} />;
  }
}

export function CrashScreen({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="crash" role="alert">
      <div className="crash__card">
        <p className="eyebrow">Something broke</p>
        <h1>ForgeLab hit an unexpected error.</h1>
        <p className="dim">
          Your last autosave is kept in this browser. Reload to recover it; if this keeps happening,
          the details below help us fix it.
        </p>
        <pre className="crash__detail">{message}</pre>
        <div className="row">
          {onRetry && (
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <a className="btn btn--ghost" href="/">
            Home
          </a>
        </div>
      </div>
    </main>
  );
}
