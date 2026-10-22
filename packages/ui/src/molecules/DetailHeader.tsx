import type { JSX } from "solid-js";
import { BackButton } from "../atoms/BackButton";

// A Back button plus an optional slot for trailing actions (e.g. "Delete
// forever", "Move to trash") — the one row a drill-down detail view needs
// at its top. Deliberately no outer margin/page-padding opinion of its
// own: DetailPageShell (template) supplies that for views that need full
// page chrome, while a self-contained organism that already owns its own
// page padding (FolderPage, for an Area) can use this row directly with
// its own lighter wrapping instead — see web/src/App.tsx for both cases.
export function DetailHeader(props: {
  onBack: () => void;
  actions?: JSX.Element;
}) {
  return (
    <div class="flex items-center gap-2">
      <BackButton onClick={props.onBack} />
      {props.actions}
    </div>
  );
}
