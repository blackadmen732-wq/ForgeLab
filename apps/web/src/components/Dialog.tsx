import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal dialog: labelled, focus moves in on open and returns on close, Escape
 * and backdrop clicks close it, and Tab stays inside.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
  dismissable = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(
      "[autofocus], input, select, textarea, button:not([data-dialog-close])",
    );
    (first ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissable) {
        event.stopPropagation();
        requestClose();
      }
      if (event.key === "Tab" && node !== null) {
        const focusable = [
          ...node.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (focusable.length === 0) return;
        const firstEl = focusable[0]!;
        const lastEl = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [dismissable]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog${wide ? " dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog__head">
          <h2 id={titleId}>{title}</h2>
          {dismissable && (
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Close"
              data-dialog-close
              onClick={onClose}
            >
              <X />
            </button>
          )}
        </div>
        <div className="dialog__body">{children}</div>
        {footer !== undefined && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}
