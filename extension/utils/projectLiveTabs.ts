import type { Folder } from "./folders";

// A Project's window shows either its own base tabs, or — once a child
// Quest has been swapped in (see questSwapMachine.ts, a later step) — that
// Quest's tabs instead. Nothing sets activeQuestId yet; this just makes the
// resolution logic ready for when something does.
export function resolveProjectLiveTarget(
  project: Folder,
): { table: "quests"; id: string } | { table: "folders"; id: string } {
  return project.activeQuestId
    ? { table: "quests", id: project.activeQuestId }
    : { table: "folders", id: project.id };
}
