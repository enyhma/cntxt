import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { useSupabaseSession } from "@cntxt/supabase";
import {
  LayoutGrid,
  Bookmark as BookmarkIcon,
  History,
  Trash2,
  CreditCard,
} from "lucide-solid";
import {
  BookmarksPanel,
  ConfigWarning,
  DetailPageShell,
  FolderPage,
  GroupBoardPanel,
  GroupDot,
  PlanPanel,
  Sidebar,
  SidebarPaneShell,
  TabRow,
  TimelinePanel,
  TrashPanel,
} from "@cntxt/ui";
import { supabase, supabaseConfigured } from "./supabase";
import { Login } from "./views/Login";
import {
  createArea,
  createProject,
  deleteFolderForever,
  listFolders,
  type Folder,
} from "./lib/folders";
import {
  createGroup,
  deleteGroupForever,
  listGroups,
  listTrashedGroups,
  updateGroup,
  type Group,
} from "./lib/groups";
import { addResource, deleteResource, listResources } from "./lib/resources";
import { listSessions, restoreSession, type Session } from "./lib/sessions";
import { fetchEntitlements, type Entitlements } from "./lib/entitlements";
import {
  creemBasicCheckoutUrl,
  creemMonthlyCheckoutUrl,
  creemYearlyCheckoutUrl,
} from "./lib/creem";

type Nav = "tree" | "bookmarks" | "timeline" | "plan" | "trash";
const NAV_VALUES: Nav[] = ["tree", "bookmarks", "timeline", "plan", "trash"];
const NAV_META: Record<
  Nav,
  { label: string; icon: (props: { size: number }) => JSX.Element }
> = {
  tree: { label: "Tabs", icon: LayoutGrid },
  bookmarks: { label: "Bookmarks", icon: BookmarkIcon },
  timeline: { label: "Timeline", icon: History },
  plan: { label: "Plan", icon: CreditCard },
  trash: { label: "Trash", icon: Trash2 },
};

// Generalizes the extension's three mutually-exclusive view signals
// (viewedId/viewingFolderId/viewedProjectId) into one pane-state union.
// undefined = nothing selected (empty-state message in the main pane) —
// there's no more "root" state, since the sidebar itself is always
// visible now.
type PaneView = { kind: "folder"; id: string } | { kind: "group"; id: string };

// Edit-class actions (rename, recolor, nest, archive, trash-restore) hit
// groups/folders UPDATE policies, which — as of
// supabase/migrations/20261018140000_basic_plan_and_gating.sql — require
// has_sync_access (an active Pro subscription, not just has_basic_license).
// That's invisible in the extension (local-first: the UI updates instantly
// regardless of whether the background push to Supabase 403s), but web has
// no local copy to hide behind, so every one of those actions is gated
// here instead of being offered and silently failing server-side.
const UPGRADE_MESSAGE =
  "This needs an active Pro subscription — see the Plan tab.";

// BookmarksPanel (shared with the extension) only renders/deletes — adding
// one happens from the owning Area/Project's own page instead, same as the
// old WorkspaceDetail's link form this replaces. Small enough, and used in
// exactly two places with no other caller, that it isn't worth promoting
// to @cntxt/ui alongside BookmarksPanel itself.
function AddBookmarkForm(props: { folderId: string; onAdded: () => void }) {
  const [url, setUrl] = createSignal("");
  const [note, setNote] = createSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!url().trim()) return;
    await addResource(props.folderId, url().trim(), note().trim());
    setUrl("");
    setNote("");
    props.onAdded();
  }

  return (
    <form class="flex gap-2" onSubmit={handleSubmit}>
      <input
        type="url"
        required
        placeholder="https://… (bookmark this)"
        class="input input-sm flex-1 bg-surface-alt2"
        value={url()}
        onInput={(e) => setUrl(e.currentTarget.value)}
      />
      <input
        type="text"
        placeholder="Note (optional)"
        class="input input-sm w-40 bg-surface-alt2"
        value={note()}
        onInput={(e) => setNote(e.currentTarget.value)}
      />
      <button
        type="submit"
        class="btn btn-sm border-none bg-accent text-accent-txt hover:bg-accent-alt1"
      >
        Add
      </button>
    </form>
  );
}

