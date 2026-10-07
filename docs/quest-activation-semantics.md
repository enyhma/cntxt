# Quest/Project activation semantics

Relative to _this window_, whatever it's bound to (a Project or a standalone
Quest — see `CLAUDE.md`'s "Window binding") is always shown with one of the
visual treatments below. This is the fixed vocabulary — color, icon, copy —
for signaling that status and the actions attached to it. Anywhere the
dashboard shows a Project or Quest (sidebar row, collapsed rail chip, header
breadcrumb, pinned-tab favicon/title, action buttons) should draw from this
table rather than inventing new treatment.

| State                             | Meaning                                                                                                                                                                                             | Color                                                | Icon                                    | Copy                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **Active (here)**                 | This Project/Quest is what _this_ window is bound to right now (`id === currentId()`).                                                                                                              | `accent` ring around the identity dot                | — (ring is enough; no extra glyph)      | "Active"                                                             |
| **Active elsewhere**              | Bound to a _different_ window right now (`openIds().has(id)` and not current).                                                                                                                      | `surface-txt-hint` (muted, not accent)               | `AppWindow`, small, next to the name    | "Open elsewhere"                                                     |
| **Would become active — connect** | This window has _no_ active binding right now; the hovered/focused control would bind it to this one.                                                                                               | `accent` (matches the existing primary-action color) | `Plug`                                  | "Connect to this quest/project" (button), "Connect here" (icon-only) |
| **Would become active — switch**  | This window already has a _different_ binding; the hovered/focused control would replace it with this one.                                                                                          | `accent`                                             | `ArrowRightLeft`, not `Play`            | "Switch to this quest/project" (button), "Switch here" (icon-only)   |
| **Would no longer be active**     | The thing currently active-here, at the moment a switch-away action is pending (connect never triggers this — there's nothing to replace).                                                          | `warning` (a change is coming, nothing destructive)  | dashed/ghost variant of the accent ring | "Leaving" / inline note: "Replaces &lt;name&gt;'s tabs"              |
| **Disconnect**                    | Detaches _this_ window from whatever it's bound to, then closes its tabs — the saved tab list is left exactly as it was, not overwritten to empty. Only ever shown on the Active (here) row/button. | `surface-txt-hint` default, `warning` on hover       | `Unplug`                                | "Disconnect" — same single word everywhere: tooltip and button label |
| **Dormant (default)**             | Saved Project/Quest that's neither current nor open elsewhere — the baseline every other row is a departure from.                                                                                   | none                                                 | none — identity dot only                | none                                                                 |

Connect and switch are the same underlying action (bind this window to the
clicked Project or Quest, replacing whatever tabs are currently open) — they
only differ in whether this window had an active binding to begin with, which
is why they get distinct icons/copy instead of one control that silently
means two different things. This table is about a window's **binding**
(`WindowBinding`, `utils/session.ts`), not about a Quest nested under a
Project being swapped into that Project's already-open window — that's a
separate concept, below.

## A Quest swapped into its parent Project's window

The table above never applies to a Quest nested under a Project (its
`folderId` resolves to a `kind:"project"` Folder) while viewed from inside
that Project's own board: activating or completing it (`questSwapMachine.ts`,
`ACTIVATE_QUEST`/`COMPLETE_QUEST`) never changes the window's `WindowBinding`
— the window stays bound to the Project throughout, only
`Folder.activeQuestId` changes. That swap gets its own, narrower vocabulary
in `QuestBoardPanel` (`packages/ui/src/QuestBoardPanel.tsx`): "Activate" for a
`pending` or `done` sibling (reopening a completed one works identically to
activating a fresh one), "Complete quest" for the currently `active` one. A
standalone Quest (ungrouped, or parented to an Area rather than a Project)
has no sibling roster to swap within, so it only ever shows the
connect/switch/disconnect vocabulary above, exactly like a Project does.

## Adjacent browser concepts

This vocabulary is about Project/Quest _identity_ relative to a window.
Related native browser concepts sort into three buckets — worth naming so
future states aren't invented that collide with or duplicate what the
browser already owns:

- **Avoid colliding with:** the browser's own tab groups (color/label chip)
  and Firefox's contextual-identity containers (also color-coded per
  container). Neither is modeled by this extension today — a Project or
  Quest's identity dot/color should stay visually distinct from both so
  neither is ever mistaken for a native group or container.
- **Candidate for reuse later:** tab groups. A Project or Quest could one day
  _be represented as_ a native tab group inside its window rather than a
  plain set of tabs — if that happens, its identity and the group's identity
  would need to merge, not layer two conflicting treatments.
- **Explicitly out of scope for this vocabulary:** a tab's memory/discarded
  state. It's a per-device runtime fact (a tab can be open but unloaded), not
  part of a Project/Quest's identity, and not something that carries
  meaningfully across machines once sync is in play. This table never gains
  a state for it.
