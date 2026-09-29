import { settleConfirm, usePendingConfirm } from "../lib/confirm.js";
import { Dialog } from "./Dialog.js";

export function ConfirmHost() {
  const pending = usePendingConfirm();
  if (pending === null) return null;
  return (
    <Dialog
      title={pending.title}
      onClose={() => settleConfirm(false)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => settleConfirm(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`btn ${pending.danger ? "btn--danger" : "btn--primary"}`}
            autoFocus
            onClick={() => settleConfirm(true)}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </>
      }
    >
      {pending.body !== undefined && <p className="dim">{pending.body}</p>}
    </Dialog>
  );
}
