# Workspace activation semantics

Relative to _this window_, a workspace is always shown with one of the visual
treatments below. This is the fixed vocabulary — color, icon, copy — for
signaling workspace status and the actions attached to it. Anywhere the
dashboard shows a workspace (sidebar row, collapsed rail chip, header
breadcrumb, pinned-tab favicon/title, action buttons) should draw from this
table rather than inventing new treatment.

| State                             | Meaning                                                                                                                                                                                                       | Color                                                | Icon                                    | Copy                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **Active (here)**                 | This workspace is the one mapped to _this_ window right now (`w.id === currentId()`).                                                                                                                         | `accent` ring around the workspace's identity dot    | — (ring is enough; no extra glyph)      | "Active"                                                             |
| **Active elsewhere**              | Mapped to a _different_ window right now (`openIds().has(w.id)` and not current).                                                                                                                             | `surface-txt-hint` (muted, not accent)               | `AppWindow`, small, next to the name    | "Open elsewhere"                                                     |
| **Would become active — connect** | This window has _no_ active workspace right now; the hovered/focused control would attach it to this one.                                                                                                     | `accent` (matches the existing primary-action color) | `Plug`                                  | "Connect to this workspace" (button), "Connect here" (icon-only)     |
| **Would become active — switch**  | This window already has a _different_ active workspace; the hovered/focused control would replace it with this one.                                                                                           | `accent`                                             | `ArrowRightLeft`, not `Play`            | "Switch to this workspace" (button), "Switch here" (icon-only)       |
| **Would no longer be active**     | The workspace currently active-here, at the moment a switch-away action is pending (connect never triggers this — there's nothing to replace).                                                                | `warning` (a change is coming, nothing destructive)  | dashed/ghost variant of the accent ring | "Leaving" / inline note: "Replaces &lt;name&gt;'s tabs"              |
| **Disconnect**                    | Detaches _this_ window from its active workspace, then closes its tabs — the workspace's saved tab list is left exactly as it was, not overwritten to empty. Only ever shown on the Active (here) row/button. | `surface-txt-hint` default, `warning` on hover       | `Unplug`                                | "Disconnect" — same single word everywhere: tooltip and button label |
| **Dormant (default)**             | Saved workspace that's neither current nor open elsewhere — the baseline every other row is a departure from.                                                                                                 | none                                                 | none — identity dot only                | none                                                                 |

Connect and switch are the same underlying action (attach this window to the
clicked workspace, replacing whatever tabs are currently open) — they only
differ in whether this window had an active workspace to begin with, which is
why they get distinct icons/copy instead of one control that silently means
two different things.

## Adjacent browser concepts

This vocabulary is about workspace _identity_ relative to a window. Related
native browser concepts sort into three buckets — worth naming so future
states aren't invented that collide with or duplicate what the browser
already owns:

- **Avoid colliding with:** the browser's own tab groups (color/label chip)
  and Firefox's contextual-identity containers (also color-coded per
  container). Neither is modeled by this extension today — a workspace's
  identity dot/color should stay visually distinct from both so a workspace
  is never mistaken for a native group or container.
- **Candidate for reuse later:** tab groups. A workspace could one day _be
  represented as_ a native tab group inside its window rather than a plain
  set of tabs — if that happens, workspace identity and group identity
  would need to merge, not layer two conflicting treatments.
- **Explicitly out of scope for this vocabulary:** a tab's memory/discarded
  state. It's a per-device runtime fact (a tab can be open but unloaded),
  not part of a workspace's identity, and — relevant once Phase 2 sync
  exists — not something that carries meaningfully across machines. This
  table never gains a state for it.
