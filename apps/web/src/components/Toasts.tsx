import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissToast, useToasts } from "../lib/toast.js";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`toast toast--${t.kind}`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <Icon aria-hidden="true" />
            <div>
              <div className="toast__title">{t.title}</div>
              {t.body !== undefined && <div className="toast__body">{t.body}</div>}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
            >
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}
