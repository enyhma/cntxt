# Workflows

Sequence diagrams for the ✅ capabilities in [`capabilities.md`](./capabilities.md).
Each one pairs two levels: **"What you experience"** — just the user and
cntxt as a black box, the goal it serves — and **"Under the hood"** — traced
directly from the current code (`extension/entrypoints/background.ts`,
`utils/attach.ts`, `utils/restoreMachine.ts`, `utils/windowSyncMachine.ts`).
The "under the hood" diagrams are accurate to what runs today — update them
alongside the code, not after the fact.

For ❌ capabilities there's no real flow to trace yet, so those sections are
short prose **scenarios** instead of diagrams: a sketch of the intended user
experience per the `Workspace Dashboard v2` design, not a spec.

## Capture & restore

### Opening a window for the first time (icon click)

The path that creates a Project from whatever tabs are already open, the
first time you click the extension icon in a window that has no binding yet.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant cntxt

    User->>cntxt: opens a new browser window and starts working
    cntxt-->>User: nothing to do — it's already a Project
    Note over User,cntxt: Goal: never have to remember to "save"
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant BG as background.ts<br/>(action.onClicked)
    participant Attach as ensureBindingForWindow
    participant Session as storage.session<br/>(windowBindingMap)
    participant Settings as storage.local<br/>(settings)
    participant Folders as storage.local<br/>(folders)
    participant Registry as windowActors<br/>(in-memory)

    User->>BG: clicks extension icon in window W
    BG->>BG: query for an existing dashboard tab in W
    alt dashboard tab already open
        BG->>BG: focus it, stop
    else no dashboard tab yet
        BG->>Attach: ensureBindingForWindow(W)
        Attach->>Session: get windowBindingMap
        alt W already bound
            Session-->>Attach: existing WindowBinding
        else W has no binding
            Attach->>Settings: getSettings()
            alt startupBehavior === "lastUsed"<br/>and that binding isn't open elsewhere
                Attach->>Session: map W -> settings.lastActiveBinding
            else
                Attach->>Attach: snapshotTabs(W)
                Attach->>Folders: createFolder("Untitled Project", null, "project")<br/>then updateFolder(id, { tabs })
                Attach->>Session: map W -> { kind: "project", projectId }
            end
        end
        BG->>BG: create pinned dashboard tab in W
        BG->>Registry: trackWindow(W) — spawn a windowSyncMachine actor
    end
```

### Live tab sync

Every tab change in a tracked window re-snapshots that window's tabs into
whatever it's bound to — this is what makes "saving" invisible.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant cntxt

    User->>cntxt: opens, closes, or edits tabs while working
    cntxt-->>User: keeps this window's saved Project/Quest up to date, silently
    Note over User,cntxt: Goal: there's never a state of "unsaved" work to lose
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Tabs as browser.tabs API
    participant BG as background.ts listeners
    participant WinActor as windowSyncMachine<br/>(window W)
    participant Session as storage.session
    participant Quests as storage.local<br/>(quests)
    participant Folders as storage.local<br/>(folders)
    participant Dashboard as Dashboard UI<br/>(any window)

    User->>Tabs: opens / closes / navigates / moves a tab in W
    Tabs-->>BG: onCreated / onRemoved / onUpdated / onMoved
    BG->>WinActor: send TABS_CHANGED
    WinActor->>Session: get windowBindingMap[W]
    alt W is bound to a standalone Quest
        WinActor->>Tabs: snapshotTabs(W)
        WinActor->>Quests: updateQuest(id, { tabs })
    else W is bound to a Project
        WinActor->>Tabs: snapshotTabs(W)
        alt Project has an activeQuestId (a child Quest is swapped in)
            WinActor->>Quests: updateQuest(activeQuestId, { tabs })
        else
            WinActor->>Folders: updateFolder(projectId, { tabs })
        end
    else W unbound (e.g. mid-restore)
        WinActor--)WinActor: no-op
    end
    Quests-->>Dashboard: storage.onChanged fires
    Folders-->>Dashboard: storage.onChanged fires
    Dashboard->>Dashboard: refetch everything, re-render
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
    participant Session as storage.session<br/>(windowBindingMap)
    participant Registry as windowActors<br/>(in-memory Map)

    Note over MV3,BG: service worker was idle-unloaded,<br/>then woken by any event
    MV3->>BG: re-executes the background entrypoint
    BG->>Registry: new empty Map — prior actors are gone
    BG->>Session: getWindowBindingMap()
    Session-->>BG: { windowId: WindowBinding, ... }
    loop for each still-bound windowId
        BG->>Registry: trackWindow(windowId) — respawn its actor
    end
    Note over BG: live sync resumes for every open,<br/>previously-tracked window immediately —<br/>no need to wait for the next tab event
```

