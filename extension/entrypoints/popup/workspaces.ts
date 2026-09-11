export type WorkspaceTab = { url: string; title: string };

export type Workspace = {
  id: string;
  name: string;
  tabs: WorkspaceTab[];
  createdAt: number;
};

const STORAGE_KEY = "workspaces";

export async function getWorkspaces(): Promise<Workspace[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Workspace[] | undefined) ?? [];
}

export async function saveWorkspace(workspace: Workspace) {
  const workspaces = await getWorkspaces();
  await browser.storage.local.set({
    [STORAGE_KEY]: [...workspaces, workspace],
  });
}

export async function deleteWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await browser.storage.local.set({
    [STORAGE_KEY]: workspaces.filter((w) => w.id !== id),
  });
}
