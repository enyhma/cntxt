export type WorkspaceTab = { url: string; title: string };

export type Workspace = {
  id: string;
  name: string;
  tabs: WorkspaceTab[];
  createdAt: number;
  updatedAt: number;
  // Explicit picks from the dashboard's customize dialog; a workspace
  // without either falls back to a hash-derived color and the default
  // cntxt mark (see App.tsx's colorFor/faviconHrefFor).
  color?: string;
  icon?: string;
};

const STORAGE_KEY = "workspaces";

export async function getWorkspaces(): Promise<Workspace[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Workspace[] | undefined) ?? [];
}

async function setWorkspaces(workspaces: Workspace[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: workspaces });
}

export async function createWorkspace(
  name: string,
  tabs: WorkspaceTab[],
): Promise<Workspace> {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    tabs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const workspaces = await getWorkspaces();
  await setWorkspaces([...workspaces, workspace]);
  return workspace;
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<Workspace, "name" | "tabs" | "color" | "icon">>,
) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(
    workspaces.map((w) =>
      w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w,
    ),
  );
}

export async function deleteWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(workspaces.filter((w) => w.id !== id));
}
