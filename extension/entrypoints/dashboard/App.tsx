import { useMachine } from "@xstate/solid";
import type { Session } from "@supabase/supabase-js";
import {
  type Accessor,
  type JSX,
  createEffect,
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { ensureWorkspaceForWindow } from "@/utils/attach";
import { restoreMachine } from "@/utils/restoreMachine";
import { getWindowWorkspaceMap } from "@/utils/session";
import {
  type Settings,
  type StartupBehavior,
  type Theme,
  getSettings,
  updateSettings,
} from "@/utils/settings";
import { parseTokensFromRedirectUrl } from "@/utils/oauthRedirect";
import { supabase, supabaseConfigured } from "@/utils/supabase";
import {
  AppWindow,
  ArrowRight,
  ArrowRightLeft,
  ChevronDown,
  type LucideProps,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Search,
  LayoutGrid as SectionsIcon,
  Settings as SettingsIcon,
  TriangleAlert,
  Unplug,
  X,
} from "lucide-solid";
import {
  type Workspace,
  type WorkspaceTab,
  createWorkspace,
  deleteWorkspace,
  getWorkspaces,
  updateWorkspace,
} from "@/utils/workspaces";

// Dot/avatar colors are derived from a hash of a stable id rather than
// stored, so tabs (and workspaces without an explicit color) get a
// consistent color without a schema migration — same trick the design
// mockup used for tab favicons. A workspace can also pick one of these
// five explicitly via the customize dialog, stored as its `color` field.
// Paired with a matching *-txt role (not always white — a light accent
// theme like Brass on Obsidian needs dark ink on its own hue) so a color
// that happens to land on the active theme's accent color stays legible.
const COLOR_KEYS = ["accent", "success", "warning", "info", "danger"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
const COLOR_CLASS: Record<ColorKey, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
};
const COLOR_TXT_CLASS: Record<ColorKey, string> = {
  accent: "text-accent-txt",
  success: "text-success-txt",
  warning: "text-warning-txt",
  info: "text-info-txt",
  danger: "text-danger-txt",
};
function hashColorKey(seed: string): ColorKey {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLOR_KEYS[hash % COLOR_KEYS.length]!;
}
function colorFor(seed: string): string {
  return COLOR_CLASS[hashColorKey(seed)];
}
function textColorFor(seed: string): string {
  return COLOR_TXT_CLASS[hashColorKey(seed)];
}
function workspaceColorKey(w: Workspace | undefined): ColorKey {
  return (w?.color as ColorKey | undefined) ?? hashColorKey(w?.id ?? "cntxt");
}
function workspaceDotClass(w: Workspace | undefined): string {
  return COLOR_CLASS[workspaceColorKey(w)];
}
function workspaceTxtClass(w: Workspace | undefined): string {
  return COLOR_TXT_CLASS[workspaceColorKey(w)];
}
function domainOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split("/")[0] || url;
}

// A small curated subset of Lucide's path data (see lucide-solid's
// dist/source/icons/*.jsx — there's no typed way to import __iconNode
// directly, only the wrapped component), inlined so the exact same
// geometry can be drawn both by a SolidJS <Icon> in the picker/UI and as a
// raw string in the pinned tab's favicon data URI, which can't render
// components.
type IconNode = ReadonlyArray<
  readonly [string, Record<string, string | number>]
