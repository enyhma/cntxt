# Workflows

Sequence diagrams for the ✅ capabilities in [`capabilities.md`](./capabilities.md).
Each one pairs two levels: **"What you experience"** — just the user and
Vistap as a black box, the goal it serves — and **"Under the hood"** — traced
directly from the current code (`extension/entrypoints/background.ts`,
`utils/attach.ts`, `utils/restoreMachine.ts`, `utils/workspaceWindowMachine.ts`).
The "under the hood" diagrams are accurate to what runs today — update them
alongside the code, not after the fact.

For ❌ capabilities there's no real flow to trace yet, so those sections are
short prose **scenarios** instead of diagrams: a sketch of the intended user
experience per the `Workspace Dashboard v2` design, not a spec.

## Capture & restore

### Opening a window for the first time (icon click)

The path that creates a workspace from whatever tabs are already open, the
first time you click the extension icon in a window that has no mapping yet.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant Vistap

    User->>Vistap: opens a new browser window and starts working
    Vistap-->>User: nothing to do — it's already a workspace
    Note over User,Vistap: Goal: never have to remember to "save"
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant BG as background.ts<br/>(action.onClicked)
    participant Attach as ensureWorkspaceForWindow
    participant Session as storage.session<br/>(windowWorkspaceMap)
    participant Settings as storage.local<br/>(settings)
    participant Workspaces as storage.local<br/>(workspaces)
    participant Registry as windowActors<br/>(in-memory)

    User->>BG: clicks extension icon in window W
    BG->>BG: query for an existing dashboard tab in W
    alt dashboard tab already open
        BG->>BG: focus it, stop
    else no dashboard tab yet
        BG->>Attach: ensureWorkspaceForWindow(W)
        Attach->>Session: get windowWorkspaceMap
        alt W already mapped
            Session-->>Attach: existing workspaceId
        else W has no mapping
            Attach->>Settings: getSettings()
            alt startupBehavior === "lastUsed"<br/>and that workspace isn't open elsewhere
                Attach->>Session: map W -> lastActiveWorkspaceId
            else
                Attach->>Attach: snapshotTabs(W)
                Attach->>Workspaces: createWorkspace("Untitled", tabs)
                Attach->>Session: map W -> new workspace.id
            end
        end
        BG->>BG: create pinned dashboard tab in W
        BG->>Registry: trackWindow(W) — spawn a workspaceWindowMachine actor
    end
```

### Live tab sync

Every tab change in a tracked window re-snapshots that window's tabs into
its mapped workspace — this is what makes "saving" invisible.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant Vistap

    User->>Vistap: opens, closes, or edits tabs while working
    Vistap-->>User: keeps this window's saved workspace up to date, silently
    Note over User,Vistap: Goal: there's never a state of "unsaved" work to lose
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Tabs as browser.tabs API
    participant BG as background.ts listeners
    participant WinActor as workspaceWindowMachine<br/>(window W)
    participant Session as storage.session
    participant Workspaces as storage.local<br/>(workspaces)
    participant Dashboard as Dashboard UI<br/>(any window)

    User->>Tabs: opens / closes / navigates / moves a tab in W
    Tabs-->>BG: onCreated / onRemoved / onUpdated / onMoved
    BG->>WinActor: send TABS_CHANGED
    WinActor->>Session: get windowWorkspaceMap[W]
    alt W is mapped to a workspace
        WinActor->>Tabs: snapshotTabs(W)
        WinActor->>Workspaces: updateWorkspace(id, { tabs })
        Workspaces-->>Dashboard: storage.onChanged fires
        Dashboard->>Dashboard: refetch everything, re-render
    else W unmapped (e.g. mid-restore)
        WinActor--)WinActor: no-op
    end
```

### Service worker rehydration

MV3 background scripts restart often (idle unload, browser restart). The
in-memory actor registry doesn't survive that, so it's rebuilt from
persisted session state on every wake — this is called out in `CLAUDE.md`
as load-bearing, not incidental.

**Why it matters to you:** purely internal reliability plumbing — nothing to
diagram from the user's side, since the point is that you never notice it
happened. A tab you were tracking never silently stops syncing just because
the browser put the extension to sleep.

**Under the hood:**

```mermaid
sequenceDiagram
    participant MV3 as MV3 runtime
    participant BG as background.ts<br/>(top-level, runs on every wake)
    participant Session as storage.session<br/>(windowWorkspaceMap)
    participant Registry as windowActors<br/>(in-memory Map)

    Note over MV3,BG: service worker was idle-unloaded,<br/>then woken by any event
    MV3->>BG: re-executes the background entrypoint
    BG->>Registry: new empty Map — prior actors are gone
    BG->>Session: getWindowWorkspaceMap()
    Session-->>BG: { windowId: workspaceId, ... }
    loop for each still-mapped windowId
        BG->>Registry: trackWindow(windowId) — respawn its actor
    end
    Note over BG: live sync resumes for every open,<br/>previously-tracked window immediately —<br/>no need to wait for the next tab event
```

### Startup: resume last-used workspace