### Startup: resume last-used Project or Quest

Runs once per browser launch, for every already-open window, when
`settings.startupBehavior === "lastUsed"`.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant cntxt

    User->>cntxt: quits and relaunches the browser
    cntxt-->>User: reopens the tabs from your last-used Project or Quest
    Note over User,cntxt: Goal: no manual "reopen everything" step after a restart
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant BG as background.ts<br/>(runtime.onStartup)
    participant Attach as ensureBindingForWindow
    participant Settings as storage.local<br/>(settings)
    participant Session as storage.session

    User->>Browser: launches the browser
    Browser-->>BG: runtime.onStartup
    BG->>Browser: windows.getAll()
    loop for each open window W
        BG->>Attach: ensureBindingForWindow(W)
        Attach->>Settings: getSettings()
        alt lastUsed AND lastActiveBinding not already open in another window
            Attach->>Session: map W -> settings.lastActiveBinding
        else
            Attach->>Session: create/attach a fresh "Untitled Project" instead
        end
        BG->>BG: ensureDashboardTab(W), trackWindow(W)
    end
```

### Close all tabs

The simple half of `restoreMachine`: no binding switch, so the window
stays bound to its current Project or Quest throughout.

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant cntxt

    User->>cntxt: clicks "Close all tabs"
    cntxt-->>User: closes the window's tabs — the Project/Quest stays saved, just empty
    Note over User,cntxt: Goal: reclaim screen and memory with zero risk of losing the set
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Dashboard as Dashboard (App.tsx)
    participant Machine as restoreMachine
    participant BrowserTabs as browser.tabs
    participant WinActor as windowSyncMachine<br/>(same window)
    participant Quests as storage.local<br/>(quests/folders)

    User->>Dashboard: clicks "Close all tabs"
    Dashboard->>Machine: send CLOSE_TABS
    Machine->>Machine: -> closingTabs (target = null, detach = false)
    Machine->>BrowserTabs: tabs.remove([...tab ids except dashboard tab])
    BrowserTabs-->>WinActor: onRemoved fires (window still bound)
    WinActor->>Quests: updateQuest/updateFolder(id, { tabs: [] })
    Note right of WinActor: staying bound is exactly what<br/>correctly records it as now empty
    Machine->>Machine: -> openingTabs (target = null, no-op) -> idle
```

### Restore / switch Project or Quest

The subtle one: restoring into the _current_ window is a close-then-open,
and the outgoing binding must be detached **before** its tabs close — or
live-sync would zero out the thing being left behind instead of the one
being closed. Covered by `utils/restoreMachine.test.ts`. (This is about
changing a window's `WindowBinding` — restoring to a different Project or a
different standalone Quest. Swapping which child Quest is active _within_ a
Project's already-open window is a separate concept, `questSwapMachine`,
which never touches the binding — see `quest-activation-semantics.md`.)

**What you experience:**

```mermaid
sequenceDiagram
    actor User
    participant cntxt

    User->>cntxt: clicks "Restore" on a different saved Project or Quest
    cntxt-->>User: swaps this window's tabs for that one's tabs
    Note over User,cntxt: Goal: jump between projects without losing either one
```

