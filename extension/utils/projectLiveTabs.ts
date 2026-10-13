import type { Folder } from "./folders";

// A Project's window shows either its own base tabs, or — once a child
// Group has been swapped in (see groupSwapMachine.ts, a later step) — that
// Group's tabs instead. Nothing sets activeGroupId yet; this just makes the
// resolution logic ready for when something does.
export function resolveProjectLiveTarget(
  project: Folder,
): { table: "groups"; id: string } | { table: "folders"; id: string } {
  return project.activeGroupId
    ? { table: "groups", id: project.activeGroupId }
    : { table: "folders", id: project.id };
}
