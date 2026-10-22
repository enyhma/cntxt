import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { useSupabaseSession } from "@cntxt/supabase";
import {
  BookmarksPanel,
  ConfigWarning,
  DetailHeader,
  DetailPageShell,
  FolderPage,
  GroupBoardPanel,
  GroupDot,
  PlanPanel,
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

type Selection =
  | { kind: "root" }
  | { kind: "folder"; id: string }
  | { kind: "group"; id: string };

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

  const [selection, setSelection] = createSignal<Selection>({ kind: "root" });

  const rootFolders = () => folders().filter((f) => f.parent_id === null);
  const standaloneGroups = () => groups().filter((g) => g.folder_id === null);
  const childProjectsOf = (areaId: string) =>
    folders().filter((f) => f.parent_id === areaId && f.kind === "project");
  const groupsIn = (folderId: string) =>
    groups().filter((g) => g.folder_id === folderId);
  const folderNameFor = (id: string | null) =>
    id ? folders().find((f) => f.id === id)?.name : undefined;

  async function handleAddArea() {
    const name = window.prompt("Area name?")?.trim();
    if (!name) return;
    await createArea(name);
    await refreshTree();
  }
  async function handleAddProject(parentId?: string) {
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
    setSelection({ kind: "root" });
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
                <nav class="flex items-center gap-3 text-sm">
                  <For
                    each={
                      [
                        "tree",
                        "bookmarks",
                        "timeline",
                        "plan",
                        "trash",
                      ] as Nav[]
                    }
                  >
                    {(n) => (
                      <button
                        type="button"
                        onClick={() => setNav(n)}
                        class={
                          "capitalize" +
                          (nav() === n
                            ? " font-medium text-surface-txt"
                            : " text-surface-txt-hint")
                        }
                      >
                        {n}
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
                  <Switch>
                    <Match when={selection().kind === "root"}>
                      <div class="p-6">
                        <div class="flex max-w-2xl flex-col gap-6">
                          <div class="flex items-center gap-2">
                            <h1 class="flex-1 text-lg font-semibold">
                              Your workspace
                            </h1>
                            <button
                              type="button"
                              onClick={handleAddArea}
                              class="btn btn-xs border border-surface-alt3"
                            >
                              + Area
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddProject()}
                              class="btn btn-xs border border-surface-alt3"
                            >
                              + Project
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const name = window
                                  .prompt("Group name?")
                                  ?.trim();
                                if (name) handleAddGroup(name);
                              }}
                              class="btn btn-xs border border-surface-alt3"
                            >
                              + Group
                            </button>
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <For each={rootFolders()}>
                              {(f) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelection({ kind: "folder", id: f.id })
                                  }
                                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                                >
                                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                                    {f.name}
                                  </span>
                                  <span class="font-mono text-[11px] text-surface-txt-faint">
                                    {f.kind === "area" ? "Area" : "Project"}
                                  </span>
                                </button>
                              )}
                            </For>
                            <For each={standaloneGroups()}>
                              {(g) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelection({ kind: "group", id: g.id })
                                  }
                                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                                >
                                  <GroupDot
                                    group={{
                                      id: g.id,
                                      color: g.color ?? undefined,
                                      icon: g.icon ?? undefined,
                                    }}
                                  />
                                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                                    {g.name}
                                  </span>
                                  <span class="font-mono text-[11px] text-surface-txt-faint">
                                    {g.tabs.length} tabs
                                  </span>
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>
                    </Match>

                    <Match
                      when={folders().find(
                        (f) =>
                          selection().kind === "folder" &&
                          f.id === (selection() as { id: string }).id &&
                          f.kind === "area",
                      )}
                    >
                      {(area) => (
                        <div>
                          <div class="m-3">
                            <DetailHeader
                              onBack={() => setSelection({ kind: "root" })}
                              actions={
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
                                    setSelection({ kind: "root" });
                                  }}
                                  class="btn btn-sm border border-surface-alt3 text-danger"
                                >
                                  Delete forever
                                </button>
                              }
                            />
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
                              setSelection({ kind: "folder", id })
                            }
                            onOpenGroup={(id) =>
                              setSelection({ kind: "group", id })
                            }
                            onAddGroup={() => {
                              const name = window.prompt("Group name?")?.trim();
                              if (name) handleAddGroup(name, area().id);
                            }}
                          />
                        </div>
                      )}
                    </Match>

                    <Match
                      when={folders().find(
                        (f) =>
                          selection().kind === "folder" &&
                          f.id === (selection() as { id: string }).id &&
                          f.kind === "project",
                      )}
                    >
                      {(project) => (
                        <DetailPageShell
                          onBack={() => setSelection({ kind: "root" })}
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
                                setSelection({ kind: "root" });
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
                      when={groups().find(
                        (g) =>
                          selection().kind === "group" &&
                          g.id === (selection() as { id: string }).id,
                      )}
                    >
                      {(group) => (
                        <DetailPageShell
                          onBack={() => setSelection({ kind: "root" })}
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