**Under the hood:**

```mermaid
sequenceDiagram
    actor User
    participant Dashboard as Dashboard (App.tsx)
    participant Machine as restoreMachine
    participant Session as storage.session
    participant BrowserTabs as browser.tabs
    participant WinActor as windowSyncMachine<br/>(same window)
    participant Quests as storage.local<br/>(quests)

    User->>Dashboard: clicks "Restore" on Quest B (window W is on A)
    Dashboard->>Machine: send RESTORE { target: { kind: "quest", quest: B } }
    Machine->>Machine: -> closingTabs (target = B, detach = true)
    Machine->>Session: removeWindowBinding(W) — detach A FIRST
    Note right of Session: incoming onRemoved events below<br/>will now find W unbound
    Machine->>BrowserTabs: tabs.remove([...A's tab ids])
    BrowserTabs-->>WinActor: onRemoved fires per tab
    WinActor->>Session: get windowBindingMap[W]
    Session-->>WinActor: undefined
    WinActor--)WinActor: no-op — A's saved tab list is untouched
    Machine->>Machine: -> openingTabs
    Machine->>Session: setWindowBinding(W, { kind: "quest", questId: B.id })
    loop for each tab in B
        Machine->>BrowserTabs: tabs.create({ windowId: W, url })
    end
    BrowserTabs-->>WinActor: onCreated fires per new tab
    WinActor->>Session: get windowBindingMap[W] -> { kind: "quest", questId: B.id }
    WinActor->>Quests: updateQuest(B.id, { tabs: snapshot })
    Machine->>Machine: -> idle
```

Restoring a Project instead of a standalone Quest follows the identical
shape, just opening whichever tabs `resolveProjectLiveTarget` resolves to
(the Project's own `tabs`, or its `activeQuestId` child's, if one is set) —
see `utils/projectLiveTabs.ts`.

### Rename / delete a Quest

Plain CRUD, no diagram needed: the dashboard calls `updateQuest`/
`deleteQuest` directly, then re-fetches. No window-mutating side effects,
no machine involved.

## Organization

**Shipped, differently than the scenario originally sketched here:** the
original idea was dragging a tab into a named, colored group _within one
workspace's flat tab list_ (`Workspace.sections: {id,name,color,tabs}[]`).
What actually shipped instead is structural, not a tab grouping: Area →
Project → Section (a `kind` on the shared `Folder` type, see `CLAUDE.md`),
where Section holds Resources (links/notes), not tabs, and a Quest nests
under a Project rather than a tab nesting under a section. Tab-level
grouping within a single Quest/Project's own tab list remains unbuilt — see
`capabilities.md`'s Organization table for the current, corrected status of
each piece.

## Navigation & search

**Mostly shipped** (see `capabilities.md`): a persistent sidebar rail
(Areas → Projects → Sections/Quests, collapsible) and a `⌘K` command palette
both exist in `App.tsx` today. No "under the hood" trace for either here yet
— add one the next time this file is touched alongside that code, per this
page's own stated contract. Display preferences (show domains, grid vs.
list, search scope) remain unbuilt.

## Live-open-tabs panel — not implemented

**Scenario, and why it doesn't fit as designed:** a right-hand panel lists
tabs open in the browser that aren't in any Project/Quest yet, each with its
own "Save" button. That presumes some windows aren't auto-attached — the
opposite of "every window is a workspace." Building this means first
deciding whether some windows should opt out of live-sync, not just adding
UI.

## Sync (Phase 2, shipped) & team (Phase 3, not implemented)

Cross-device sync is built — see `architecture-sync.md`'s own diagrams
(Push, Pull + conflict resolution) for the "under the hood" traces, not
duplicated here. In short: you save a Project/Quest on your laptop, open the
browser on a different machine signed into the same account, and it's
already there — `updated_at` last-write-wins, no merge UI.

**Team scenario, still unbuilt:** in Phase 3, a teammate opens the same
shared Project and sees your tab list update in real time via Supabase
Realtime.