Runs once per browser launch, for every already-open window, when
`settings.startupBehavior === "lastUsed"`.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant Vistap

    User->>Vistap: quits and relaunches the browser
    Vistap-->>User: reopens the tabs from your last-used workspace
    Note over User,Vistap: Goal: no manual "reopen everything" step after a restart
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant BG as background.ts<br/>(runtime.onStartup)
    participant Attach as ensureWorkspaceForWindow
    participant Settings as storage.local<br/>(settings)
    participant Session as storage.session

    User->>Browser: launches the browser
    Browser-->>BG: runtime.onStartup
    BG->>Browser: windows.getAll()
    loop for each open window W
        BG->>Attach: ensureWorkspaceForWindow(W)
        Attach->>Settings: getSettings()
        alt lastUsed AND lastActiveWorkspaceId not already open in another window
            Attach->>Session: map W -> lastActiveWorkspaceId
        else
            Attach->>Session: create/attach a fresh "Untitled" workspace instead
        end
        BG->>BG: ensureDashboardTab(W), trackWindow(W)
    end
```

### Close all tabs

The simple half of `restoreMachine`: no workspace switch, so the window
stays mapped to its current workspace throughout.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant Vistap

    User->>Vistap: clicks "Close all tabs"
    Vistap-->>User: closes the window's tabs — the workspace stays saved, just empty
    Note over User,Vistap: Goal: reclaim screen and memory with zero risk of losing the set
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Dashboard as Dashboard (App.tsx)
    participant Machine as restoreMachine
    participant BrowserTabs as browser.tabs
    participant WinActor as workspaceWindowMachine<br/>(same window)
    participant Workspaces as storage.local<br/>(workspaces)

    User->>Dashboard: clicks "Close all tabs"
    Dashboard->>Machine: send CLOSE_TABS
    Machine->>Machine: -> closingTabs (workspace = null)
    Machine->>BrowserTabs: tabs.remove([...tab ids except dashboard tab])
    BrowserTabs-->>WinActor: onRemoved fires (window still mapped)
    WinActor->>Workspaces: updateWorkspace(id, { tabs: [] })
    Note right of WinActor: staying mapped is exactly what<br/>correctly records the workspace as now empty
    Machine->>Machine: -> openingTabs (workspace = null, no-op) -> idle
```

### Restore / switch workspace

The subtle one: restoring into the _current_ window is a close-then-open,
and the outgoing workspace must be detached **before** its tabs close — or
live-sync would zero out the workspace being left behind instead of the one
being closed. Covered by `utils/restoreMachine.test.ts`.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant Vistap

    User->>Vistap: clicks "Restore" on a different saved workspace
    Vistap-->>User: swaps this window's tabs for that workspace's tabs
    Note over User,Vistap: Goal: jump between projects without losing either one
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Dashboard as Dashboard (App.tsx)
    participant Machine as restoreMachine
    participant Session as storage.session
    participant BrowserTabs as browser.tabs
    participant WinActor as workspaceWindowMachine<br/>(same window)
    participant Workspaces as storage.local<br/>(workspaces)

    User->>Dashboard: clicks "Restore" on workspace B (window W is on A)
    Dashboard->>Machine: send RESTORE { workspace: B }
    Machine->>Machine: -> closingTabs (workspace = B, switchingWorkspace = true)
    Machine->>Session: removeWindowWorkspace(W) — detach A FIRST
    Note right of Session: incoming onRemoved events below<br/>will now find W unmapped
    Machine->>BrowserTabs: tabs.remove([...A's tab ids])
    BrowserTabs-->>WinActor: onRemoved fires per tab
    WinActor->>Session: get windowWorkspaceMap[W]
    Session-->>WinActor: undefined
    WinActor--)WinActor: no-op — A's saved tab list is untouched
    Machine->>Machine: -> openingTabs
    Machine->>Session: setWindowWorkspace(W, B.id)
    loop for each tab in B
        Machine->>BrowserTabs: tabs.create({ windowId: W, url })
    end
    BrowserTabs-->>WinActor: onCreated fires per new tab
    WinActor->>Session: get windowWorkspaceMap[W] -> B.id
    WinActor->>Workspaces: updateWorkspace(B.id, { tabs: snapshot })
    Machine->>Machine: -> idle
```

### Rename / delete a workspace

Plain CRUD, no diagram needed: the dashboard calls `updateWorkspace`/
`deleteWorkspace` directly, then re-fetches. No window-mutating side effects,
no machine involved.

## Organization — not implemented

**Scenario:** you drag a tab out of "Sync engines" into a new "Read later"
section within the same workspace; the tab's row picks up the section's
color dot. Selecting three tabs with click+shift and hitting a workspace
name in the bottom bar moves all three there in one action instead of three
separate drags.

Needs a schema change first — `Workspace.tabs: WorkspaceTab[]` becomes
`Workspace.sections: { id, name, color, tabs }[]` — before any of the above
has somewhere to live.

## Navigation & search — not implemented

**Scenario:** with a dozen workspaces open across projects, you hit `⌘K`,
type part of a tab's title, and jump straight to it without knowing which
workspace it's in — or collapse the sidebar into a pill that still shows the
active workspace's name and tab count.

## Live-open-tabs panel — not implemented

**Scenario, and why it doesn't fit as designed:** a right-hand panel lists
tabs open in the browser that aren't in any workspace yet, each with its own
"Save" button. That presumes some windows aren't auto-attached — the
opposite of "every window is a workspace." Building this means first
deciding whether some windows should opt out of live-sync, not just adding
UI.

## Sync & collaboration — not implemented (Phase 2/3, per `ROADMAP.md`)

**Scenario:** you save a workspace on your laptop, open the browser on a
different machine signed into the same account, and it's already there —
`updated_at` last-write-wins, no merge UI. In Phase 3, a teammate opens the
same shared workspace and sees your tab list update in real time via
Supabase Realtime.