>;
const ICONS = {
  folder: [
    [
      "path",
      {
        d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      },
    ],
  ],
  star: [
    [
      "path",
      {
        d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      },
    ],
  ],
  rocket: [
    ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
    [
      "path",
      {
        d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09",
      },
    ],
    [
      "path",
      {
        d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z",
      },
    ],
    ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
  ],
  zap: [
    [
      "path",
      {
        d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
      },
    ],
  ],
  heart: [
    [
      "path",
      {
        d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
      },
    ],
  ],
  bookmark: [
    [
      "path",
      {
        d: "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z",
      },
    ],
  ],
  briefcase: [
    ["path", { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }],
    ["rect", { width: "20", height: "14", x: "2", y: "6", rx: "2" }],
  ],
  globe: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
    ["path", { d: "M2 12h20" }],
  ],
  flag: [
    [
      "path",
      {
        d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
      },
    ],
  ],
  coffee: [
    ["path", { d: "M10 2v2" }],
    ["path", { d: "M14 2v2" }],
    [
      "path",
      {
        d: "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1",
      },
    ],
    ["path", { d: "M6 2v2" }],
  ],
  sparkles: [
    [
      "path",
      {
        d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
      },
    ],
    ["path", { d: "M20 2v4" }],
    ["path", { d: "M22 4h-4" }],
    ["circle", { cx: "4", cy: "20", r: "2" }],
  ],
  code: [
    ["path", { d: "m16 18 6-6-6-6" }],
    ["path", { d: "m8 6-6 6 6 6" }],
  ],
} satisfies Record<string, IconNode>;
type IconName = keyof typeof ICONS;
const ICON_NAMES = Object.keys(ICONS) as IconName[];

function Icon(props: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 14}
      height={props.size ?? 14}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
    >
      <For each={ICONS[props.name]}>
        {([tag, attrs]) => <Dynamic component={tag} {...attrs} />}
      </For>
    </svg>
  );
}

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

function WorkspaceDot(props: {
  workspace: Workspace | undefined;
  ring?: boolean;
  title?: string;
}) {
  const icon = () => props.workspace?.icon as IconName | undefined;
  return (
    <span
      title={props.title}
      class={
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full " +
        workspaceDotClass(props.workspace) +
        (props.ring ? " ring-2 ring-accent" : "")
      }
    >
      <Show when={icon()}>
        <Icon
          name={icon()!}
          size={9}
          class={workspaceTxtClass(props.workspace)}
        />
      </Show>
    </span>
  );
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

// A workspace with a chosen icon draws that icon (in its own dot color);
// otherwise falls back to the cntxt mark (open ring + caret) traced in that
// same color, so every window's pinned dashboard tab stays identifiable at
// a glance even without a custom icon set.
function faviconHrefFor(workspace: Workspace | undefined): string {
  const color = resolveDotColor(workspaceDotClass(workspace));
  const icon = workspace?.icon as IconName | undefined;
  const svg = icon
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconNodeToSvgString(ICONS[icon], color)}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32"><path d="M 77.58 73.15 A 36 36 0 1 1 77.58 26.85" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/><rect x="74" y="40" width="8" height="20" rx="4" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function closeOpenDropdowns() {
  document
    .querySelectorAll<HTMLDetailsElement>("details.dropdown[open]")
    .forEach((d) => d.removeAttribute("open"));
}

const NAV_ITEMS: Array<{
  key: "workspaces" | "settings";
  label: string;
  icon: (props: LucideProps) => JSX.Element;
}> = [
  { key: "workspaces", label: "Workspaces", icon: SectionsIcon },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function WorkspaceRow(props: {
  workspace: Workspace;
  count: number;
  isViewed: boolean;
  isCurrent: boolean;
  openElsewhere: boolean;
  anyActive: boolean;
  busy: boolean;
  onView: () => void;
  onOpenAll: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div
      onClick={props.onView}
      class={
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5" +
        (props.isViewed
          ? " bg-surface-alt3 font-medium"
          : " text-surface-txt-hint")
      }
    >
      <WorkspaceDot
        workspace={props.workspace}
        ring={props.isCurrent}
        title={props.isCurrent ? "Active" : undefined}
      />
      <span class="min-w-0 flex-1 truncate text-sm">
        {props.workspace.name}
      </span>
      <span class="font-mono text-[11px] text-surface-txt-hint">
        {props.count}
      </span>
      <Show when={props.isCurrent}>
        <button
          type="button"
          title="Disconnect"
          disabled={props.busy}
          onClick={(e) => {
            e.stopPropagation();
            props.onDisconnect();
          }}
          class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint hover:text-warning disabled:opacity-40"
        >
          <Unplug size={10} />
        </button>
      </Show>
      <Show when={!props.isCurrent}>
        <Show
          when={!props.openElsewhere}
          fallback={
            <span title="Open elsewhere" class="shrink-0">
              <AppWindow size={10} class="text-surface-txt-hint" />
            </span>
          }
        >
          <button
            type="button"
            title={props.anyActive ? "Switch here" : "Connect here"}
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onOpenAll();
            }}
            class="btn btn-square btn-ghost btn-xs shrink-0 text-accent disabled:opacity-40"
          >
            <Show when={props.anyActive} fallback={<Plug size={10} />}>
              <ArrowRightLeft size={10} />
            </Show>
          </button>
        </Show>
      </Show>
    </div>
  );
}

