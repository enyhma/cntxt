import { getSettings } from "./settings";
import {
  getWindowBindingMap,
  setWindowBinding,
  sameBinding,
  type WindowBinding,
} from "./session";
import { createFolder, updateFolder } from "./folders";
import { snapshotTabs } from "./tabs";

/**
 * Ensures the given window is bound to something — a Project or a Group —
 * creating a Project if needed. Idempotent: safe to call from both the
 * background script and the dashboard page.
 */
export async function ensureBindingForWindow(
  windowId: number,
): Promise<WindowBinding> {
  const map = await getWindowBindingMap();
  const existing = map[windowId];
  if (existing) return existing;

  const settings = await getSettings();
  if (settings.startupBehavior === "lastUsed" && settings.lastActiveBinding) {
    const alreadyOpenElsewhere = Object.values(map).some((b) =>
      sameBinding(b, settings.lastActiveBinding!),
    );
    if (!alreadyOpenElsewhere) {
      await setWindowBinding(windowId, settings.lastActiveBinding);
      return settings.lastActiveBinding;
    }
  }

  // "Every window is a workspace" — a window with nothing to resume gets a
  // fresh Project (the window-bound workspace role Mission/Group used to
  // have alone), not a Group.
  const tabs = await snapshotTabs(windowId);
  const project = await createFolder("Untitled Project", null, "project");
  await updateFolder(project.id, { tabs });
  const binding: WindowBinding = { kind: "project", projectId: project.id };
  await setWindowBinding(windowId, binding);
  return binding;
}
