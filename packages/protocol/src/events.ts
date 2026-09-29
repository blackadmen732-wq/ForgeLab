/**
 * Collaboration events travel on the project topic, signed like presence. They are
 * ForgeLab events — design revisions, "come look at this" — and have nothing to do with
 * voice. Receivers treat them as suggestions: nothing here controls another user's
 * workspace.
 */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly projection: "perspective" | "orthographic";
}

export type CollabEvent =
  | {
      readonly type: "design.revision";
      readonly versionId: string;
      readonly versionNumber: number;
      readonly label: string | null;
    }
  | {
      readonly type: "view.share";
      readonly camera: CameraPose;
      readonly focus: readonly string[];
      readonly note: string | null;
    };

/**
 * Specified for the next milestone (real-time co-editing); not produced in V1.
 * Mutations will carry the revision they apply to so stale edits can be rejected.
 */
export interface ComponentUpdatedEvent {
  readonly type: "component_updated";
  readonly projectId: string;
  readonly componentId: string;
  readonly userId: string;
  readonly operation: "add" | "remove" | "transform" | "set-parameter" | "set-material" | "reshape";
  readonly revision: number;
  readonly timestamp: number;
  readonly data: unknown;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6;
const vec = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(finite);
const ID = /^[A-Za-z0-9:_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict validation of an untrusted event body. */
export function parseCollabEvent(input: unknown): CollabEvent | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  switch (r["type"]) {
    case "design.revision":
      if (typeof r["versionId"] !== "string" || !UUID.test(r["versionId"])) return null;
      if (!Number.isInteger(r["versionNumber"]) || (r["versionNumber"] as number) < 1) return null;
      if (r["label"] !== null && (typeof r["label"] !== "string" || r["label"].length > 120))
        return null;
      return {
        type: "design.revision",
        versionId: r["versionId"],
        versionNumber: r["versionNumber"] as number,
        label: (r["label"] as string | null) ?? null,
      };
    case "view.share": {
      const camera = r["camera"] as Record<string, unknown> | null;
      if (typeof camera !== "object" || camera === null) return null;
      if (!vec(camera["position"]) || !vec(camera["target"])) return null;
      if (camera["projection"] !== "perspective" && camera["projection"] !== "orthographic")
        return null;
      const focus = r["focus"];
      if (
        !Array.isArray(focus) ||
        focus.length > 50 ||
        !focus.every((f) => typeof f === "string" && ID.test(f))
      )
        return null;
      if (r["note"] !== null && (typeof r["note"] !== "string" || r["note"].length > 200))
        return null;
      return {
        type: "view.share",
        camera: {
          position: camera["position"],
          target: camera["target"],
          projection: camera["projection"],
        },
        focus: focus as string[],
        note: (r["note"] as string | null) ?? null,
      };
    }
    default:
      return null;
  }
}