function TabRow(props: {
  tab: WorkspaceTab;
  index: number;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const domain = () => domainOf(props.tab.url);
  return (
    <div
      onClick={props.selectable ? props.onToggle : props.onOpen}
      class={
        "flex cursor-pointer items-center gap-2.5 border-b border-surface-alt2 px-3 py-1.75 last:border-b-0" +
        (props.selected ? " bg-accent/20" : "")
      }
    >
      <Show when={props.selectable}>
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={props.selected}
          onClick={(e) => e.stopPropagation()}
          onChange={props.onToggle}
        />
      </Show>
      <span
        class={
          "grid h-4.5 w-4.5 shrink-0 place-items-center rounded text-[10px] font-bold " +
          colorFor(props.tab.url) +
          " " +
          textColorFor(props.tab.url)
        }
      >
        {domain()[0]?.toUpperCase()}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm">
        {props.tab.title || props.tab.url}
      </span>
      <span class="max-w-[38%] shrink-0 truncate font-mono text-[11px] text-surface-txt-hint">
        {domain()}
      </span>
    </div>
  );
}

function Dashboard(props: {
  workspaces: Accessor<Workspace[]>;
  currentId: Accessor<string | undefined>;
  current: Accessor<Workspace | undefined>;
  openIds: Accessor<Set<string>>;
  myWindowId: Accessor<number | undefined>;
  refresh: () => Promise<void>;
  restoreState: ReturnType<typeof useMachine<typeof restoreMachine>>[0];
  restoreSend: ReturnType<typeof useMachine<typeof restoreMachine>>[1];
  popupOpen: Accessor<boolean>;
  setPopupOpen: (v: boolean) => void;
}) {
  const {
    workspaces,
    currentId,
    current,
    openIds,
    myWindowId,
    refresh,
    restoreState,
    restoreSend,
  } = props;

  const [railOpen, setRailOpen] = createSignal(true);
  const [viewedId, setViewedId] = createSignal<string>();
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [paletteQuery, setPaletteQuery] = createSignal("");
  let paletteRef: HTMLDialogElement | undefined;
  let customizeRef: HTMLDialogElement | undefined;

  onMount(() => {
    try {
      const stored = localStorage.getItem("cntxt.railOpen");
      if (stored !== null) setRailOpen(stored === "1");
    } catch {
      // localStorage can throw in some extension contexts; default stands.
    }
  });

  // Seed the initially-viewed workspace from this window's workspace once
  // it resolves, without fighting later manual browsing (viewed() isn't a
  // dependency here, just read via untrack).
  createEffect(() => {
    const id = currentId();
    if (id && untrack(viewedId) === undefined) setViewedId(id);
  });

  // Any storage tab data shown for a *saved* (non-open) workspace goes
  // stale the moment you switch which workspace you're looking at, so
  // selection indices reset on every view change.
  createEffect(() => {
    viewedId();
    setSelected(new Set<number>());
  });

  const viewed = () => workspaces().find((w) => w.id === viewedId());
  const isViewingCurrent = () =>
    viewedId() !== undefined && viewedId() === currentId();
  const busy = () => !restoreState.matches("idle");

  function setRail(v: boolean) {
    try {
      localStorage.setItem("cntxt.railOpen", v ? "1" : "0");
    } catch {
      // best-effort persistence only
    }
    setRailOpen(v);
  }

  function openAll(workspace: Workspace) {
    restoreSend({ type: "RESTORE", workspace });
    setViewedId(workspace.id);
  }

  // A workspace's *live* tabs (the one mapped to this window) are the
  // source of truth for the real browser window, re-synced on every tab
  // event by workspaceWindowMachine — editing that array in storage would
  // just be overwritten on the next sync. So a click on one of its rows
  // jumps to the real tab instead of "selecting" it, and only saved
  // (non-open) workspaces support the multi-select/move flow below.
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

  async function closeRealTab(url: string) {
    const windowId = myWindowId();
    if (windowId === undefined) return;
    const tabs = await browser.tabs.query({ windowId });
    const tab = tabs.find((t) => t.url === url);
    if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
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
    await updateWorkspace(source.id, { tabs: remaining });

    if (targetId === currentId() && myWindowId() !== undefined) {
      for (const tab of moved) {
        await browser.tabs.create({ windowId: myWindowId(), url: tab.url });
      }
    } else {
      const target = workspaces().find((w) => w.id === targetId);
      if (target)
        await updateWorkspace(targetId, { tabs: [...target.tabs, ...moved] });
    }
    setSelected(new Set<number>());
    await refresh();
  }

  async function handleAddWorkspace() {
    const workspace = await createWorkspace("Untitled workspace", []);
    await refresh();
    setViewedId(workspace.id);
  }

  async function handleDeleteViewed() {
    const id = viewedId();
    if (!id) return;
    await deleteWorkspace(id);
    if (viewedId() === id) setViewedId(currentId());
    await refresh();
    closeOpenDropdowns();
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
    await updateWorkspace(id, { name: trimmed });
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
    await updateWorkspace(id, { color });
    await refresh();
  }
  async function handleSetIcon(icon: IconName | undefined) {
    const id = viewedId();
    if (!id) return;
    await updateWorkspace(id, { icon });
    await refresh();
  }

  async function handleCloseAllTabs() {
    restoreSend({ type: "CLOSE_TABS" });
    closeOpenDropdowns();
  }

  // Detaches this window from its workspace *before* closing its tabs (see
  // restoreMachine's DISCONNECT), so workspaceWindowMachine's syncTabs
  // no-ops on those closures instead of autosaving them — unlike
  // handleCloseAllTabs, the workspace's saved tab list is left untouched.
  function handleDisconnectWindow() {
    restoreSend({ type: "DISCONNECT" });
    closeOpenDropdowns();
  }

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
  function goToWorkspace(id: string) {
    setViewedId(id);
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
    kind: "WS" | "TAB";
    title: string;
    meta: string;
    go: () => void;
  };
  function paletteResults(): PaletteResult[] {
    const q = paletteQuery().trim().toLowerCase();
    if (!q) return [];
    const out: PaletteResult[] = [];
    for (const w of workspaces()) {
      if (w.name.toLowerCase().includes(q)) {
        out.push({
          kind: "WS",
          title: w.name,
          meta: `${w.tabs.length} tabs`,
          go: () => goToWorkspace(w.id),
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
            go: () => goToWorkspace(w.id),
          });
        }
      }
    }
    return out.slice(0, 20);
  }

  return (
    <>
      <div class="flex flex-1 items-stretch overflow-hidden">
        <Show when={railOpen()}>
          <nav class="flex w-60 shrink-0 flex-col border-r border-surface-alt2 bg-surface-alt1">
            <div class="flex h-11 shrink-0 items-center gap-2 border-b border-surface-alt2 pr-2.5 pl-3.5">
              <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-hint">
                WORKSPACES
              </span>
              <button
                type="button"
                onClick={handleAddWorkspace}
                class="btn btn-square btn-ghost btn-xs"
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
            <div class="flex flex-col gap-0.5 overflow-y-auto p-1.5">
              <For each={workspaces()}>
                {(w) => (
                  <WorkspaceRow
                    workspace={w}
                    count={w.tabs.length}
                    isViewed={w.id === viewedId()}
                    isCurrent={w.id === currentId()}
                    openElsewhere={w.id !== currentId() && openIds().has(w.id)}
                    anyActive={currentId() !== undefined}
                    busy={busy()}
                    onView={() => setViewedId(w.id)}
                    onOpenAll={() => openAll(w)}
                    onDisconnect={handleDisconnectWindow}
                  />
                )}
              </For>
            </div>
          </nav>
        </Show>

        <main class="flex min-w-0 flex-1 flex-col">
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
              <details class="dropdown shrink-0">
                <summary class="btn h-8 list-none gap-2 rounded-full border border-surface-alt3 bg-surface-alt1 px-2.75 font-normal shadow-[var(--shadow-card)]">
                  <WorkspaceDot workspace={viewed()} />
                  <span class="text-sm font-bold">{viewed()?.name}</span>
                  <span class="font-mono text-[11px] text-surface-txt-hint">
                    {viewed()?.tabs.length ?? 0}
                  </span>
                  <ChevronDown size={11} class="text-surface-txt-hint" />
                </summary>
                <ul class="dropdown-content menu z-50 mt-1 w-58 gap-0.5 rounded bg-surface-alt2 p-1.5 shadow-[var(--shadow-dropdown)]">
                  <For each={workspaces()}>
                    {(w) => (
                      <li>
                        <WorkspaceRow
                          workspace={w}
                          count={w.tabs.length}
                          isViewed={w.id === viewedId()}
                          isCurrent={w.id === currentId()}
                          openElsewhere={
                            w.id !== currentId() && openIds().has(w.id)
                          }
                          anyActive={currentId() !== undefined}
                          busy={busy()}
                          onView={() => {
                            setViewedId(w.id);
                            closeOpenDropdowns();
                          }}
                          onOpenAll={() => openAll(w)}
                          onDisconnect={handleDisconnectWindow}
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
                <span class="min-w-0 overflow-hidden truncate font-mono text-[11px] text-surface-txt-hint">
                  {(viewed()?.tabs.length ?? 0) + " tabs"}
                </span>
              </div>
            </Show>

            <Show when={viewed() && !isViewingCurrent()}>
              <div
                class={
                  "group ml-1 flex min-w-0 shrink items-center gap-1.5 rounded py-0.5 pr-1.5 pl-0.5" +
                  (current() ? " border border-warning/30" : "")
                }
              >
                <button
                  type="button"
                  disabled={busy()}
                  onClick={() => viewed() && openAll(viewed()!)}
                  class="btn btn-sm shrink-0 gap-1.5 border-none bg-accent text-accent-txt shadow-[var(--shadow-raised)] hover:bg-accent-alt1 disabled:opacity-50"
                >
                  <Show when={current()} fallback={<Plug size={13} />}>
                    <ArrowRightLeft size={13} />
                  </Show>
                  {current()
                    ? "Switch to this workspace"
                    : "Connect to this workspace"}
                </button>
                <Show when={current()}>
                  <TriangleAlert size={12} class="shrink-0 text-warning" />
                  <span class="max-w-0 overflow-hidden whitespace-nowrap text-xs text-warning transition-[max-width] duration-[var(--duration)] group-hover:max-w-40 group-focus-within:max-w-40">
                    Replaces {current()!.name}'s tabs
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
                    Rename workspace
                  </button>
                </li>
                <li>
                  <button type="button" onClick={openCustomize}>
                    Customize icon &amp; color
                  </button>
                </li>
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
                <Show when={!isViewingCurrent()}>
                  <li>
                    <button
                      type="button"
                      class="text-danger"
                      onClick={handleDeleteViewed}
                    >
                      Delete workspace
                    </button>
                  </li>
                </Show>
              </ul>
            </details>

            <span class="flex-1" />
            <button
              type="button"
              title="Search workspaces"
              onClick={openPalette}
              class="btn btn-sm shrink-0 border border-surface-alt3 bg-surface-alt1 shadow-[var(--shadow-card)]"
            >
              <Search size={13} />
              <span class="rounded border border-surface-alt3 bg-surface-alt2 px-1.25 font-mono text-[11px]">
                ⌘K
              </span>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-3.5">
            <Show
              when={viewed() && viewed()!.tabs.length > 0}
              fallback={
                <p class="text-sm text-surface-txt-hint">
                  No tabs in this workspace.
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
        </main>

        <Show when={props.popupOpen()}>
          <aside class="flex w-80 shrink-0 flex-col border-l border-surface-alt2 bg-surface-alt1 shadow-[-6px_0_16px_rgba(0,0,0,0.35)]">
            <div class="flex h-13 shrink-0 items-center gap-2 border-b border-surface-alt2 px-3">
              <span class="text-sm font-semibold">Current window</span>
              <span class="font-mono text-[11px] text-surface-txt-hint">
                {current()?.tabs.length ?? 0} open
              </span>
              <span class="flex-1" />
              <button
                type="button"
                onClick={() => props.setPopupOpen(false)}
                class="btn btn-square btn-ghost btn-xs"
              >
                <X size={13} />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <For each={current()?.tabs ?? []}>
                {(tab) => (
                  <div class="flex items-center gap-2.25 border-b border-surface-alt2 px-3 py-2.25">
                    <span
                      class={
                        "grid h-4.5 w-4.5 shrink-0 place-items-center rounded text-[10px] font-bold " +
                        colorFor(tab.url) +
                        " " +
                        textColorFor(tab.url)
                      }
                    >
                      {domainOf(tab.url)[0]?.toUpperCase()}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-[13px]">
                      {tab.title || tab.url}
                    </span>
                    <button
                      type="button"
                      onClick={() => closeRealTab(tab.url)}
                      class="btn btn-xs shrink-0 border border-surface-alt3 bg-surface-alt2"
                    >
                      Close
                    </button>
                  </div>
                )}
              </For>
            </div>
          </aside>
        </Show>
      </div>

      <Show when={selected().size > 0}>
        <div class="fixed bottom-5 left-1/2 z-55 flex -translate-x-1/2 items-center gap-2.5 rounded border border-surface-alt4 bg-surface-alt3 py-2 pr-2.5 pl-3.5 shadow-[var(--shadow-dropdown)]">
          <span class="text-sm font-medium">
            {selected().size} tab{selected().size === 1 ? "" : "s"} selected
          </span>
          <span class="h-4.5 w-px bg-surface-alt4" />
          <For each={workspaces().filter((w) => w.id !== viewedId())}>
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
            placeholder="Jump to a workspace or tab…"
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
                <span class="badge badge-sm shrink-0 font-mono">{r.kind}</span>
                <span class="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                <span class="shrink-0 font-mono text-[11px] text-surface-txt-hint">
                  {r.meta}
                </span>
              </div>
            )}
          </For>
          <Show when={paletteQuery().trim() && paletteResults().length === 0}>
            <p class="p-5.5 text-center text-sm text-surface-txt-hint">
              No matches.
            </p>
          </Show>
        </div>
      </dialog>

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

        <p class="mt-3.5 mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-hint">
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
                  (workspaceColorKey(viewed()) === key
                    ? " ring-2 ring-offset-2 ring-offset-surface-alt2 ring-surface-txt"
                    : "")
                }
              />
            )}
          </For>
        </div>

        <p class="mt-3.5 mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-hint">
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
    </>
  );
}