function App() {
  const [entitlements, setEntitlements] = createSignal<Entitlements>();
  const proActive = () => entitlements()?.proActive ?? false;

  const [groups, setGroups] = createSignal<Group[]>([]);
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [trashedGroups, setTrashedGroups] = createSignal<Group[]>([]);
  const [resources, setResources] = createSignal<
    Awaited<ReturnType<typeof listResources>>["data"]
  >([]);
  const [sessions, setSessions] = createSignal<Session[]>([]);

  async function refreshTree() {
    const [g, f] = await Promise.all([listGroups(), listFolders()]);
    setGroups(g.data ?? []);
    setFolders(f.data ?? []);
  }
  async function refreshTrash() {
    setTrashedGroups((await listTrashedGroups()).data ?? []);
  }
  async function refreshBookmarks() {
    setResources((await listResources()).data ?? []);
  }
  async function refreshTimeline() {
    setSessions((await listSessions()).data ?? []);
  }

  async function onSignedIn() {
    setEntitlements(await fetchEntitlements());
    await refreshTree();
  }

  // Checkout links (PlanPanel, below) are built directly from session()'s
  // own user id at render time, not threaded through here — no reason to
  // duplicate it onto this callback too.
  const { session, authLoading } = useSupabaseSession(supabase, {
    onInitialSession: onSignedIn,
    onAuthEvent: (event, newSession: AuthSession | null) => {
      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        newSession
      ) {
        onSignedIn();
      }
    },
  });

  async function handleSignOut() {
    await supabase!.auth.signOut();
  }

  // Hash-synced nav — web, unlike the extension's single always-open tab,
  // is a real multi-page site: this gets shareable/bookmarkable links and
  // a working back/forward button for free, with no router dependency
  // (matches the plain-signal nav pattern the extension's own dashboard
  // already uses).
  function navFromHash(): Nav {
    const h = window.location.hash.slice(1);
    return (NAV_VALUES as string[]).includes(h) ? (h as Nav) : "tree";
  }
  const [nav, setNav] = createSignal<Nav>(navFromHash());
  onMount(() => {
    const onHashChange = () => setNav(navFromHash());
    window.addEventListener("hashchange", onHashChange);
    onCleanup(() => window.removeEventListener("hashchange", onHashChange));
  });
  createEffect(() => {
    if (window.location.hash.slice(1) !== nav()) {
      window.location.hash = nav();
    }
  });
  createEffect(() => {
    if (nav() === "trash") refreshTrash();
    if (nav() === "bookmarks") refreshBookmarks();
    if (nav() === "timeline") refreshTimeline();
  });

  const [pane, setPane] = createSignal<PaneView>();
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(
    new Set(),
  );
  const [railOpen, setRailOpen] = createSignal(
    (() => {
      try {
        return localStorage.getItem("cntxt.railOpen") !== "0";
      } catch {
        return true;
      }
    })(),
  );
  createEffect(() => {
    try {
      localStorage.setItem("cntxt.railOpen", railOpen() ? "1" : "0");
    } catch {
      // storage unavailable (private mode, etc.) — rail just won't persist
    }
  });

  const areas = () =>
    folders().filter((f) => f.parent_id === null && f.kind === "area");
  const standaloneProjects = () =>
    folders().filter((f) => f.parent_id === null && f.kind === "project");
  const standaloneGroups = () => groups().filter((g) => g.folder_id === null);
  const childProjectsOf = (areaId: string) =>
    folders().filter((f) => f.parent_id === areaId && f.kind === "project");
  const groupsIn = (folderId: string) =>
    groups().filter((g) => g.folder_id === folderId);
  const folderNameFor = (id: string | null) =>
    id ? folders().find((f) => f.id === id)?.name : undefined;

  const activeFolderId = () =>
    pane()?.kind === "folder" ? pane()!.id : undefined;
  const activeGroupId = () =>
    pane()?.kind === "group" ? pane()!.id : undefined;

  function toggleExpanded(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selecting something nested auto-reveals its ancestor chain, so e.g.
  // picking a Group inside a collapsed Project doesn't leave the sidebar
  // looking like nothing is selected.
  function openPane(next: PaneView) {
    setPane(next);
    const toExpand: string[] = [];
    if (next.kind === "folder") {
      const f = folders().find((x) => x.id === next.id);
      if (f?.parent_id) toExpand.push(f.parent_id);
    } else {
      const g = groups().find((x) => x.id === next.id);
      if (g?.folder_id) {
        toExpand.push(g.folder_id);
        const f = folders().find((x) => x.id === g.folder_id);
        if (f?.parent_id) toExpand.push(f.parent_id);
      }
    }
    if (toExpand.length) {
      setExpandedFolders((prev) => new Set([...prev, ...toExpand]));
    }
  }

  async function handleAddArea() {
    const name = window.prompt("Area name?")?.trim();
    if (!name) return;
    await createArea(name);
    await refreshTree();
  }
  async function handleAddProject(parentId: string) {
    const name = window.prompt("Project name?")?.trim();
    if (!name) return;
    await createProject(name, parentId);
    await refreshTree();
  }
  async function handleAddGroup(name: string, folderId?: string) {
    if (folderId && !proActive()) {
      window.alert(
        `Created, but not nested under this folder — ${UPGRADE_MESSAGE}`,
      );
    }
    await createGroup(name, folderId && proActive() ? folderId : undefined);
    await refreshTree();
  }
  async function handleActivateGroup(groupId: string) {
    if (!proActive()) return window.alert(UPGRADE_MESSAGE);
    const project = folders().find((f) =>
      groupsIn(f.id).some((g) => g.id === groupId),
    );
    if (!project) return;
    await Promise.all(
      groupsIn(project.id)
        .filter((g) => g.id !== groupId && g.status === "active")
        .map((g) => updateGroup(g.id, { status: "pending" })),
    );
    await updateGroup(groupId, { status: "active" });
    await refreshTree();
  }
  async function handleCompleteGroup(groupId: string) {
    if (!proActive()) return window.alert(UPGRADE_MESSAGE);
    await updateGroup(groupId, { status: "done" });
    await refreshTree();
  }
  async function handleTrashGroup(groupId: string) {
    if (!proActive()) return window.alert(UPGRADE_MESSAGE);
    await updateGroup(groupId, { deleted_at: new Date().toISOString() });
    setPane(undefined);
    await refreshTree();
  }
  async function handleRestoreGroup(groupId: string) {
    if (!proActive()) return window.alert(UPGRADE_MESSAGE);
    await updateGroup(groupId, { deleted_at: null });
    await Promise.all([refreshTrash(), refreshTree()]);
  }
  async function handleDeleteGroupForever(groupId: string) {
    await deleteGroupForever(groupId);
    await refreshTrash();
  }
  async function handleDeleteFolderForever(folderId: string) {
    await deleteFolderForever(folderId);
    await refreshTree();
  }

  return (
    <Show
      when={supabaseConfigured}
      fallback={
        <ConfigWarning>
          Copy <code>web/.env.example</code> to <code>web/.env</code> and fill
          in <code>VITE_SUPABASE_URL</code> /{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart{" "}
          <code>pnpm dev</code>.
        </ConfigWarning>
      }
    >
      <Show when={!authLoading()}>
        <Show when={session()} fallback={<Login />}>
          {(s) => (
            <div class="min-h-screen bg-surface font-sans text-surface-txt">
              <header class="flex h-13 items-center justify-between gap-3 border-b border-surface-alt2 bg-surface-alt1 px-3.5">
                <span class="font-semibold">cntxt</span>
                <nav class="flex items-center gap-4 text-sm">
                  <For each={NAV_VALUES}>
                    {(n) => (
                      <button
                        type="button"
                        onClick={() => setNav(n)}
                        class={
                          "flex items-center gap-1.5" +
                          (nav() === n
                            ? " font-medium text-surface-txt"
                            : " text-surface-txt-hint")
                        }
                      >
                        {NAV_META[n].icon({ size: 14 })}
                        {NAV_META[n].label}
                      </button>
                    )}
                  </For>
                </nav>
                <button
                  type="button"
                  onClick={handleSignOut}
                  class="btn btn-sm border border-surface-alt3"
                >
                  Sign out
                </button>
              </header>

              <Switch>
                <Match when={nav() === "tree"}>
                  <SidebarPaneShell
                    railOpen={railOpen()}
                    onOpenRail={() => setRailOpen(true)}
                    sidebar={
                      <Sidebar
                        areas={() =>
                          areas().map((f) => ({
                            id: f.id,
                            name: f.name,
                            kind: "area" as const,
                          }))
                        }
                        standaloneProjects={() =>
                          standaloneProjects().map((f) => ({
                            id: f.id,
                            name: f.name,
                            kind: "project" as const,
                          }))
                        }
                        ungroupedGroups={() =>
                          standaloneGroups().map((g) => ({
                            id: g.id,
                            name: g.name,
                            color: g.color ?? undefined,
                            icon: g.icon ?? undefined,
                            tabCount: g.tabs.length,
                          }))
                        }
                        childProjectsOf={(id) =>
                          childProjectsOf(id).map((p) => ({
                            id: p.id,
                            name: p.name,
                            kind: "project" as const,
                          }))
                        }
                        groupsIn={(id) =>
                          groupsIn(id).map((g) => ({
                            id: g.id,
                            name: g.name,
                            color: g.color ?? undefined,
                            icon: g.icon ?? undefined,
                            tabCount: g.tabs.length,
                          }))
                        }
                        expanded={expandedFolders}
                        onToggle={toggleExpanded}
                        activeFolderId={activeFolderId()}
                        activeGroupId={activeGroupId()}
                        onOpenFolder={(id) => openPane({ kind: "folder", id })}
                        onOpenGroup={(id) => openPane({ kind: "group", id })}
                        onAddArea={handleAddArea}
                        onAddGroup={() => {
                          const name = window.prompt("Group name?")?.trim();
                          if (name) handleAddGroup(name);
                        }}
                        onAddProjectTo={(areaId) => handleAddProject(areaId)}
                        onAddGroupTo={(folderId) => {
                          const name = window.prompt("Group name?")?.trim();
                          if (name) handleAddGroup(name, folderId);
                        }}
                        onCollapseRail={() => setRailOpen(false)}
                      />
                    }
                  >
                    <Switch>
                      <Match when={!pane()}>
                        <div class="p-6 text-sm text-surface-txt-hint">
                          Select something in the sidebar, or add an Area,
                          Project, or Group to get started.
                        </div>
                      </Match>

                      <Match
                        when={
                          pane()?.kind === "folder" &&
                          folders().find(
                            (f) => f.id === pane()!.id && f.kind === "area",
                          )
                        }
                      >
                        {(area) => (
                          <div>
                            <div class="m-3 flex justify-end">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      `Delete "${area().name}" forever?`,
                                    )
                                  )
                                    return;
                                  await handleDeleteFolderForever(area().id);
                                  setPane(undefined);
                                }}
                                class="btn btn-sm border border-surface-alt3 text-danger"
                              >
                                Delete forever
                              </button>
                            </div>
                            <div class="mx-3 mb-3 max-w-2xl">
                              <AddBookmarkForm
                                folderId={area().id}
                                onAdded={refreshBookmarks}
                              />
                            </div>
                            <FolderPage
                              folder={area()}
                              breadcrumb={[]}
                              groups={() =>
                                groupsIn(area().id).map((g) => ({
                                  id: g.id,
                                  name: g.name,
                                  tabs: g.tabs,
                                  color: g.color ?? undefined,
                                  icon: g.icon ?? undefined,
                                }))
                              }
                              projects={() =>
                                childProjectsOf(area().id).map((p) => ({
                                  id: p.id,
                                  name: p.name,
                                }))
                              }
                              onOpenProject={(id) =>
                                openPane({ kind: "folder", id })
                              }
                              onOpenGroup={(id) =>
                                openPane({ kind: "group", id })
                              }
                              onAddGroup={() => {
                                const name = window
                                  .prompt("Group name?")
                                  ?.trim();
                                if (name) handleAddGroup(name, area().id);
                              }}
                            />
                          </div>
                        )}
                      </Match>

                      <Match
                        when={
                          pane()?.kind === "folder" &&
                          folders().find(
                            (f) => f.id === pane()!.id && f.kind === "project",
                          )
                        }
                      >
                        {(project) => (
                          <DetailPageShell
                            headerActions={
                              <button
                                type="button"
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      `Delete "${project().name}" forever?`,
                                    )
                                  )
                                    return;
                                  await handleDeleteFolderForever(project().id);
                                  setPane(undefined);
                                }}
                                class="btn btn-sm border border-surface-alt3 text-danger"
                              >
                                Delete forever
                              </button>
                            }
                          >
                            <h1 class="text-lg font-semibold">
                              {project().name}
                            </h1>
                            <AddBookmarkForm
                              folderId={project().id}
                              onAdded={refreshBookmarks}
                            />
                            <Show when={(project().tabs?.length ?? 0) > 0}>
                              <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                                <For each={project().tabs ?? []}>
                                  {(tab, i) => (
                                    <TabRow
                                      tab={tab}
                                      index={i()}
                                      selected={false}
                                      selectable={false}
                                      onToggle={() => {}}
                                      onOpen={() =>
                                        window.open(tab.url, "_blank")
                                      }
                                    />
                                  )}
                                </For>
                              </section>
                            </Show>
                            <GroupBoardPanel
                              groups={() =>
                                groupsIn(project().id).map((g) => ({
                                  id: g.id,
                                  name: g.name,
                                  status: g.status,
                                  tabCount: g.tabs.length,
                                }))
                              }
                              busy={false}
                              onActivate={handleActivateGroup}
                              onComplete={handleCompleteGroup}
                              onAddGroup={(name) =>
                                handleAddGroup(name, project().id)
                              }
                            />
                          </DetailPageShell>
                        )}
                      </Match>

                      <Match
                        when={
                          pane()?.kind === "group" &&
                          groups().find((g) => g.id === pane()!.id)
                        }
                      >
                        {(group) => (
                          <DetailPageShell
                            headerActions={
                              <button
                                type="button"
                                onClick={() => handleTrashGroup(group().id)}
                                class="btn btn-sm border border-surface-alt3"
                              >
                                Move to trash
                              </button>
                            }
                          >
                            <div class="flex items-center gap-2.5">
                              <GroupDot
                                group={{
                                  id: group().id,
                                  color: group().color ?? undefined,
                                  icon: group().icon ?? undefined,
                                }}
                              />
                              <h1 class="flex-1 text-lg font-semibold">
                                {group().name}
                              </h1>
                            </div>
                            <Show
                              when={group().tabs.length > 0}
                              fallback={
                                <p class="text-sm text-surface-txt-hint">
                                  No tabs in this group.
                                </p>
                              }
                            >
                              <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                                <For each={group().tabs}>
                                  {(tab, i) => (
                                    <TabRow
                                      tab={tab}
                                      index={i()}
                                      selected={false}
                                      selectable={false}
                                      onToggle={() => {}}
                                      onOpen={() =>
                                        window.open(tab.url, "_blank")
                                      }
                                    />
                                  )}
                                </For>
                              </section>
                            </Show>
                          </DetailPageShell>
                        )}
                      </Match>
                    </Switch>
                  </SidebarPaneShell>
                </Match>

                <Match when={nav() === "bookmarks"}>
                  <BookmarksPanel
                    bookmarks={() =>
                      resources()?.map((r) => ({
                        id: r.id,
                        url: r.url ?? undefined,
                        note: r.note ?? undefined,
                        folderId: r.folder_id ?? undefined,
                      })) ?? []
                    }
                    folderNameFor={(id) => folderNameFor(id ?? null)}
                    onDelete={async (id) => {
                      await deleteResource(id);
                      await refreshBookmarks();
                    }}
                  />
                </Match>

                <Match when={nav() === "timeline"}>
                  <TimelinePanel
                    archivedGroups={() => []}
                    archivedFolders={() => []}
                    onUnarchiveGroup={() => {}}
                    onUnarchiveFolder={() => {}}
                    sessions={sessions}
                    onRestoreSession={restoreSession}
                    proActive={proActive}
                  />
                </Match>

                <Match when={nav() === "plan"}>
                  <div class="p-6">
                    <div class="max-w-md">
                      <PlanPanel
                        maxWorkspaces={() => entitlements()?.maxWorkspaces}
                        groupCount={() => groups().length}
                        projectCount={() =>
                          folders().filter((f) => f.kind === "project").length
                        }
                        syncedCount={() => groups().length + folders().length}
                        accessExpiresAt={() => entitlements()?.accessExpiresAt}
                        hasBasicLicense={() =>
                          entitlements()?.hasBasicLicense ?? false
                        }
                        monthlyCheckoutUrl={creemMonthlyCheckoutUrl(
                          s().user.id,
                        )}
                        yearlyCheckoutUrl={creemYearlyCheckoutUrl(s().user.id)}
                        basicCheckoutUrl={creemBasicCheckoutUrl(s().user.id)}
                      />
                    </div>
                  </div>
                </Match>

                <Match when={nav() === "trash"}>
                  <TrashPanel
                    groups={() =>
                      trashedGroups().map((g) => ({
                        id: g.id,
                        name: g.name,
                        color: g.color ?? undefined,
                        icon: g.icon ?? undefined,
                        deletedAt: g.deleted_at
                          ? new Date(g.deleted_at).getTime()
                          : undefined,
                      }))
                    }
                    retentionDays={() => 7}
                    onRestore={handleRestoreGroup}
                    onDeleteForever={handleDeleteGroupForever}
                  />
                </Match>
              </Switch>
            </div>
          )}
        </Show>
      </Show>
    </Show>
  );
}

export default App;
