import type { Group } from "./groups";

// Which of a Project's child Groups should currently have their tabs open
// in the browser: every non-done, non-deleted, non-archived one — a Project
// connects with its own tabs AND all of these open at once (each as its own
// collapsed-or-expanded native tab group), not just whichever one is
// "active". See utils/groupActivation.ts for how exactly one of these stays
// "active" (expanded) at a time.
export function liveChildGroups(projectId: string, groups: Group[]): Group[] {
  return groups.filter(
    (g) =>
      g.folderId === projectId &&
      !g.deletedAt &&
      !g.archivedAt &&
      g.status !== "done",
  );
}
