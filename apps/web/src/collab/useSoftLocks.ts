import { useMemo } from "react";
import { useCollab, useCollabController } from "./context.js";
import { type OrbEntry, editorsOf, orbEntries } from "./orbs.js";

/** Teammates (never you) in this workspace who are building with `componentId` selected. */
export function useTeammatesEditing(componentId: string | null): OrbEntry[] {
  const controller = useCollabController();
  const roster = useCollab((s) => s.session.roster);
  const workspaceId = useCollab((s) => s.session.self.workspaceId);
  return useMemo(() => {
    if (componentId === null || roster === undefined || controller === null) return [];
    const entries = orbEntries(roster, [], controller.userId, workspaceId ?? null, () => true);
    return editorsOf(entries, componentId);
  }, [componentId, roster, controller, workspaceId]);
}