function SettingsPanel(props: {
  startupBehavior: Accessor<StartupBehavior>;
  onStartupBehaviorChange: (v: StartupBehavior) => void;
  theme: Accessor<Theme>;
  onThemeChange: (v: Theme) => void;
}) {
  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-md flex-col gap-5">
        <h2 class="text-base font-semibold">Settings</h2>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="text-surface-txt-hint">On browser start</span>
          <select
            class="select bg-surface-alt1 shadow-[var(--shadow-card)]"
            value={props.startupBehavior()}
            onChange={(e) =>
              props.onStartupBehaviorChange(
                e.currentTarget.value as StartupBehavior,
              )
            }
          >
            <option value="none">Start fresh</option>
            <option value="lastUsed">Resume last used workspace</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="text-surface-txt-hint">Color theme</span>
          <select
            class="select bg-surface-alt1 shadow-[var(--shadow-card)]"
            value={props.theme()}
            onChange={(e) =>
              props.onThemeChange(e.currentTarget.value as Theme)
            }
          >
            <option value="baseline">Baseline</option>
            <option value="indigo">Graphite Indigo</option>
            <option value="brass">Brass on Obsidian</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function App() {
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [windowMap, setWindowMap] = createSignal<Record<number, string>>({});
  const [myWindowId, setMyWindowId] = createSignal<number>();
  const [startupBehavior, setStartupBehavior] =
    createSignal<StartupBehavior>("none");
  const [theme, setTheme] = createSignal<Theme>("baseline");
  const [nav, setNav] = createSignal<"workspaces" | "settings">("workspaces");
  const [popupOpen, setPopupOpen] = createSignal(false);
  const [state, send] = useMachine(restoreMachine);

  const [session, setSession] = createSignal<Session | null>(null);
  const [authLoading, setAuthLoading] = createSignal(true);
  const [email, setEmail] = createSignal("");
  const [otpSent, setOtpSent] = createSignal(false);
  const [otpCode, setOtpCode] = createSignal("");
  const [authError, setAuthError] = createSignal("");

  const openIds = () => new Set(Object.values(windowMap()));
  const currentId = () => {
    const windowId = myWindowId();
    return windowId !== undefined ? windowMap()[windowId] : undefined;
  };
  const current = () => workspaces().find((w) => w.id === currentId());

  async function refresh() {
    setWorkspaces(await getWorkspaces());
    setWindowMap(await getWindowWorkspaceMap());
  }

  onMount(async () => {
    if (supabaseConfigured) {
      const { data } = await supabase!.auth.getSession();
      setSession(data.session);

      const { data: authListener } = supabase!.auth.onAuthStateChange(
        (_event, newSession) => setSession(newSession),
      );
      onCleanup(() => authListener.subscription.unsubscribe());
    }
    setAuthLoading(false);

    const win = await browser.windows.getCurrent();
    if (win.id !== undefined) {
      setMyWindowId(win.id);
      await ensureWorkspaceForWindow(win.id);
    }
    await refresh();

    const settings: Settings = await getSettings();
    setStartupBehavior(settings.startupBehavior);
    setTheme(settings.theme);

    const handleStorageChange = () => refresh();
    browser.storage.onChanged.addListener(handleStorageChange);
    onCleanup(() =>
      browser.storage.onChanged.removeListener(handleStorageChange),
    );
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

  // tokens.css keys every non-baseline theme off data-theme on the root
  // element (:root[data-theme="indigo"] etc.) — baseline has no such
  // block, so leaving the attribute off (or "baseline") just falls
  // through to the plain :root defaults.
  createEffect(() => {
    document.documentElement.dataset.theme = theme();
  });

  // The pinned dashboard tab is this window's only always-visible surface,
  // so it's where "which workspace is this window" needs to be obvious
  // without opening the dashboard: tab title + a favicon colored to match
  // the workspace's own dot color (same palette as the sidebar).
  createEffect(() => {
    const workspace = current();
    theme(); // recompute the resolved color when the palette changes
    document.title = workspace ? `${workspace.name} — cntxt` : "cntxt";
    const favicon = document.getElementById(
      "favicon",
    ) as HTMLLinkElement | null;
    if (favicon) favicon.href = faviconHrefFor(workspace);
  });

  return (
    <>
      <Show when={!supabaseConfigured}>
        <div class="min-h-screen bg-surface p-8 font-sans text-surface-txt">
          <div class="mx-auto max-w-2xl rounded border border-warning bg-warning/10 p-4 text-sm shadow-[var(--shadow-card)]">
            <p class="font-medium">Supabase isn't configured yet.</p>
            <p class="mt-1">
              Copy <code>extension/.env.example</code> to{" "}
              <code>extension/.env</code> and fill in
              <code> WXT_SUPABASE_URL</code> /{" "}
              <code> WXT_SUPABASE_ANON_KEY</code>, then restart{" "}
              <code>pnpm dev</code>. Local dev values come from{" "}
              <code>npx supabase status</code> (run <code>supabase start</code>{" "}
              from the repo root first).
            </p>
          </div>
        </div>
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
          <div class="flex min-h-screen flex-col bg-surface font-sans text-surface-txt">
            <header class="sticky top-0 z-40 flex h-13 shrink-0 items-center gap-2 bg-accent px-3.5 text-accent-txt">
              <svg
                viewBox="0 0 100 100"
                width="22"
                height="22"
                aria-hidden="true"
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
              <For each={NAV_ITEMS}>
                {(n) => (
                  <button
                    type="button"
                    onClick={() => setNav(n.key)}
                    class={
                      "btn btn-sm h-8 gap-1.75 border-none text-accent-txt " +
                      (nav() === n.key
                        ? "bg-accent-txt/18 font-bold"
                        : "bg-transparent font-medium")
                    }
                  >
                    <n.icon size={14} class="opacity-90" />
                    <span class="whitespace-nowrap">{n.label}</span>
                  </button>
                )}
              </For>
              <span class="flex-1" />
              <button
                type="button"
                onClick={() => setPopupOpen(!popupOpen())}
                class={
                  "btn btn-sm h-8 gap-1.75 border-none font-medium text-accent-txt " +
                  (popupOpen() ? "bg-accent-txt/18" : "bg-accent-txt/8")
                }
              >
                <AppWindow size={14} />
                <span class="whitespace-nowrap">Current window</span>
                <span class="rounded bg-accent-txt/20 px-1.25 font-mono text-[11px]">
                  {current()?.tabs.length ?? 0}
                </span>
              </button>
              <details class="dropdown dropdown-end">
                <summary class="btn btn-sm h-8 list-none gap-1.75 border-none bg-transparent font-normal text-accent-txt/92">
                  <span class="whitespace-nowrap">{session()?.user.email}</span>
                  <ChevronDown size={12} class="opacity-70" />
                </summary>
                <ul class="dropdown-content menu z-50 mt-1 w-40 gap-0.5 rounded bg-surface-alt2 p-1.5 text-surface-txt shadow-[var(--shadow-dropdown)]">
                  <li>
                    <button type="button" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </li>
                </ul>
              </details>
            </header>

            <Show
              when={nav() === "workspaces"}
              fallback={
                <div class="flex flex-1 items-stretch overflow-hidden">
                  <SettingsPanel
                    startupBehavior={startupBehavior}
                    onStartupBehaviorChange={handleStartupBehaviorChange}
                    theme={theme}
                    onThemeChange={handleThemeChange}
                  />
                </div>
              }
            >
              <Dashboard
                workspaces={workspaces}
                currentId={currentId}
                current={current}
                openIds={openIds}
                myWindowId={myWindowId}
                refresh={refresh}
                restoreState={state}
                restoreSend={send}
                popupOpen={popupOpen}
                setPopupOpen={setPopupOpen}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </>
  );
}

export default App;
