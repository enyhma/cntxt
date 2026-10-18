import { useMachine } from "@xstate/solid";
import {
  type Accessor,
  type JSX,
  createEffect,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { ensureBindingForWindow } from "@/utils/attach";
import { restoreMachine } from "@/utils/restoreMachine";
import { groupSwapMachine } from "@/utils/groupSwapMachine";
import { syncMachine } from "@/utils/sync";
import {
  getWindowBindingMap,
  removeWindowBinding,
  type WindowBinding,
} from "@/utils/session";
import { closeMatchingTabs } from "@/utils/tabOps";
import { ensureLiveTabGroup, findOwnedGroupId } from "@/utils/tabGroups";
import { syncTabs } from "@/utils/windowSyncMachine";
import { activateGroupInProject } from "@/utils/groupActivation";
import { addTabGroupRule } from "@/utils/tabGroupRules";
import {
  type Settings,
  type StartupBehavior,
  type Theme,
  getSettings,
  updateSettings,
} from "@/utils/settings";
import { parseTokensFromRedirectUrl } from "@/utils/oauthRedirect";
import { supabase, supabaseConfigured } from "@/utils/supabase";
import { useSupabaseSession } from "@cntxt/supabase";
import { creemMonthlyCheckoutUrl, creemYearlyCheckoutUrl } from "@/utils/creem";
import { type Entitlements, refreshEntitlements } from "@/utils/entitlements";
import {
  AppWindow,
  ArrowRight,
  ArrowRightLeft,
  Bookmark as BookmarksIcon,
  ChevronDown,
  ChevronRight,
  FolderClosed as ProjectClosedIcon,
  FolderOpen as ProjectOpenIcon,
  FolderPlus,
  History as HistoryIcon,
  Layers as AreaIcon,
  Link as LinkIcon,
  type LucideProps,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  RefreshCw,
  Search,
  LayoutGrid as GroupsIcon,
  Settings as SettingsIcon,
  Trash2,
  TriangleAlert,
  Unplug,
  Workflow as AutomationsIcon,
  X,
} from "lucide-solid";
import {
  type Folder,
  archiveFolder,
  createFolder,
  deleteFolder,
  getFolders,
  reconcileFolderSyncStatus,
  unarchiveFolder,
  updateFolder,
} from "@/utils/folders";
import {
  type Resource,
  addResource,
  deleteResource,
  getResources,
  reconcileResourceSyncStatus,
} from "@/utils/resources";
import {
  type Group,
  archiveGroup,
  createGroup,
  deleteGroup,
  getGroups,
  permanentlyDeleteGroup,
  reconcileGroupSyncStatus,
  restoreGroup,
  trashRetentionDays,
  unarchiveGroup,
  updateGroup,
} from "@/utils/groups";
import { type Session, getSessions, restoreSession } from "@/utils/sessions";
import {
  type Automation,
  getAutomations,
  updateAutomation,
  deleteAutomation,
} from "@/utils/automations";
import {
  type ColorKey,
  COLOR_CLASS,
  COLOR_KEYS,
  ConfigWarning,
  ICON_NAMES,
  ICONS,
  Icon,
  type IconName,
  type IconNode,
  SettingsPanel,
  TabRow,
  TrashPanel,
  HistoryPanel,
  AutomationsPanel,
  type Automation as UiAutomation,
  FolderPage,
  GroupDot,
  GroupRow,
  GroupBoardPanel,
  groupColorKey,
  groupDotClass,
} from "@cntxt/ui";

function iconNodeToSvgString(node: IconNode, color: string): string {
  return node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${attrStr} stroke="${color}"/>`;
    })
    .join("");
}

// Resolves a `bg-*` utility class to its actual computed color so the
// favicon (a plain data URI, no Tailwind) can match the same dot color used
// throughout the UI — including per-theme overrides — without duplicating
// the palette's hex values here.
let colorProbe: HTMLDivElement | undefined;
function resolveDotColor(colorClass: string): string {
  if (!colorProbe) {
    colorProbe = document.createElement("div");
    colorProbe.style.display = "none";
    document.body.appendChild(colorProbe);
  }
  colorProbe.className = colorClass;
  return getComputedStyle(colorProbe).backgroundColor;
}

// A group with a chosen icon draws that icon (in its own dot color);
// otherwise falls back to the cntxt mark (open ring + caret) traced in that
// same color, so every window's pinned dashboard tab stays identifiable at
// a glance even without a custom icon set.
function faviconHrefFor(group: Group | undefined): string {
  const color = resolveDotColor(groupDotClass(group));
  const icon = group?.icon as IconName | undefined;
  const svg = icon
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconNodeToSvgString(ICONS[icon], color)}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32"><path d="M 77.58 73.15 A 36 36 0 1 1 77.58 26.85" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/><rect x="74" y="40" width="8" height="20" rx="4" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A global-navbar search result to hand off into Dashboard's own view
// state (see its jumpTo prop) — "area" targets a folder page, the other two
// target the same views their sidebar rows do.
type JumpTarget =
  | { kind: "group"; id: string }
  | { kind: "project"; id: string }
  | { kind: "area"; id: string };

// Every tab currently open for a Project: its own base tabs, plus every
// live (pending or active, not done) child Group's own tabs — everything
// that opens together when connecting to this Project. Mirrors
// utils/projectLiveTabs.ts's liveChildGroups, but as a pure read over
// already-loaded data rather than storage. Module-level (not a
// Dashboard-local closure) so the global navbar's search can use it too,
// without depending on Dashboard being mounted.
function projectLiveTabs(project: Folder, groups: Group[]) {
  const own = project.tabs ?? [];
  const child = groups
    .filter(
      (g) =>
        g.folderId === project.id &&
        !g.deletedAt &&
        !g.archivedAt &&
        g.status !== "done",
    )
    .flatMap((g) => g.tabs);
  return [...own, ...child];
}
function projectLiveTabCount(project: Folder, groups: Group[]) {
  return projectLiveTabs(project, groups).length;
}

function closeOpenDropdowns() {
  document
    .querySelectorAll<HTMLDetailsElement>("details.dropdown[open]")
    .forEach((d) => d.removeAttribute("open"));
}

// "automations" and "bookmarks" are experimental — gated out of this list
// at render time unless Settings' experimentalFeaturesEnabled is on (see
// the NAV_ITEMS.filter call site).
const NAV_ITEMS: Array<{
  key:
    "groups" | "trash" | "history" | "automations" | "bookmarks" | "settings";
  label: string;
  icon: (props: LucideProps) => JSX.Element;
}> = [
  { key: "groups", label: "Tabs", icon: GroupsIcon },
  { key: "trash", label: "Trash", icon: Trash2 },
  { key: "history", label: "History", icon: HistoryIcon },
  { key: "automations", label: "Shortcuts", icon: AutomationsIcon },
  { key: "bookmarks", label: "Bookmarks", icon: BookmarksIcon },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

const EXPERIMENTAL_NAV_KEYS = new Set(["automations", "bookmarks"]);

// Area (depth 0, parentId null) / Project (depth 1, parentId an Area) — see
// supabase/migrations/20261005130000_folders.sql for why both tiers share
// one component instead of two. Collapse state isn't persisted: reopening
// the dashboard with everything expanded is the simpler default, and
// nothing here is expensive enough to earn remembering it.
function FolderHeader(props: {
  folder: Folder;
  depth: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
  editing: boolean;
  editingValue: string;
  onEditingInput: (v: string) => void;
  onCommitRename: () => void;
  onAddGroup?: () => void;
  onAddProject?: () => void;
  // Rename and delete live in a right-click context menu (see
  // folderContextMenu in Dashboard) rather than inline icons here — this
  // callback is how a row reports where it was right-clicked.
  onContextMenu: (e: MouseEvent) => void;
  // Project-only: the same connect/switch/disconnect affordance a Group
  // row has (GroupRow.tsx) — a Project is window-bound too (see
  // attach.ts's ensureBindingForWindow), so it needs a way to open its own
  // tabs into the current window without going through its folder page.
  isCurrent?: boolean;
  openElsewhere?: boolean;
  anyActive?: boolean;
  busy?: boolean;
  onOpenAll?: () => void;
}) {
  const canSwitch = () =>
    !!props.onOpenAll && !props.isCurrent && !props.openElsewhere;
  return (
    <div
      onDblClick={() => canSwitch() && !props.busy && props.onOpenAll?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(e);
      }}
      data-tip={canSwitch() ? "Double-click to switch" : undefined}
      class={
        "group flex items-center gap-1 rounded py-1.5 pr-1.5" +
        (props.active ? " bg-surface-alt2" : "") +
        (canSwitch() ? " tooltip" : "")
      }
      style={{ "padding-left": `${0.5 + props.depth * 0.875}rem` }}
    >
      <button
        type="button"
        onClick={props.onToggle}
        class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint"
      >
        <ChevronRight
          size={11}
          class={"transition-transform" + (props.expanded ? " rotate-90" : "")}
        />
      </button>
      <Show
        when={props.folder.kind === "area"}
        fallback={
          <Show
            when={props.active}
            fallback={
              <ProjectClosedIcon
                size={12}
                class="shrink-0 text-surface-txt-faint"
              />
            }
          >
            <ProjectOpenIcon
              size={12}
              class="shrink-0 text-surface-txt-faint"
            />
          </Show>
        }
      >
        <AreaIcon size={12} class="shrink-0 text-surface-txt-faint" />
      </Show>
      <Show
        when={!props.editing}
        fallback={
          <input
            autofocus
            class="input input-xs min-w-0 flex-1 bg-surface-alt2"
            value={props.editingValue}
            onInput={(e) => props.onEditingInput(e.currentTarget.value)}
            onBlur={props.onCommitRename}
            onKeyDown={(e) => e.key === "Enter" && props.onCommitRename()}
          />
        }
      >
        <span
          onClick={props.onOpen}
          class={
            "min-w-0 flex-1 cursor-pointer truncate text-[12px] font-semibold tracking-wide" +
            (props.active ? " text-surface-txt" : " text-surface-txt-hint")
          }
        >
          {props.folder.name}
        </span>
      </Show>
      <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <Show when={props.onAddProject}>
          <button
            type="button"
            title="New project"
            onClick={props.onAddProject}
            class="btn btn-square btn-ghost btn-xs text-surface-txt-hint"
          >
            <FolderPlus size={11} />
          </button>
        </Show>
        <Show when={props.onAddGroup}>
          <button
            type="button"
            title="New group"
            onClick={props.onAddGroup}
            class="btn btn-square btn-ghost btn-xs text-surface-txt-hint"
          >
            <Plus size={11} />
          </button>
        </Show>
        <Show when={props.onOpenAll && props.openElsewhere}>
          <span title="Open elsewhere" class="shrink-0">
            <AppWindow size={11} class="text-surface-txt-faint" />
          </span>
        </Show>
      </div>
    </div>
  );
}

function Dashboard(props: {
  groups: Accessor<Group[]>;
  folders: Accessor<Folder[]>;
  resources: Accessor<Resource[]>;
  currentId: Accessor<string | undefined>;
  openIds: Accessor<Set<string>>;
  myWindowId: Accessor<number | undefined>;
  entitlements: Accessor<Entitlements | undefined>;
  refresh: () => Promise<void>;
  restoreState: ReturnType<typeof useMachine<typeof restoreMachine>>[0];
  restoreSend: ReturnType<typeof useMachine<typeof restoreMachine>>[1];
  groupSwapState: ReturnType<typeof useMachine<typeof groupSwapMachine>>[0];
  groupSwapSend: ReturnType<typeof useMachine<typeof groupSwapMachine>>[1];
  jumpTo: Accessor<JumpTarget | undefined>;
  onJumped: () => void;
  experimentalFeaturesEnabled: Accessor<boolean>;
}) {
  const {
    groups,
    folders,
    resources,
    experimentalFeaturesEnabled,
    currentId,
    openIds,
    myWindowId,
    entitlements,
    refresh,
    restoreState,
    restoreSend,
    groupSwapState,
    groupSwapSend,
  } = props;

  // Advisory only — a stale or missing cache never blocks anything by
  // itself, it just gates whether this button offers to try. See
  // docs/architecture-sync.md → "Entitlements".
  const atGroupLimit = () => {
    const max = entitlements()?.maxMissions;
    return max !== undefined && groups().length >= max;
  };

  const [railOpen, setRailOpen] = createSignal(true);
  const [viewedId, setViewedId] = createSignal<string>();
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(
    new Set(),
  );
  const [editingFolderId, setEditingFolderId] = createSignal<string>();
  const [editingFolderName, setEditingFolderName] = createSignal("");
  // Shared by both FolderHeader and GroupRow rows — each right-click
  // builds its own item list (rename/delete mean different things, and
  // target different entities, for a folder vs. a group).
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
    items: {
      label: string;
      onClick: () => void;
      tone?: "warning" | "danger";
    }[];
  }>();
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  let customizeRef: HTMLDialogElement | undefined;

  // Set when the sidebar's FolderHeader *name* (not its chevron) is
  // clicked — the main pane shows that folder's own page instead of a
  // group's tabs until something navigates back to a group.
  const [viewingFolderId, setViewingFolderId] = createSignal<string>();
  const viewingFolder = () => folders().find((f) => f.id === viewingFolderId());

  // Set via a Project's "Project tabs" entry point (its FolderPage header
  // button, or its sidebar row's connect affordance) — the main pane shows
  // that Project's own live tabs instead of a group's or a folder page
  // until something navigates elsewhere.
  const [viewedProjectId, setViewedProjectId] = createSignal<string>();
  const viewedProject = () => folders().find((f) => f.id === viewedProjectId());

  onMount(() => {
    try {
      const stored = localStorage.getItem("cntxt.railOpen");
      if (stored !== null) setRailOpen(stored === "1");
    } catch {
      // localStorage can throw in some extension contexts; default stands.
    }
  });

  onMount(() => {
    // Not listening for "contextmenu" here: a row's own onContextMenu sets
    // this same state, and since that event bubbles to the document too, a
    // generic contextmenu-closes-it listener would immediately undo the
    // open it just caused.
    const close = () => setContextMenu(undefined);
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", closeOnEscape);
    onCleanup(() => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", closeOnEscape);
    });
  });

  // Seed the initially-viewed group from this window's group once
  // it resolves, without fighting later manual browsing (viewed() isn't a
  // dependency here, just read via untrack).
  createEffect(() => {
    const id = currentId();
    if (id && untrack(viewedId) === undefined) setViewedId(id);
  });

  // Any storage tab data shown for a *saved* (non-open) group goes
  // stale the moment you switch which group you're looking at, so
  // selection indices reset on every view change.
  createEffect(() => {
    viewedId();
    setSelected(new Set<number>());
  });

  const viewed = () => groups().find((w) => w.id === viewedId());
  const isViewingCurrent = () =>
    viewedId() !== undefined && viewedId() === currentId();
  const busy = () =>
    !restoreState.matches("idle") || !groupSwapState.matches("idle");

  // Whichever Project or Group is actually live in this window right now —
  // used by the connect/switch buttons (on both a Group's and a Project's
  // header) to know what they'd be replacing, regardless of which kind it
  // currently is. (`current`, a prop, stays Group-only — it's only used for
  // the document title/favicon.)
  const currentThing = (): { name: string } | undefined =>
    groups().find((w) => w.id === currentId()) ??
    folders().find((f) => f.id === currentId());

  // Whether a group belongs to a Project — used to tell a standalone group
  // (no sibling roster, completes via restoreMachine) apart from a
  // Project-nested one (completes/reactivates via groupSwapMachine, from
  // the Project's own roadmap board, not from the group's own view).
  function projectOf(folderId: string | null | undefined) {
    const folder = folderId
      ? folders().find((f) => f.id === folderId)
      : undefined;
    return folder?.kind === "project" ? folder : undefined;
  }

  function setRail(v: boolean) {
    try {
      localStorage.setItem("cntxt.railOpen", v ? "1" : "0");
    } catch {
      // best-effort persistence only
    }
    setRailOpen(v);
  }

  function openAll(group: Group) {
    restoreSend({ type: "RESTORE", target: { kind: "group", group } });
    showGroup(group.id);
  }

  // A group's *live* tabs (the one mapped to this window) are the
  // source of truth for the real browser window, re-synced on every tab
  // event by windowSyncMachine — editing that array in storage would
  // just be overwritten on the next sync. So a click on one of its rows
  // jumps to the real tab instead of "selecting" it, and only saved
  // (non-open) groups support the multi-select/move flow below.
  async function focusRealTab(url: string) {
    const windowId = myWindowId();
    if (windowId === undefined) return;
    const tabs = await browser.tabs.query({ windowId });
    const tab = tabs.find((t) => t.url === url);
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(windowId, { focused: true });
    }
  }

  function toggleSelected(index: number) {
    const next = new Set(selected());
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  }

  async function moveSelectedTo(targetId: string) {
    const source = viewed();
    const idxs = selected();
    if (!source || idxs.size === 0) return;
    const moved = source.tabs.filter((_, i) => idxs.has(i));
    const remaining = source.tabs.filter((_, i) => !idxs.has(i));
    await updateGroup(source.id, { tabs: remaining });

    if (targetId === currentId() && myWindowId() !== undefined) {
      for (const tab of moved) {
        await browser.tabs.create({ windowId: myWindowId(), url: tab.url });
      }
    } else {
      const target = groups().find((w) => w.id === targetId);
      if (target)
        await updateGroup(targetId, { tabs: [...target.tabs, ...moved] });
    }
    setSelected(new Set<number>());
    await refresh();
  }

  async function handleAddGroup() {
    const group = await createGroup("Untitled group", []);
    await refresh();
    showGroup(group.id);
  }

  // Areas only — a standalone/ad-hoc Project also has parentId null (see
  // attach.ts), so filtering on parentId alone would double-list it here
  // *and* again via standaloneProjects() below, everywhere this is used.
  const rootFolders = () => folders().filter((f) => f.kind === "area");
  const childFolders = (parentId: string) =>
    folders().filter((f) => f.parentId === parentId);
  const groupsIn = (folderId: string) =>
    groups().filter((w) => w.folderId === folderId);
  const ungroupedGroups = () => groups().filter((w) => !w.folderId);

  // Navigating to a group always leaves folder view and any Project
  // tabs view, whichever of the several entry points (sidebar row, command
  // palette, a Project page's group list, creating a new one) got you here.
  function showGroup(id: string) {
    setViewingFolderId(undefined);
    setViewedProjectId(undefined);
    setViewedId(id);
  }

  function showProjectTabs(id: string) {
    setViewingFolderId(undefined);
    setViewedProjectId(id);
  }
  function openProject(project: Folder) {
    restoreSend({ type: "RESTORE", target: { kind: "project", project } });
    showProjectTabs(project.id);
  }

  // The global navbar's search lives in App(), outside this component (so
  // it works from the Trash/Settings tabs too, where Dashboard isn't even
  // mounted) — it hands off a selected result via this prop instead of
  // calling showGroup/showProjectTabs/setViewingFolderId directly. Reacts
  // whether Dashboard was already mounted or just mounted because of this
  // jump, since it's a plain effect over the prop's value.
  createEffect(() => {
    const target = props.jumpTo();
    if (!target) return;
    if (target.kind === "group") showGroup(target.id);
    else if (target.kind === "project") showProjectTabs(target.id);
    else setViewingFolderId(target.id);
    props.onJumped();
  });

  function viewingFolderBreadcrumb(): Array<{ id: string; name: string }> {
    const folder = viewingFolder();
    if (!folder?.parentId) return [];
    const parent = folders().find((f) => f.id === folder.parentId);
    return parent ? [{ id: parent.id, name: parent.name }] : [];
  }

  // Areas-then-their-Projects, each tagged with its indent depth — for the
  // "Move to folder" flat picker in the header's dropdown, which doesn't
  // need the full collapsible tree the rail renders.
  function flattenedFolders(): Array<{ folder: Folder; depth: number }> {
    const out: Array<{ folder: Folder; depth: number }> = [];
    for (const area of rootFolders()) {
      out.push({ folder: area, depth: 0 });
      for (const project of childFolders(area.id)) {
        out.push({ folder: project, depth: 1 });
      }
    }
    return out;
  }

  async function handleMoveToFolder(folderId: string | null) {
    const id = viewedId();
    if (!id) return;
    await updateGroup(id, { folderId });
    await refresh();
    closeOpenDropdowns();
  }

  // Every Project, nested-under-an-Area or standalone, with its Area's
  // name as context where it has one — for the "Save to project" picker on
  // a resource row.
  function flattenedProjects(): Array<{
    project: Folder;
    areaName?: string;
  }> {
    const out: Array<{ project: Folder; areaName?: string }> = [];
    for (const area of rootFolders()) {
      for (const project of childFolders(area.id)) {
        out.push({ project, areaName: area.name });
      }
    }
    for (const project of standaloneProjects()) {
      out.push({ project });
    }
    return out;
  }

  // Copies (not moves — see the type comment on Resource in utils/resources.ts)
  // a Group-scoped resource onto its Project, so it survives that Group
  // being deleted.
  async function handleSaveResourceToProject(
    resource: Resource,
    folderId: string,
  ) {
    await addResource({ folderId }, { url: resource.url, note: resource.note });
    await refresh();
    closeOpenDropdowns();
  }

  function toggleExpanded(id: string) {
    const next = new Set(expandedFolders());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolders(next);
  }

  function startRenameFolder(folder: Folder) {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }
  async function commitRenameFolder() {
    const id = editingFolderId();
    const trimmed = editingFolderName().trim();
    setEditingFolderId(undefined);
    if (!id || !trimmed) return;
    await updateFolder(id, { name: trimmed });
    await refresh();
  }

  async function handleAddArea() {
    const folder = await createFolder("Untitled area", null, "area");
    setExpandedFolders(new Set(expandedFolders()).add(folder.id));
    await refresh();
    startRenameFolder(folder);
  }
  async function handleAddProject(parentId: string) {
    const folder = await createFolder("Untitled project", parentId, "project");
    setExpandedFolders(new Set(expandedFolders()).add(parentId).add(folder.id));
    await refresh();
    startRenameFolder(folder);
  }
  // A brand-new group has no tabs yet, so there's nothing for
  // ensureLiveTabGroup to group on its own — give it one blank tab so it
  // actually shows up as a native tab group right away, if the Project it
  // just landed in is the one this window is currently connected to. One
  // final syncTabs call (restoreMachine.ts's own pattern for the same
  // race) overwrites whatever a mid-sequence live-sync pass wrote, so the
  // blank tab lands on the new group, not the Project's own tab list.
  //
  // Then hand off to activateGroupInProject (groupActivation.ts) to mark
  // it "active" and demote whatever sibling was active before — this
  // group is already expanded natively (collapsed: false above), and
  // leaving it un-"active" locally breaks the invariant every other
  // activation path maintains: background.ts's tabGroups.onUpdated
  // listener reads "expanded but not active" as "the user just expanded a
  // previously-collapsed group" and re-activates on the very next
  // unrelated native update (e.g. renaming it), which re-pushes this
  // group's own stored name back onto the native tab group and reverts
  // whatever was just typed.
  async function revealNewGroupTab(group: Group, project: Folder) {
    const windowId = myWindowId();
    if (project.id !== currentId() || windowId === undefined) return;
    const tab = await browser.tabs.create({ windowId });
    if (tab.id === undefined) return;
    await ensureLiveTabGroup(
      windowId,
      {
        table: "groups",
        id: group.id,
        name: group.name,
        color: group.color as ColorKey | undefined,
        collapsed: false,
      },
      [tab.id],
    );
    await syncTabs(windowId);
    const refreshed = (await getGroups()).find((g) => g.id === group.id);
    if (refreshed) await activateGroupInProject(windowId, project, refreshed);
  }

  async function handleAddGroupIn(folderId: string) {
    const group = await createGroup("Untitled group", []);
    await updateGroup(group.id, { folderId });
    const folder = folders().find((f) => f.id === folderId);
    if (folder?.kind === "project") {
      await revealNewGroupTab(group, folder);
    }
    await refresh();
    showGroup(group.id);
  }
  async function handleDeleteFolder(folder: Folder): Promise<boolean> {
    const hasChildren = folders().some((f) => f.parentId === folder.id);
    const warning = hasChildren
      ? `Delete "${folder.name}" and the projects inside it? Groups stay — they'll just be ungrouped.`
      : `Delete "${folder.name}"? Any groups inside stay — they'll just be ungrouped.`;
    if (!confirm(warning)) return false;
    await deleteFolder(folder.id);
    await refresh();
    return true;
  }
  async function handleDeleteViewedProject() {
    const project = viewedProject();
    if (!project) return;
    if (await handleDeleteFolder(project)) setViewedProjectId(undefined);
    closeOpenDropdowns();
  }

  async function handleArchiveFolder(folder: Folder) {
    await archiveFolder(folder.id);
    await refresh();
  }

  function folderContextMenuItems(folder: Folder, isCurrent = false) {
    return [
      { label: "Rename", onClick: () => startRenameFolder(folder) },
      ...(isCurrent
        ? [
            {
              label: "Disconnect",
              tone: "warning" as const,
              onClick: handleDisconnectWindow,
            },
          ]
        : []),
      // No confirm() — archiving is reversible, unlike Delete. Allowed even
      // on the currently-open/bound folder; doesn't close its window (known,
      // accepted minor wrinkle).
      { label: "Archive", onClick: () => handleArchiveFolder(folder) },
      {
        label: "Delete",
        tone: "danger" as const,
        onClick: () => handleDeleteFolder(folder),
      },
    ];
  }

  const [addingResource, setAddingResource] = createSignal(false);
  const [resourceUrl, setResourceUrl] = createSignal("");
  const [resourceNote, setResourceNote] = createSignal("");

  function openAddResource() {
    setResourceUrl("");
    setResourceNote("");
    setAddingResource(true);
  }
  async function handleDeleteResource(id: string) {
    await deleteResource(id);
    await refresh();
  }

  const resourcesForProject = () =>
    resources().filter((r) => r.folderId === viewedProjectId());

  async function handleAddResourceToProject(e: Event) {
    e.preventDefault();
    const id = viewedProjectId();
    const url = resourceUrl().trim();
    const note = resourceNote().trim();
    setAddingResource(false);
    if (!id || (!url && !note)) return;
    await addResource(
      { folderId: id },
      { url: url || undefined, note: note || undefined },
    );
    await refresh();
  }

  const resourcesForArea = () =>
    resources().filter((r) => r.folderId === viewingFolderId());

  async function handleAddResourceToArea(e: Event) {
    e.preventDefault();
    const id = viewingFolderId();
    const url = resourceUrl().trim();
    const note = resourceNote().trim();
    setAddingResource(false);
    if (!id || (!url && !note)) return;
    await addResource(
      { folderId: id },
      { url: url || undefined, note: note || undefined },
    );
    await refresh();
  }

  // Shared between a Project's bookmarks panel and an Area's — same row
  // shape either way (a link/note, a "Save to project" copy picker, and a
  // delete button).
  function resourceRow(r: Resource) {
    return (
      <div class="group flex items-center gap-2.5 border-b border-surface-alt2 px-3.5 py-2.5 last:border-b-0">
        <LinkIcon size={13} class="shrink-0 text-surface-txt-faint" />
        <Show
          when={r.url}
          fallback={
            <span class="min-w-0 flex-1 truncate text-sm">{r.note}</span>
          }
        >
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            class="min-w-0 flex-1 truncate text-sm hover:underline"
          >
            {r.note || r.url}
          </a>
        </Show>
        <Show when={r.note && r.url}>
          <span class="max-w-[30%] shrink-0 truncate font-mono text-[11px] text-surface-txt-faint">
            {r.url}
          </span>
        </Show>
        <Show when={flattenedProjects().length > 0}>
          <details class="dropdown dropdown-end shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <summary
              title="Save to project"
              class="btn btn-square btn-ghost btn-xs list-none text-surface-txt-hint"
            >
              <FolderPlus size={12} />
            </summary>
            <ul class="dropdown-content menu z-50 mt-1 w-52 gap-0.5 rounded border border-surface-alt4 bg-surface-alt2 p-1.25 shadow-[var(--shadow-dropdown)]">
              <For each={flattenedProjects()}>
                {({ project, areaName }) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => handleSaveResourceToProject(r, project.id)}
                    >
                      <span class="truncate">{project.name}</span>
                      <Show when={areaName}>
                        <span class="shrink-0 font-mono text-[10px] text-surface-txt-faint">
                          {areaName}
                        </span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>
        <button
          type="button"
          title="Remove"
          onClick={() => handleDeleteResource(r.id)}
          class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  // A Project's sidebar block: its own FolderHeader row (with the
  // connect/switch/disconnect affordance, since it's window-bound too) plus
  // its child Groups. Used both for a Project nested under an Area
  // (depth 1) and for a standalone, ad-hoc Project (depth 0, see
  // standaloneProjects below) — same structure either way.
  function projectBlock(project: Folder, depth: number) {
    return (
      <>
        <FolderHeader
          folder={project}
          depth={depth}
          expanded={expandedFolders().has(project.id)}
          active={viewedProjectId() === project.id}
          onToggle={() => toggleExpanded(project.id)}
          onOpen={() => showProjectTabs(project.id)}
          editing={editingFolderId() === project.id}
          editingValue={editingFolderName()}
          onEditingInput={setEditingFolderName}
          onCommitRename={commitRenameFolder}
          onAddGroup={() => handleAddGroupIn(project.id)}
          onContextMenu={(e) =>
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: folderContextMenuItems(
                project,
                project.id === currentId(),
              ),
            })
          }
          isCurrent={project.id === currentId()}
          openElsewhere={
            project.id !== currentId() && openIds().has(project.id)
          }
          anyActive={currentId() !== undefined}
          busy={busy()}
          onOpenAll={() => openProject(project)}
        />
        <Show when={expandedFolders().has(project.id)}>
          <For each={groupsIn(project.id)}>
            {(w) => groupRowFor(w, depth + 1)}
          </For>
        </Show>
      </>
    );
  }

  const standaloneProjects = () =>
    folders().filter((f) => f.kind === "project" && !f.parentId);

  function groupRowFor(w: Group, depth = 0) {
    return (
      <div
        style={depth ? { "padding-left": `${depth * 0.875}rem` } : undefined}
      >
        <GroupRow
          group={w}
          count={w.tabs.length}
          isViewed={w.id === viewedId()}
          isCurrent={w.id === currentId()}
          openElsewhere={w.id !== currentId() && openIds().has(w.id)}
          anyActive={currentId() !== undefined}
          busy={busy()}
          onView={() => showGroup(w.id)}
          onOpenAll={() => openAll(w)}
          onContextMenu={(e) =>
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: groupContextMenuItems(w, w.id === currentId()),
            })
          }
        />
      </div>
    );
  }

  async function handleDeleteViewed() {
    const group = viewed();
    if (!group) return;
    await handleDeleteGroup(group);
    closeOpenDropdowns();
  }

  async function handleDeleteGroup(group: Group) {
    if (!confirm(`Delete "${group.name}"?`)) return;

    // Close whatever's actually open for this group in the browser, same
    // window this dashboard is running in — a deleted group shouldn't
    // leave its tabs sitting open with nothing left to point at them.
    // Only handles this window (matches the rest of the group-activation
    // code's own scope, e.g. groupActivation.ts) — a window elsewhere
    // isn't reachable from here.
    const windowId = myWindowId();
    if (windowId !== undefined) {
      if (group.id === currentId()) {
        // Standalone: this whole window is bound to the group being
        // deleted — close everything and detach, same as Disconnect.
        await closeMatchingTabs(windowId, () => true);
        await removeWindowBinding(windowId);
      } else if (group.folderId && group.folderId === currentId()) {
        // Nested under the Project connected to this window: close only
        // this group's own tabs, same as Complete group — the Project
        // and its other live siblings stay open.
        const urls = new Set(group.tabs.map((t) => t.url));
        await closeMatchingTabs(windowId, (tab) => urls.has(tab.url ?? ""));
      }
    }

    await deleteGroup(group.id);
    if (viewedId() === group.id) setViewedId(currentId());
    await refresh();
  }

  // Teaches a rule from the group's CURRENT mirrored native group (see
  // utils/tabGroups.ts's ensureLiveTabGroup) — only meaningful while that
  // group still exists, hence the "isn't showing as a live tab group right
  // now" guard below rather than silently writing an empty/useless rule.
  async function handleTeachRule(group: Group) {
    closeOpenDropdowns();
    if (!group.folderId) return;
    const groupId = await findOwnedGroupId({ table: "groups", id: group.id });
    if (groupId === undefined) {
      alert("This group isn't showing as a live tab group right now.");
      return;
    }
    try {
      // The *native* browser tab group's own title/color — distinct from
      // the outer `group` (Group entity) param this rule is filed against.
      const nativeGroup = await browser.tabGroups.get(groupId);
      await addTabGroupRule({
        matchTitle: nativeGroup.title || undefined,
        matchColor: nativeGroup.color,
        folderId: group.folderId,
      });
    } catch {
      alert("Couldn't read that tab group — try again while it's open.");
    }
  }

  async function handleArchiveGroup(group: Group) {
    await archiveGroup(group.id);
    await refresh();
  }

  function groupContextMenuItems(group: Group, isCurrent = false) {
    return [
      {
        label: "Rename",
        onClick: () => {
          showGroup(group.id);
          startRename();
        },
      },
      ...(group.folderId
        ? [
            {
              label: "Always file groups like this here",
              onClick: () => handleTeachRule(group),
            },
          ]
        : []),
      ...(isCurrent
        ? [
            {
              label: "Disconnect",
              tone: "warning" as const,
              onClick: handleDisconnectWindow,
            },
          ]
        : []),
      // No confirm() — archiving is reversible, unlike Delete. Allowed even
      // on the currently-open group; doesn't close its window (known,
      // accepted minor wrinkle).
      { label: "Archive", onClick: () => handleArchiveGroup(group) },
      {
        label: "Delete",
        tone: "danger" as const,
        onClick: () => handleDeleteGroup(group),
      },
    ];
  }

  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");
  function startRename() {
    setRenameValue(viewed()?.name ?? "");
    setRenaming(true);
    closeOpenDropdowns();
  }
  async function commitRename() {
    const id = viewedId();
    const trimmed = renameValue().trim();
    setRenaming(false);
    if (!id || !trimmed) return;
    await updateGroup(id, { name: trimmed });
    await refresh();
  }

  function openCustomize() {
    closeOpenDropdowns();
    customizeRef?.showModal();
  }
  function closeCustomize() {
    customizeRef?.close();
  }
  async function handleSetColor(color: ColorKey) {
    const id = viewedId();
    if (!id) return;
    await updateGroup(id, { color });
    await refresh();
  }
  async function handleSetIcon(icon: IconName | undefined) {
    const id = viewedId();
    if (!id) return;
    await updateGroup(id, { icon });
    await refresh();
  }

  async function handleCloseAllTabs() {
    restoreSend({ type: "CLOSE_TABS" });
    closeOpenDropdowns();
  }

  // Detaches this window from its group *before* closing its tabs (see
  // restoreMachine's DISCONNECT), so windowSyncMachine's syncTabs
  // no-ops on those closures instead of autosaving them — unlike
  // handleCloseAllTabs, the group's saved tab list is left untouched.
  function handleDisconnectWindow() {
    restoreSend({ type: "DISCONNECT" });
    closeOpenDropdowns();
  }

  // Standalone-group counterpart to groupSwapMachine's COMPLETE_GROUP: a
  // group with no Project parent has no sibling roster to auto-advance
  // into, so this just detaches + closes (restoreMachine.COMPLETE_GROUP)
  // and marks it done — reopenable later via an ordinary Restore.
  function handleCompleteGroupStandalone() {
    const group = viewed();
    if (group) restoreSend({ type: "COMPLETE_GROUP", group });
    closeOpenDropdowns();
  }

  return (
    <>
      <div class="flex min-h-0 flex-1 items-stretch overflow-hidden">
        <Show when={railOpen()}>
          <nav class="flex w-60 shrink-0 flex-col border-r border-surface-alt2 bg-surface-alt1">
            <div class="flex h-11 shrink-0 items-center gap-2 border-b border-surface-alt2 pr-2.5 pl-3.5">
              <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
                AREAS
              </span>
              <button
                type="button"
                title="New area"
                onClick={handleAddArea}
                class="btn btn-square btn-ghost btn-xs"
              >
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                title={
                  atGroupLimit()
                    ? "You've hit your plan's limit — this group won't sync until you upgrade"
                    : undefined
                }
                onClick={handleAddGroup}
                class={
                  "btn btn-square btn-ghost btn-xs" +
                  (atGroupLimit() ? " text-warning" : "")
                }
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                title="Collapse"
                onClick={() => setRail(false)}
                class="btn btn-square btn-ghost btn-xs border border-surface-alt3"
              >
                <PanelLeftClose size={13} />
              </button>
            </div>
            <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
              <For each={rootFolders()}>
                {(area) => (
                  <>
                    <FolderHeader
                      folder={area}
                      depth={0}
                      expanded={expandedFolders().has(area.id)}
                      active={viewingFolderId() === area.id}
                      onToggle={() => toggleExpanded(area.id)}
                      onOpen={() => setViewingFolderId(area.id)}
                      editing={editingFolderId() === area.id}
                      editingValue={editingFolderName()}
                      onEditingInput={setEditingFolderName}
                      onCommitRename={commitRenameFolder}
                      onAddProject={() => handleAddProject(area.id)}
                      onAddGroup={() => handleAddGroupIn(area.id)}
                      onContextMenu={(e) =>
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          items: folderContextMenuItems(area),
                        })
                      }
                    />
                    <Show when={expandedFolders().has(area.id)}>
                      <For each={childFolders(area.id)}>
                        {(project) => projectBlock(project, 1)}
                      </For>
                      <For each={groupsIn(area.id)}>
                        {(w) => groupRowFor(w, 1)}
                      </For>
                    </Show>
                  </>
                )}
              </For>
              <Show when={standaloneProjects().length > 0}>
                <div class="mt-1 px-2 py-1 font-mono text-[10px] tracking-wider text-surface-txt-faint">
                  PROJECTS
                </div>
                <For each={standaloneProjects()}>
                  {(p) => projectBlock(p, 0)}
                </For>
              </Show>
              <Show
                when={rootFolders().length > 0 && ungroupedGroups().length > 0}
              >
                <div class="mt-1 px-2 py-1 font-mono text-[10px] tracking-wider text-surface-txt-faint">
                  UNGROUPED
                </div>
              </Show>
              <For each={ungroupedGroups()}>{(w) => groupRowFor(w)}</For>
            </div>
          </nav>
        </Show>

        <main class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="sticky top-0 z-30 flex h-13 min-w-0 shrink-0 items-center gap-2 border-b border-surface-alt2 bg-surface px-3.5">
            <Show when={!railOpen()}>
              <button
                type="button"
                title="Expand rail"
                onClick={() => setRail(true)}
                class="btn btn-square btn-ghost btn-sm shrink-0 border border-surface-alt3"
              >
                <PanelLeftOpen size={14} />
              </button>
            </Show>

            <Show when={viewingFolderId()}>
              <span class="flex-1 truncate text-sm font-semibold">
                {viewingFolder()?.name}
              </span>
            </Show>

            <Show when={!viewingFolderId() && viewedProject()}>
              <Show
                when={editingFolderId() !== viewedProject()!.id}
                fallback={
                  <input
                    autofocus
                    class="input input-sm w-48 bg-surface-alt1"
                    value={editingFolderName()}
                    onInput={(e) => setEditingFolderName(e.currentTarget.value)}
                    onBlur={commitRenameFolder}
                    onKeyDown={(e) => e.key === "Enter" && commitRenameFolder()}
                  />
                }
              >
                <span class="flex-1 truncate text-sm font-semibold">
                  {viewedProject()?.name}
                </span>
              </Show>
              <span class="font-mono text-[11px] text-surface-txt-faint">
                {projectLiveTabCount(viewedProject()!, groups())} tabs
              </span>

              <Show when={viewedProjectId() !== currentId()}>
                <div
                  class={
                    "group ml-1 flex min-w-0 shrink items-center gap-1.5 rounded py-0.5 pr-1.5 pl-0.5" +
                    (currentThing() ? " border border-warning/30" : "")
                  }
                >
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => openProject(viewedProject()!)}
                    class="btn btn-sm shrink-0 gap-1.5 border-none bg-accent text-accent-txt shadow-[var(--shadow-raised)] hover:bg-accent-alt1 disabled:opacity-50"
                  >
                    <Show when={currentThing()} fallback={<Plug size={13} />}>
                      <ArrowRightLeft size={13} />
                    </Show>
                    {currentThing()
                      ? "Switch to this project"
                      : "Connect to this project"}
                  </button>
                  <Show when={currentThing()}>
                    <TriangleAlert size={12} class="shrink-0 text-warning" />
                    <span class="max-w-0 overflow-hidden whitespace-nowrap text-xs text-warning transition-[max-width] duration-[var(--duration)] group-hover:max-w-40 group-focus-within:max-w-40">
                      Replaces {currentThing()!.name}'s tabs
                    </span>
                  </Show>
                </div>
              </Show>

              <Show when={viewedProjectId() === currentId()}>
                <button
                  type="button"
                  disabled={busy()}
                  onClick={handleDisconnectWindow}
                  class="btn btn-sm ml-1 shrink-0 gap-1.5 border border-surface-alt3 text-surface-txt-hint hover:text-warning disabled:opacity-50"
                >
                  <Unplug size={13} />
                  Disconnect
                </button>
              </Show>

              <details class="dropdown shrink-0">
                <summary
                  title="More actions"
                  class="btn btn-square btn-sm list-none border border-surface-alt3 bg-surface-alt2 shadow-[var(--shadow-card)]"
                >
                  <MoreHorizontal size={15} />
                </summary>
                <ul class="dropdown-content menu z-50 mt-1 w-47.5 gap-0.5 rounded border border-surface-alt4 bg-surface-alt2 p-1.25 shadow-[var(--shadow-dropdown)]">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        startRenameFolder(viewedProject()!);
                        closeOpenDropdowns();
                      }}
                    >
                      Rename project
                    </button>
                  </li>
                  <Show when={viewedProjectId() === currentId()}>
                    <li>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={handleCloseAllTabs}
                      >
                        Close all tabs
                      </button>
                    </li>
                  </Show>
                  <li>
                    <button
                      type="button"
                      class="text-danger"
                      onClick={handleDeleteViewedProject}
                    >
                      Delete project
                    </button>
                  </li>
                </ul>
              </details>
            </Show>

            <Show when={!viewingFolderId() && !viewedProject()}>
              <Show when={!railOpen()}>
                <details class="dropdown shrink-0">
                  <summary class="btn h-8 list-none gap-2 rounded-full border border-surface-alt3 bg-surface-alt1 px-2.75 font-normal shadow-[var(--shadow-card)]">
                    <GroupDot group={viewed()} />
                    <span class="text-sm font-bold">{viewed()?.name}</span>
                    <span class="font-mono text-[11px] text-surface-txt-faint">
                      {viewed()?.tabs.length ?? 0}
                    </span>
                    <ChevronDown size={11} class="text-surface-txt-hint" />
                  </summary>
                  <ul class="dropdown-content menu z-50 mt-1 w-58 gap-0.5 rounded bg-surface-alt2 p-1.5 shadow-[var(--shadow-dropdown)]">
                    <For each={groups()}>
                      {(w) => (
                        <li>
                          <GroupRow
                            group={w}
                            count={w.tabs.length}
                            isViewed={w.id === viewedId()}
                            isCurrent={w.id === currentId()}
                            openElsewhere={
                              w.id !== currentId() && openIds().has(w.id)
                            }
                            anyActive={currentId() !== undefined}
                            busy={busy()}
                            onView={() => {
                              showGroup(w.id);
                              closeOpenDropdowns();
                            }}
                            onOpenAll={() => openAll(w)}
                            onContextMenu={(e) =>
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                items: groupContextMenuItems(
                                  w,
                                  w.id === currentId(),
                                ),
                              })
                            }
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>

              <Show when={railOpen()}>
                <div class="flex min-w-0 items-baseline gap-2.25 overflow-hidden">
                  <Show
                    when={!renaming()}
                    fallback={
                      <input
                        autofocus
                        class="input input-sm w-48 bg-surface-alt1"
                        value={renameValue()}
                        onInput={(e) => setRenameValue(e.currentTarget.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => e.key === "Enter" && commitRename()}
                      />
                    }
                  >
                    <span class="shrink-0 truncate text-base font-semibold">
                      {viewed()?.name}
                    </span>
                  </Show>
                  <span class="min-w-0 overflow-hidden truncate font-mono text-[11px] text-surface-txt-faint">
                    {(viewed()?.tabs.length ?? 0) + " tabs"}
                  </span>
                </div>
              </Show>

              <Show when={viewed() && !isViewingCurrent()}>
                <div
                  class={
                    "group ml-1 flex min-w-0 shrink items-center gap-1.5 rounded py-0.5 pr-1.5 pl-0.5" +
                    (currentThing() ? " border border-warning/30" : "")
                  }
                >
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => viewed() && openAll(viewed()!)}
                    class="btn btn-sm shrink-0 gap-1.5 border-none bg-accent text-accent-txt shadow-[var(--shadow-raised)] hover:bg-accent-alt1 disabled:opacity-50"
                  >
                    <Show when={currentThing()} fallback={<Plug size={13} />}>
                      <ArrowRightLeft size={13} />
                    </Show>
                    {currentThing()
                      ? "Switch to this group"
                      : "Connect to this group"}
                  </button>
                  <Show when={currentThing()}>
                    <TriangleAlert size={12} class="shrink-0 text-warning" />
                    <span class="max-w-0 overflow-hidden whitespace-nowrap text-xs text-warning transition-[max-width] duration-[var(--duration)] group-hover:max-w-40 group-focus-within:max-w-40">
                      Replaces {currentThing()!.name}'s tabs
                    </span>
                  </Show>
                </div>
              </Show>

              <Show when={viewed() && isViewingCurrent()}>
                <button
                  type="button"
                  disabled={busy()}
                  onClick={handleDisconnectWindow}
                  class="btn btn-sm ml-1 shrink-0 gap-1.5 border border-surface-alt3 text-surface-txt-hint hover:text-warning disabled:opacity-50"
                >
                  <Unplug size={13} />
                  Disconnect
                </button>
              </Show>

              <details class="dropdown shrink-0">
                <summary
                  title="More actions"
                  class="btn btn-square btn-sm list-none border border-surface-alt3 bg-surface-alt2 shadow-[var(--shadow-card)]"
                >
                  <MoreHorizontal size={15} />
                </summary>
                <ul class="dropdown-content menu z-50 mt-1 w-47.5 gap-0.5 rounded border border-surface-alt4 bg-surface-alt2 p-1.25 shadow-[var(--shadow-dropdown)]">
                  <li>
                    <button type="button" onClick={startRename}>
                      Rename group
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={openCustomize}>
                      Customize icon &amp; color
                    </button>
                  </li>
                  <Show when={folders().length > 0}>
                    <li class="px-2 pt-1.5 pb-0.5 font-mono text-[10px] tracking-wider text-surface-txt-faint">
                      Move to folder
                    </li>
                    <Show when={viewed()?.folderId}>
                      <li>
                        <button
                          type="button"
                          onClick={() => handleMoveToFolder(null)}
                        >
                          Ungrouped
                        </button>
                      </li>
                    </Show>
                    <For each={flattenedFolders()}>
                      {({ folder, depth }) => (
                        <Show when={folder.id !== viewed()?.folderId}>
                          <li>
                            <button
                              type="button"
                              style={{
                                "padding-left": `${0.75 + depth * 0.875}rem`,
                              }}
                              onClick={() => handleMoveToFolder(folder.id)}
                            >
                              {folder.name}
                            </button>
                          </li>
                        </Show>
                      )}
                    </For>
                  </Show>
                  <Show when={isViewingCurrent()}>
                    <li>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={handleCloseAllTabs}
                      >
                        Close all tabs
                      </button>
                    </li>
                  </Show>
                  <Show
                    when={isViewingCurrent() && !projectOf(viewed()?.folderId)}
                  >
                    <li>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={handleCompleteGroupStandalone}
                      >
                        Complete group
                      </button>
                    </li>
                  </Show>
                  <Show when={!isViewingCurrent()}>
                    <li>
                      <button
                        type="button"
                        class="text-danger"
                        onClick={handleDeleteViewed}
                      >
                        Move to Trash
                      </button>
                    </li>
                  </Show>
                </ul>
              </details>
            </Show>

            <span class="flex-1" />
          </div>

          <Show when={viewingFolderId()}>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <FolderPage
                folder={viewingFolder()!}
                breadcrumb={viewingFolderBreadcrumb()}
                groups={() => groupsIn(viewingFolderId()!)}
                projects={
                  viewingFolder()?.kind === "area"
                    ? () => childFolders(viewingFolderId()!)
                    : undefined
                }
                onOpenProject={showProjectTabs}
                onOpenGroup={showGroup}
                onAddGroup={() => handleAddGroupIn(viewingFolderId()!)}
              />

              <Show when={experimentalFeaturesEnabled()}>
                <div class="mx-auto max-w-2xl px-6 pb-6">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
                      BOOKMARKS
                    </span>
                    <button
                      type="button"
                      title="Add bookmark"
                      onClick={openAddResource}
                      class="btn btn-square btn-ghost btn-xs"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  <Show when={addingResource()}>
                    <form
                      onSubmit={handleAddResourceToArea}
                      class="mb-2 flex flex-col gap-1.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5"
                    >
                      <input
                        autofocus
                        placeholder="https://…"
                        class="input input-sm bg-surface-alt2"
                        value={resourceUrl()}
                        onInput={(e) => setResourceUrl(e.currentTarget.value)}
                      />
                      <input
                        placeholder="Note (optional)"
                        class="input input-sm bg-surface-alt2"
                        value={resourceNote()}
                        onInput={(e) => setResourceNote(e.currentTarget.value)}
                      />
                      <div class="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAddingResource(false)}
                          class="btn btn-ghost btn-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          class="btn btn-xs border-none bg-accent text-accent-txt hover:bg-accent-alt1"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </Show>

                  <Show
                    when={resourcesForArea().length > 0}
                    fallback={
                      <p class="text-sm text-surface-txt-hint">
                        No saved bookmarks.
                      </p>
                    }
                  >
                    <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                      <For each={resourcesForArea()}>
                        {(r) => resourceRow(r)}
                      </For>
                    </section>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={!viewingFolderId() && viewedProject()}>
            <div class="min-h-0 flex-1 overflow-y-auto p-3.5">
              <GroupBoardPanel
                groups={() =>
                  groupsIn(viewedProject()!.id).map((q) => ({
                    id: q.id,
                    name: q.name,
                    status: q.status,
                    tabCount: q.tabs.length,
                  }))
                }
                busy={busy()}
                onActivate={(groupId) => {
                  const group = groups().find((q) => q.id === groupId);
                  if (group) {
                    groupSwapSend({
                      type: "ACTIVATE_GROUP",
                      project: viewedProject()!,
                      group,
                    });
                  }
                }}
                onComplete={(groupId) => {
                  const group = groups().find((q) => q.id === groupId);
                  if (group) {
                    groupSwapSend({
                      type: "COMPLETE_GROUP",
                      project: viewedProject()!,
                      group,
                    });
                  }
                }}
                onAddGroup={async (name) => {
                  const project = viewedProject();
                  if (!project) return;
                  const order = groupsIn(project.id).length;
                  const group = await createGroup(name, []);
                  await updateGroup(group.id, { folderId: project.id, order });
                  await revealNewGroupTab(group, project);
                  await refresh();
                }}
              />
              <Show
                when={projectLiveTabs(viewedProject()!, groups()).length > 0}
                fallback={
                  <p class="text-sm text-surface-txt-hint">
                    No tabs in this project.
                  </p>
                }
              >
                <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                  <For each={projectLiveTabs(viewedProject()!, groups())}>
                    {(tab) => (
                      <div class="flex items-center gap-2.5 truncate border-b border-surface-alt2 px-3.5 py-2.5 text-sm last:border-b-0">
                        <span class="min-w-0 flex-1 truncate">
                          {tab.title || tab.url}
                        </span>
                      </div>
                    )}
                  </For>
                </section>
              </Show>

              <Show when={experimentalFeaturesEnabled()}>
                <div class="mt-5">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
                      BOOKMARKS
                    </span>
                    <button
                      type="button"
                      title="Add bookmark"
                      onClick={openAddResource}
                      class="btn btn-square btn-ghost btn-xs"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  <Show when={addingResource()}>
                    <form
                      onSubmit={handleAddResourceToProject}
                      class="mb-2 flex flex-col gap-1.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5"
                    >
                      <input
                        autofocus
                        placeholder="https://…"
                        class="input input-sm bg-surface-alt2"
                        value={resourceUrl()}
                        onInput={(e) => setResourceUrl(e.currentTarget.value)}
                      />
                      <input
                        placeholder="Note (optional)"
                        class="input input-sm bg-surface-alt2"
                        value={resourceNote()}
                        onInput={(e) => setResourceNote(e.currentTarget.value)}
                      />
                      <div class="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAddingResource(false)}
                          class="btn btn-ghost btn-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          class="btn btn-xs border-none bg-accent text-accent-txt hover:bg-accent-alt1"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </Show>

                  <Show
                    when={resourcesForProject().length > 0}
                    fallback={
                      <p class="text-sm text-surface-txt-hint">
                        No saved bookmarks.
                      </p>
                    }
                  >
                    <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                      <For each={resourcesForProject()}>
                        {(r) => resourceRow(r)}
                      </For>
                    </section>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={!viewingFolderId() && !viewedProject()}>
            <div class="min-h-0 flex-1 overflow-y-auto p-3.5">
              <Show
                when={viewed() && viewed()!.tabs.length > 0}
                fallback={
                  <p class="text-sm text-surface-txt-hint">
                    No tabs in this group.
                  </p>
                }
              >
                <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                  <For each={viewed()!.tabs}>
                    {(tab, i) => (
                      <TabRow
                        tab={tab}
                        index={i()}
                        selected={selected().has(i())}
                        selectable={!isViewingCurrent()}
                        onToggle={() => toggleSelected(i())}
                        onOpen={() => focusRealTab(tab.url)}
                      />
                    )}
                  </For>
                </section>
              </Show>
            </div>
          </Show>
        </main>
      </div>

      <Show when={selected().size > 0}>
        <div class="fixed bottom-5 left-1/2 z-55 flex -translate-x-1/2 items-center gap-2.5 rounded border border-surface-alt4 bg-surface-alt3 py-2 pr-2.5 pl-3.5 shadow-[var(--shadow-dropdown)]">
          <span class="text-sm font-medium">
            {selected().size} tab{selected().size === 1 ? "" : "s"} selected
          </span>
          <span class="h-4.5 w-px bg-surface-alt4" />
          <For each={groups().filter((w) => w.id !== viewedId())}>
            {(w) => (
              <button
                type="button"
                onClick={() => moveSelectedTo(w.id)}
                class="btn btn-xs gap-1 whitespace-nowrap border border-surface-alt4 bg-surface-alt2"
              >
                <ArrowRight size={11} /> {w.name}
              </button>
            )}
          </For>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            class="btn btn-xs btn-ghost text-surface-txt-hint"
          >
            Clear
          </button>
        </div>
      </Show>

      <dialog
        ref={customizeRef}
        onClick={(e) => e.target === e.currentTarget && closeCustomize()}
        class="m-auto w-full max-w-[340px] rounded border border-surface-alt4 bg-surface-alt2 p-4 text-surface-txt shadow-[var(--shadow-modal)] backdrop:bg-black/55"
      >
        <div class="flex items-center justify-between gap-2">
          <h3 class="min-w-0 truncate text-sm font-semibold">
            Customize {viewed()?.name}
          </h3>
          <button
            type="button"
            onClick={closeCustomize}
            class="btn btn-square btn-ghost btn-xs shrink-0"
          >
            <X size={13} />
          </button>
        </div>

        <p class="mt-3.5 mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-faint">
          COLOR
        </p>
        <div class="flex gap-2">
          <For each={COLOR_KEYS}>
            {(key) => (
              <button
                type="button"
                title={key}
                onClick={() => handleSetColor(key)}
                class={
                  "h-6 w-6 rounded-full " +
                  COLOR_CLASS[key] +
                  (groupColorKey(viewed()) === key
                    ? " ring-2 ring-offset-2 ring-offset-surface-alt2 ring-surface-txt"
                    : "")
                }
              />
            )}
          </For>
        </div>

        <p class="mt-3.5 mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-faint">
          ICON
        </p>
        <div class="grid grid-cols-6 gap-1.5">
          <button
            type="button"
            title="Default mark"
            onClick={() => handleSetIcon(undefined)}
            class={
              "btn btn-square btn-sm border-none bg-surface-alt1 hover:bg-surface-alt3" +
              (!viewed()?.icon
                ? " ring-2 ring-surface-txt ring-offset-1 ring-offset-surface-alt2"
                : "")
            }
          >
            <span class="h-3.5 w-3.5 rounded-full border border-surface-txt-hint" />
          </button>
          <For each={ICON_NAMES}>
            {(name) => (
              <button
                type="button"
                title={name}
                onClick={() => handleSetIcon(name)}
                class={
                  "btn btn-square btn-sm border-none bg-surface-alt1 hover:bg-surface-alt3" +
                  (viewed()?.icon === name
                    ? " ring-2 ring-surface-txt ring-offset-1 ring-offset-surface-alt2"
                    : "")
                }
              >
                <Icon name={name} size={14} />
              </button>
            )}
          </For>
        </div>
      </dialog>
      <Show when={contextMenu()}>
        {(ctx) => (
          <ul
            class="menu fixed z-50 w-36 gap-0.5 rounded border border-surface-alt4 bg-surface-alt2 p-1.25 shadow-[var(--shadow-dropdown)]"
            style={{ left: `${ctx().x}px`, top: `${ctx().y}px` }}
          >
            <For each={ctx().items}>
              {(item) => (
                <li>
                  <button
                    type="button"
                    class={
                      item.tone === "danger"
                        ? "text-danger"
                        : item.tone === "warning"
                          ? "text-warning"
                          : undefined
                    }
                    onClick={item.onClick}
                  >
                    {item.label}
                  </button>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </>
  );
}

function App() {
  const [groups, setGroups] = createSignal<Group[]>([]);
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [resources, setResources] = createSignal<Resource[]>([]);
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [windowMap, setWindowMap] = createSignal<Record<number, WindowBinding>>(
    {},
  );
  const [myWindowId, setMyWindowId] = createSignal<number>();
  const [startupBehavior, setStartupBehavior] =
    createSignal<StartupBehavior>("none");
  const [theme, setTheme] = createSignal<Theme>("baseline");
  const [manualPullEnabled, setManualPullEnabled] = createSignal(false);
  const [experimentalFeaturesEnabled, setExperimentalFeaturesEnabled] =
    createSignal(false);
  const [autoArchiveDays, setAutoArchiveDays] = createSignal(30);
  const [nav, setNav] = createSignal<
    "groups" | "trash" | "history" | "automations" | "bookmarks" | "settings"
  >("groups");
  const [automations, setAutomations] = createSignal<Automation[]>([]);
  const [jumpToSessionId, setJumpToSessionId] = createSignal<string>();
  const [state, send] = useMachine(restoreMachine);
  const [groupSwapState, groupSwapSend] = useMachine(groupSwapMachine);
  const [syncState, syncSend] = useMachine(syncMachine);

  // The search palette lives here, not inside Dashboard, so it works from
  // the Trash/Settings tabs too — Dashboard only mounts for nav()==="groups".
  const [paletteQuery, setPaletteQuery] = createSignal("");
  let paletteRef: HTMLDialogElement | undefined;
  // A selected result hands off to Dashboard's own view state via this prop
  // instead of reaching into it directly — see Dashboard's jumpTo prop.
  const [jumpTo, setJumpTo] = createSignal<JumpTarget>();

  function openPalette() {
    // An open details.dropdown breaks the dialog's ::backdrop dimming in
    // Chromium (both compete for the top layer), so clear any open menu
    // before showing the modal.
    closeOpenDropdowns();
    setPaletteQuery("");
    paletteRef?.showModal();
  }
  function closePalette() {
    paletteRef?.close();
  }
  function goToGroup(id: string) {
    setNav("groups");
    setJumpTo({ kind: "group", id });
    closePalette();
  }
  function goToProject(id: string) {
    setNav("groups");
    setJumpTo({ kind: "project", id });
    closePalette();
  }
  function goToArea(id: string) {
    setNav("groups");
    setJumpTo({ kind: "area", id });
    closePalette();
  }
  function goToSession(id: string) {
    setNav("history");
    setJumpToSessionId(id);
    closePalette();
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "Escape") {
        closeOpenDropdowns();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));

    const onClickAway = (e: MouseEvent) => {
      document
        .querySelectorAll<HTMLDetailsElement>("details.dropdown[open]")
        .forEach((d) => {
          if (!d.contains(e.target as Node)) d.removeAttribute("open");
        });
    };
    document.addEventListener("click", onClickAway);
    onCleanup(() => document.removeEventListener("click", onClickAway));
  });

  type PaletteResult = {
    kind: "QT" | "PR" | "AR" | "TAB" | "SN";
    title: string;
    meta: string;
    go: () => void;
  };
  // Global across the whole hierarchy — Groups, Projects (including their
  // own live tabs), and Areas — not scoped to whichever one is currently
  // being viewed, and reachable from any nav tab (Groups/Trash/Settings).
  // Uses visibleGroups()/visibleFolders() (archive-excluded), not the raw
  // signals, so an archived item disappears from search the same way it
  // disappears from the sidebar. Sessions are matched against the local
  // cache only (see utils/sessions.ts) — no live Supabase query here, same
  // synchronous-scan shape as every other branch.
  function paletteResults(): PaletteResult[] {
    const q = paletteQuery().trim().toLowerCase();
    if (!q) return [];
    const out: PaletteResult[] = [];
    for (const w of visibleGroups()) {
      if (w.name.toLowerCase().includes(q)) {
        out.push({
          kind: "QT",
          title: w.name,
          meta: `${w.tabs.length} tabs`,
          go: () => goToGroup(w.id),
        });
      }
      for (const t of w.tabs) {
        if (
          t.title.toLowerCase().includes(q) ||
          t.url.toLowerCase().includes(q)
        ) {
          out.push({
            kind: "TAB",
            title: t.title || t.url,
            meta: w.name,
            go: () => goToGroup(w.id),
          });
        }
      }
    }
    for (const f of visibleFolders()) {
      if (f.kind !== "project") {
        if (f.name.toLowerCase().includes(q)) {
          out.push({
            kind: "AR",
            title: f.name,
            meta: "Area",
            go: () => goToArea(f.id),
          });
        }
        continue;
      }
      if (f.name.toLowerCase().includes(q)) {
        out.push({
          kind: "PR",
          title: f.name,
          meta: `${projectLiveTabCount(f, groups())} tabs`,
          go: () => goToProject(f.id),
        });
      }
      for (const t of projectLiveTabs(f, groups())) {
        if (
          t.title.toLowerCase().includes(q) ||
          t.url.toLowerCase().includes(q)
        ) {
          out.push({
            kind: "TAB",
            title: t.title || t.url,
            meta: f.name,
            go: () => goToProject(f.id),
          });
        }
      }
    }
    for (const s of sessions()) {
      for (const w of s.windows) {
        const tabMatch = w.tabs.some(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.url.toLowerCase().includes(q),
        );
        if (w.entityName.toLowerCase().includes(q) || tabMatch) {
          out.push({
            kind: "SN",
            title: w.entityName,
            meta: new Date(s.capturedAt).toLocaleString(),
            go: () => goToSession(s.id),
          });
          break; // one result per session leg match, not per matching tab
        }
      }
    }
    return out.slice(0, 20);
  }

  // See docs/implementation-plan-sync.md M6: syncMachine owns pull/push
  // timing, this just renders its current snapshot. A pull/push failure and
  // a stale "pulling" spinner share the same message slot — there's only
  // ever one sync engine running, so there's only ever one status to show.
  function syncMessage() {
    if (syncState.matches("pulling")) return "Pulling…";
    if (syncState.matches("offline")) {
      return `Sync failed: ${syncState.context.lastError ?? "unknown error"}`;
    }
    const count = syncState.context.lastPullCount;
    if (count === undefined) return "";
    return count > 0
      ? `Pulled ${count} group${count === 1 ? "" : "s"}`
      : "Already up to date";
  }

  function onSignedIn() {
    refreshEntitlements().then(setEntitlements);
    syncSend({ type: "PULL" });
    reconcileGroupSyncStatus().then(refresh);
    reconcileFolderSyncStatus().then(refresh);
    reconcileResourceSyncStatus().then(refresh);
  }
  // Piggyback on the token refresh supabase-js already does on a timer — no
  // separate polling loop, per docs/architecture-sync.md. syncMachine has
  // its own periodic pull tick independent of this.
  const { session, authLoading } = useSupabaseSession(supabase, {
    onInitialSession: onSignedIn,
    onAuthEvent: (event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") onSignedIn();
    },
  });
  const [entitlements, setEntitlements] = createSignal<Entitlements>();
  const [email, setEmail] = createSignal("");
  const [otpSent, setOtpSent] = createSignal(false);
  const [otpCode, setOtpCode] = createSignal("");
  const [authError, setAuthError] = createSignal("");

  const bindingId = (b: WindowBinding) =>
    b.kind === "group" ? b.groupId : b.projectId;
  const openIds = () => new Set(Object.values(windowMap()).map(bindingId));
  const currentId = () => {
    const windowId = myWindowId();
    const binding = windowId !== undefined ? windowMap()[windowId] : undefined;
    return binding ? bindingId(binding) : undefined;
  };
  // Group-only: used for the document title/favicon, which stays keyed off
  // a live Group specifically, same as before Project became window-bound.
  const current = () => groups().find((w) => w.id === currentId());

  // A trashed group is still in storage.local (and still has whatever
  // syncStatus it had before deletion) but shouldn't appear in the normal
  // group list, count against the plan limit display, or trigger sync
  // issue banners — create_group's own count already excludes it
  // server-side (supabase/migrations' trash_and_purge migration), so this
  // keeps the dashboard's numbers matching what the server actually counts.
  const activeGroups = () => groups().filter((w) => !w.deletedAt);
  const trashedGroups = () => groups().filter((w) => !!w.deletedAt);
  const trashRetention = () =>
    trashRetentionDays(entitlements()?.accessExpiresAt);
  // Folders have no trash tier (deleteFolder is a hard delete), so every
  // Project-kind one counts as "active" for usage purposes.
  const projects = () => folders().filter((f) => f.kind === "project");

  // Archive is a visibility filter only — unlike Trash, archiving never
  // frees quota (an archived Group/Project still counts toward
  // max_workspaces, same as a "done" one does today), so activeGroups()/
  // projects() above stay archive-inclusive for every quota/usage
  // calculation. Only the main sidebar tree (Dashboard's props below) and
  // the "save to project" picker/palette should exclude archived items.
  const visibleGroups = () => activeGroups().filter((w) => !w.archivedAt);
  const archivedGroups = () => activeGroups().filter((w) => !!w.archivedAt);
  const visibleFolders = () => folders().filter((f) => !f.archivedAt);
  const archivedFolders = () => folders().filter((f) => !!f.archivedAt);

  // Account-level usage, driven by actual per-item sync status (see
  // docs/group-sync-semantics.md) rather than re-deriving "at limit" from
  // entitlements — an item only counts here once it's actually failed to
  // sync for a plan reason, not just because a count crossed a threshold
  // with nothing having been rejected yet. Groups and Projects share one
  // quota pool server-side (count_group_like(), added by
  // supabase/migrations/20261007170000_project_quest_restructure.sql and
  // renamed by 20261013000000_quest_to_group_rename.sql), so both are
  // counted together here too.
  const syncedGroupCount = () =>
    activeGroups().filter((w) => w.syncStatus === "synced").length;
  const syncedProjectCount = () =>
    projects().filter((f) => f.syncStatus === "synced").length;
  const syncedCount = () => syncedGroupCount() + syncedProjectCount();
  const blockedCount = () =>
    activeGroups().filter(
      (w) => w.syncStatus === "limit-reached" || w.syncStatus === "expired",
    ).length +
    projects().filter(
      (f) => f.syncStatus === "limit-reached" || f.syncStatus === "expired",
    ).length;
  const hasExpiredAccess = () =>
    activeGroups().some((w) => w.syncStatus === "expired") ||
    projects().some((f) => f.syncStatus === "expired");

  // blockedCount only catches an item that actually *failed* a create_group/
  // create_project call — but pullRemoteGroups/pullRemoteFolders mark
  // anything with a real server row "synced" regardless of the account's
  // *current* entitlement, and the create RPCs only enforce the limit at
  // insert time, never retroactively. So an account can sit at, say, 11
  // synced items against a 3-item plan — nothing "failed", so blockedCount
  // stays 0 — with no signal anywhere that new items won't sync from here.
  // This fills that gap.
  const overLimitCount = () => {
    const max = entitlements()?.maxMissions;
    return max !== undefined && syncedCount() > max ? syncedCount() - max : 0;
  };
  const hasSyncIssue = () => blockedCount() > 0 || overLimitCount() > 0;

  // The dismissible usage banner reappears whenever the underlying issue
  // changes — e.g. dismissing it while at the limit, then hitting a *new*
  // rejection later, or upgrading and having it resolve, shouldn't stay
  // stuck on whatever was true the moment it was dismissed.
  const [bannerDismissed, setBannerDismissed] = createSignal(false);
  createEffect(() => {
    blockedCount();
    overLimitCount();
    setBannerDismissed(false);
  });

  async function refresh() {
    setGroups(await getGroups());
    setFolders(await getFolders());
    setResources(await getResources());
    setSessions(await getSessions());
    setWindowMap(await getWindowBindingMap());
    setAutomations(await getAutomations());
  }

  onMount(async () => {
    const win = await browser.windows.getCurrent();
    if (win.id !== undefined) {
      setMyWindowId(win.id);
      await ensureBindingForWindow(win.id);
    }
    await refresh();

    const settings: Settings = await getSettings();
    setStartupBehavior(settings.startupBehavior);
    setTheme(settings.theme);
    setManualPullEnabled(settings.manualPullEnabled);
    setExperimentalFeaturesEnabled(settings.experimentalFeaturesEnabled);
    setAutoArchiveDays(settings.autoArchiveDays);

    // A "workspaces" write also notifies syncMachine, so a local rename or
    // the background script's live tab-sync gets pushed — see
    // docs/architecture-sync.md's "Push: local change → Supabase".
    const handleStorageChange = (changes: Record<string, unknown>) => {
      refresh();
      if ("workspaces" in changes || "folders" in changes)
        syncSend({ type: "LOCAL_CHANGE" });
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    onCleanup(() =>
      browser.storage.onChanged.removeListener(handleStorageChange),
    );

    // docs/architecture-sync.md's offline diagram: "Offline -> Retrying:
    // browser reports online again".
    const handleOnline = () => syncSend({ type: "ONLINE" });
    window.addEventListener("online", handleOnline);
    onCleanup(() => window.removeEventListener("online", handleOnline));
  });

  // Email OTP as a typed code, not a clicked link: a link can't reliably
  // redirect back into an extension page across browsers (Chrome's id can
  // be pinned, but Edge assigns its own unpredictably and Firefox
  // randomizes moz-extension://'s uuid per profile to prevent
  // fingerprinting — see docs/architecture-sync.md). A code typed into the
  // extension's own UI sidesteps all of that: no redirect, no per-browser
  // config.
  async function handleSendCode(e: Event) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase!.auth.signInWithOtp({ email: email() });
    if (error) setAuthError(error.message);
    else setOtpSent(true);
  }

  async function handleVerifyCode(e: Event) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase!.auth.verifyOtp({
      email: email(),
      token: otpCode(),
      type: "email",
    });
    if (error) setAuthError(error.message);
  }

  // browser.identity.launchWebAuthFlow is the extension-native way to do
  // OAuth: its redirect target (getRedirectURL()) is a reserved URL the
  // browser intercepts before ever loading a page, so the result comes
  // back directly as a return value — chrome-extension://, moz-extension://
  // and their per-browser id problems never enter the picture.
  async function handleGoogleSignIn() {
    setAuthError("");
    const redirectTo = browser.identity.getRedirectURL();
    const { data, error } = await supabase!.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) {
      setAuthError(error.message);
      return;
    }
    if (!data.url) {
      setAuthError("Supabase didn't return an OAuth URL.");
      return;
    }

    let resultUrl: string | undefined;
    try {
      resultUrl = await browser.identity.launchWebAuthFlow({
        url: data.url,
        interactive: true,
      });
    } catch {
      // User closed the auth window — not an error worth surfacing.
      return;
    }

    const tokens = parseTokensFromRedirectUrl(resultUrl);
    if (!tokens) {
      setAuthError("Google sign-in didn't return a valid session.");
      return;
    }

    const { error: setSessionError } = await supabase!.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (setSessionError) setAuthError(setSessionError.message);
  }

  async function handleSignOut() {
    await supabase!.auth.signOut();
  }

  async function handleStartupBehaviorChange(value: StartupBehavior) {
    setStartupBehavior(value);
    await updateSettings({ startupBehavior: value });
  }

  async function handleThemeChange(value: Theme) {
    setTheme(value);
    await updateSettings({ theme: value });
  }

  async function handleManualPullEnabledChange(value: boolean) {
    setManualPullEnabled(value);
    await updateSettings({ manualPullEnabled: value });
  }

  // Every Project- or Area-scoped bookmark, across the whole account — the
  // global Bookmarks tab, as opposed to Dashboard's per-Project/-Area
  // sections. Groups don't have bookmarks, so groupId-scoped resources
  // (from before that restriction) are deliberately excluded here too.
  const allBookmarks = () => resources().filter((r) => r.folderId);
  const folderNameFor = (id?: string) =>
    id ? folders().find((f) => f.id === id)?.name : undefined;

  async function handleDeleteBookmark(id: string) {
    await deleteResource(id);
    await refresh();
  }

  async function handleExperimentalFeaturesEnabledChange(value: boolean) {
    setExperimentalFeaturesEnabled(value);
    await updateSettings({ experimentalFeaturesEnabled: value });
    if (!value && EXPERIMENTAL_NAV_KEYS.has(nav())) setNav("groups");
  }

  async function handleAutoArchiveDaysChange(value: number) {
    setAutoArchiveDays(value);
    await updateSettings({ autoArchiveDays: value });
  }

  // Forces the same pull syncMachine already runs on sign-in/token refresh
  // and on its own periodic tick (see onMount above and utils/sync.ts), on
  // demand — the escape hatch the "Manual sync pull" setting exists for.
  function handlePullNow() {
    syncSend({ type: "PULL" });
    reconcileGroupSyncStatus().then(refresh);
  }

  async function handleRestoreGroup(id: string) {
    await restoreGroup(id);
    await refresh();
  }

  async function handlePermanentlyDeleteGroup(id: string) {
    await permanentlyDeleteGroup(id);
    await refresh();
  }

  async function handleUnarchiveGroup(id: string) {
    await unarchiveGroup(id);
    await refresh();
  }

  async function handleUnarchiveFolder(id: string) {
    await unarchiveFolder(id);
    await refresh();
  }

  async function handleRestoreSession(session: Session) {
    await restoreSession(session);
  }

  async function handleToggleAutomationEnabled(id: string, enabled: boolean) {
    await updateAutomation(id, { enabled });
    await refresh();
  }

  async function handleSaveAutomation(
    id: string,
    patch: Pick<UiAutomation, "nodes" | "edges">,
  ) {
    await updateAutomation(id, patch);
    await refresh();
  }

  async function handleDeleteAutomation(id: string) {
    await deleteAutomation(id);
    await refresh();
  }

  // tokens.css keys every non-baseline theme off data-theme on the root
  // element (:root[data-theme="indigo"] etc.) — baseline has no such
  // block, so leaving the attribute off (or "baseline") just falls
  // through to the plain :root defaults.
  createEffect(() => {
    document.documentElement.dataset.theme = theme();
  });

  // The pinned dashboard tab is this window's only always-visible surface,
  // so it's where "which group is this window" needs to be obvious
  // without opening the dashboard: tab title + a favicon colored to match
  // the group's own dot color (same palette as the sidebar).
  createEffect(() => {
    const group = current();
    theme(); // recompute the resolved color when the palette changes
    document.title = group ? `${group.name} — cntxt` : "cntxt";
    const favicon = document.getElementById(
      "favicon",
    ) as HTMLLinkElement | null;
    if (favicon) favicon.href = faviconHrefFor(group);
  });

  return (
    <>
      <Show when={!supabaseConfigured}>
        <ConfigWarning>
          Copy <code>extension/.env.example</code> to{" "}
          <code>extension/.env</code> and fill in
          <code> WXT_SUPABASE_URL</code> /{" "}
          <code> WXT_SUPABASE_PUBLISHABLE_KEY</code>, then restart{" "}
          <code>pnpm dev</code>. Local dev values come from{" "}
          <code>npx supabase status</code> (run <code>supabase start</code> from
          the repo root first).
        </ConfigWarning>
      </Show>
      <Show when={supabaseConfigured && !authLoading()}>
        <Show
          when={session()}
          fallback={
            <div class="flex min-h-screen items-center justify-center bg-surface p-8 font-sans text-surface-txt">
              <div class="w-full max-w-sm rounded border border-surface-alt3 bg-surface-alt1 p-6 shadow-[var(--shadow-raised)]">
                <h2 class="mb-4 text-lg font-medium">Sign in to cntxt</h2>
                <Show
                  when={!otpSent()}
                  fallback={
                    <form
                      class="flex flex-col gap-2"
                      onSubmit={handleVerifyCode}
                    >
                      <p class="text-sm text-surface-txt-hint">
                        Enter the code sent to {email()}.
                      </p>
                      <input
                        type="text"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        required
                        placeholder="123456"
                        class="input bg-surface-alt2"
                        value={otpCode()}
                        onInput={(e) => setOtpCode(e.currentTarget.value)}
                      />
                      <button
                        type="submit"
                        class="btn border-none bg-accent text-accent-txt hover:bg-accent-alt1"
                      >
                        Verify code
                      </button>
                    </form>
                  }
                >
                  <form class="flex flex-col gap-2" onSubmit={handleSendCode}>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      class="input bg-surface-alt2"
                      value={email()}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                    />
                    <button
                      type="submit"
                      class="btn border-none bg-accent text-accent-txt hover:bg-accent-alt1"
                    >
                      Send sign-in code
                    </button>
                  </form>
                  <div class="my-3 text-center text-xs text-surface-txt-hint">
                    or
                  </div>
                  <button
                    onClick={handleGoogleSignIn}
                    class="btn w-full border border-surface-alt3"
                  >
                    Continue with Google
                  </button>
                </Show>
                <Show when={authError()}>
                  <p class="mt-3 text-sm text-danger">{authError()}</p>
                </Show>
              </div>
            </div>
          }
        >
          <div class="flex h-screen flex-col bg-surface font-sans text-surface-txt">
            <header class="sticky top-0 z-40 flex h-13 shrink-0 items-center gap-1 border-b border-surface-alt2 bg-surface-alt1 px-3.5">
              <svg
                viewBox="0 0 100 100"
                width="20"
                height="20"
                aria-hidden="true"
                class="mr-2.5 shrink-0"
              >
                <path
                  d="M 77.58 73.15 A 36 36 0 1 1 77.58 26.85"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="14"
                  stroke-linecap="round"
                />
                <rect
                  x="74"
                  y="40"
                  width="8"
                  height="20"
                  rx="4"
                  fill="currentColor"
                />
              </svg>
              <div class="flex h-full items-stretch gap-0.5">
                <For
                  each={NAV_ITEMS.filter(
                    (n) =>
                      !EXPERIMENTAL_NAV_KEYS.has(n.key) ||
                      experimentalFeaturesEnabled(),
                  )}
                >
                  {(n) => (
                    <button
                      type="button"
                      onClick={() => setNav(n.key)}
                      class={
                        "-mb-px flex items-center gap-1.75 border-b-2 px-2.5 text-sm " +
                        (nav() === n.key
                          ? "border-accent font-semibold text-surface-txt"
                          : "border-transparent font-medium text-surface-txt-hint hover:text-surface-txt")
                      }
                    >
                      <n.icon size={14} class="opacity-90" />
                      <span class="whitespace-nowrap">{n.label}</span>
                    </button>
                  )}
                </For>
              </div>
              <span class="flex-1" />
              <button
                type="button"
                title="Search everything"
                onClick={openPalette}
                class="btn btn-sm h-8 shrink-0 border border-surface-alt3 bg-surface-alt1 shadow-[var(--shadow-card)]"
              >
                <Search size={13} />
                <span class="rounded border border-surface-alt3 bg-surface-alt2 px-1.25 font-mono text-[11px]">
                  ⌘K
                </span>
              </button>
              <details class="dropdown dropdown-end">
                <summary class="btn btn-sm h-8 list-none gap-1.75 border-none bg-transparent font-normal text-surface-txt-hint hover:text-surface-txt">
                  <span class="whitespace-nowrap">{session()?.user.email}</span>
                  <Show when={hasSyncIssue()}>
                    <span class="grid h-3.5 min-w-3.5 place-items-center rounded-full bg-warning px-0.5 font-mono text-[9px] text-warning-txt">
                      {blockedCount() > 0 ? blockedCount() : overLimitCount()}
                    </span>
                  </Show>
                  <ChevronDown size={12} class="opacity-70" />
                </summary>
                <ul class="dropdown-content menu z-50 mt-1 w-52 gap-0.5 rounded bg-surface-alt2 p-1.5 text-surface-txt shadow-[var(--shadow-dropdown)]">
                  <Show when={entitlements()}>
                    <li class="px-2 py-1 text-xs">
                      <span
                        class={
                          hasSyncIssue()
                            ? "text-warning"
                            : "text-surface-txt-hint"
                        }
                      >
                        {syncedCount()} of {entitlements()!.maxMissions} groups
                        synced
                      </span>
                    </li>
                  </Show>
                  <Show when={manualPullEnabled()}>
                    <li>
                      <button
                        type="button"
                        disabled={syncState.matches("pulling")}
                        onClick={handlePullNow}
                      >
                        <RefreshCw
                          size={12}
                          class={
                            syncState.matches("pulling")
                              ? "animate-spin"
                              : undefined
                          }
                        />
                        Pull groups now
                      </button>
                    </li>
                    <Show when={syncMessage()}>
                      <li class="px-2 py-0.5 text-xs text-surface-txt-hint">
                        {syncMessage()}
                      </li>
                    </Show>
                  </Show>
                  <li>
                    <a
                      href={creemMonthlyCheckoutUrl(session()!.user.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Upgrade — Monthly
                    </a>
                  </li>
                  <li>
                    <a
                      href={creemYearlyCheckoutUrl(session()!.user.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Upgrade — Yearly
                    </a>
                  </li>
                  <li>
                    <button type="button" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </li>
                </ul>
              </details>
            </header>

            <Show when={blockedCount() > 0 && !bannerDismissed()}>
              <div class="mx-3.5 mt-3 flex items-start gap-2.5 rounded border border-surface-alt3 border-l-2 border-l-warning bg-surface-alt1 p-3 text-sm">
                <TriangleAlert size={14} class="mt-0.5 shrink-0 text-warning" />
                <p class="flex-1 text-surface-txt-hint">
                  <span class="font-medium text-surface-txt">
                    {hasExpiredAccess()
                      ? "Your plan has expired."
                      : "You've hit your plan's limit."}
                  </span>{" "}
                  {blockedCount()} item{blockedCount() === 1 ? "" : "s"}{" "}
                  {blockedCount() === 1 ? "isn't" : "aren't"} syncing.{" "}
                  {hasExpiredAccess() ? "Renew" : "Upgrade"} to keep everything
                  backed up.
                </p>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint"
                >
                  <X size={12} />
                </button>
              </div>
            </Show>

            <Show when={overLimitCount() > 0 && !bannerDismissed()}>
              <div class="mx-3.5 mt-3 flex items-start gap-2.5 rounded border border-surface-alt3 border-l-2 border-l-warning bg-surface-alt1 p-3 text-sm">
                <TriangleAlert size={14} class="mt-0.5 shrink-0 text-warning" />
                <p class="flex-1 text-surface-txt-hint">
                  <span class="font-medium text-surface-txt">
                    You're over your plan's limit.
                  </span>{" "}
                  {syncedCount()} items are synced, but your plan covers{" "}
                  {entitlements()?.maxMissions}. New groups and projects won't
                  sync until you're back under the limit or you upgrade.
                </p>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint"
                >
                  <X size={12} />
                </button>
              </div>
            </Show>

            <Switch>
              <Match when={nav() === "trash"}>
                <div class="flex flex-1 items-stretch overflow-hidden">
                  <TrashPanel
                    groups={trashedGroups}
                    retentionDays={trashRetention}
                    onRestore={handleRestoreGroup}
                    onDeleteForever={handlePermanentlyDeleteGroup}
                  />
                </div>
              </Match>
              <Match when={nav() === "history"}>
                <div class="flex flex-1 items-stretch overflow-hidden">
                  <HistoryPanel
                    archivedGroups={archivedGroups}
                    archivedFolders={archivedFolders}
                    onUnarchiveGroup={handleUnarchiveGroup}
                    onUnarchiveFolder={handleUnarchiveFolder}
                    sessions={sessions}
                    onRestoreSession={handleRestoreSession}
                    jumpToSessionId={jumpToSessionId}
                  />
                </div>
              </Match>
              <Match when={nav() === "automations"}>
                <div class="flex flex-1 items-stretch overflow-hidden">
                  <AutomationsPanel
                    automations={automations}
                    onToggleEnabled={handleToggleAutomationEnabled}
                    onSaveAutomation={handleSaveAutomation}
                    onDeleteAutomation={handleDeleteAutomation}
                  />
                </div>
              </Match>
              <Match when={nav() === "bookmarks"}>
                <div class="flex-1 overflow-y-auto p-6">
                  <div class="flex max-w-md flex-col gap-3">
                    <h2 class="text-base font-semibold">Bookmarks</h2>
                    <Show
                      when={allBookmarks().length > 0}
                      fallback={
                        <p class="text-sm text-surface-txt-hint">
                          No bookmarks yet.
                        </p>
                      }
                    >
                      <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                        <For each={allBookmarks()}>
                          {(r) => (
                            <div class="group flex items-center gap-2.5 border-b border-surface-alt2 px-3.5 py-2.5 last:border-b-0">
                              <LinkIcon
                                size={13}
                                class="shrink-0 text-surface-txt-faint"
                              />
                              <Show
                                when={r.url}
                                fallback={
                                  <span class="min-w-0 flex-1 truncate text-sm">
                                    {r.note}
                                  </span>
                                }
                              >
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="min-w-0 flex-1 truncate text-sm hover:underline"
                                >
                                  {r.note || r.url}
                                </a>
                              </Show>
                              <span class="max-w-[30%] shrink-0 truncate font-mono text-[11px] text-surface-txt-faint">
                                {folderNameFor(r.folderId)}
                              </span>
                              <button
                                type="button"
                                title="Remove"
                                onClick={() => handleDeleteBookmark(r.id)}
                                class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          )}
                        </For>
                      </section>
                    </Show>
                  </div>
                </div>
              </Match>
              <Match when={nav() === "settings"}>
                <div class="flex flex-1 items-stretch overflow-hidden">
                  <SettingsPanel
                    startupBehavior={startupBehavior}
                    onStartupBehaviorChange={handleStartupBehaviorChange}
                    theme={theme}
                    onThemeChange={handleThemeChange}
                    manualPullEnabled={manualPullEnabled}
                    onManualPullEnabledChange={handleManualPullEnabledChange}
                    experimentalFeaturesEnabled={experimentalFeaturesEnabled}
                    onExperimentalFeaturesEnabledChange={
                      handleExperimentalFeaturesEnabledChange
                    }
                    autoArchiveDays={autoArchiveDays}
                    onAutoArchiveDaysChange={handleAutoArchiveDaysChange}
                    maxWorkspaces={() => entitlements()?.maxMissions}
                    groupCount={() => activeGroups().length}
                    projectCount={() => projects().length}
                    syncedCount={syncedCount}
                    blockedCount={blockedCount}
                    overLimitCount={overLimitCount}
                    accessExpiresAt={() => entitlements()?.accessExpiresAt}
                    trashedCount={() => trashedGroups().length}
                    trashRetentionDays={trashRetention}
                    monthlyCheckoutUrl={
                      session()
                        ? creemMonthlyCheckoutUrl(session()!.user.id)
                        : undefined
                    }
                    yearlyCheckoutUrl={
                      session()
                        ? creemYearlyCheckoutUrl(session()!.user.id)
                        : undefined
                    }
                  />
                </div>
              </Match>
              <Match when={nav() === "groups"}>
                <Dashboard
                  groups={visibleGroups}
                  folders={visibleFolders}
                  resources={resources}
                  currentId={currentId}
                  openIds={openIds}
                  myWindowId={myWindowId}
                  entitlements={entitlements}
                  refresh={refresh}
                  restoreState={state}
                  restoreSend={send}
                  groupSwapState={groupSwapState}
                  groupSwapSend={groupSwapSend}
                  jumpTo={jumpTo}
                  onJumped={() => setJumpTo(undefined)}
                  experimentalFeaturesEnabled={experimentalFeaturesEnabled}
                />
              </Match>
            </Switch>
          </div>

          <dialog
            ref={paletteRef}
            onClick={(e) => e.target === e.currentTarget && closePalette()}
            class="m-auto w-full max-w-[560px] rounded border border-surface-alt4 bg-surface-alt2 p-0 text-surface-txt shadow-[var(--shadow-modal)] backdrop:bg-black/55"
          >
            <div class="flex items-center gap-2.5 border-b border-surface-alt3 px-3.5 py-3">
              <Search size={14} class="text-surface-txt-hint" />
              <input
                autofocus
                value={paletteQuery()}
                onInput={(e) => setPaletteQuery(e.currentTarget.value)}
                placeholder="Jump to a group, project, area, or tab…"
                class="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <span class="rounded border border-surface-alt4 px-1.25 font-mono text-[11px] text-surface-txt-hint">
                esc
              </span>
            </div>
            <div class="max-h-[50vh] overflow-y-auto p-1.5">
              <For each={paletteResults()}>
                {(r) => (
                  <div
                    onClick={r.go}
                    class="flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 hover:bg-surface-alt3"
                  >
                    <span class="badge badge-sm shrink-0 font-mono">
                      {r.kind}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-sm">
                      {r.title}
                    </span>
                    <span class="shrink-0 font-mono text-[11px] text-surface-txt-faint">
                      {r.meta}
                    </span>
                  </div>
                )}
              </For>
              <Show
                when={paletteQuery().trim() && paletteResults().length === 0}
              >
                <p class="p-5.5 text-center text-sm text-surface-txt-hint">
                  No matches.
                </p>
              </Show>
            </div>
          </dialog>
        </Show>
      </Show>
    </>
  );
}

export default App;
