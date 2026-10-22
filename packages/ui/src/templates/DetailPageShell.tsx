import type { JSX } from "solid-js";
import { DetailHeader } from "../molecules/DetailHeader";

// Page-level chrome for a drill-down detail view (a Project, a standalone
// Group, ...): consistent padding/max-width plus a DetailHeader up top.
// Deliberately NOT used by every detail-style view — FolderPage (an
// Area's page) already owns equivalent page chrome itself as a
// self-contained organism, so wrapping it in this too would double the
// padding; that case composes DetailHeader directly instead (see
// web/src/App.tsx). A template arranges organisms/molecules into a
// layout — it doesn't force every view through one rigid shape.
export function DetailPageShell(props: {
  onBack: () => void;
  headerActions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="p-6">
      <div class="mb-4">
        <DetailHeader onBack={props.onBack} actions={props.headerActions} />
      </div>
      <div class="flex max-w-2xl flex-col gap-5">{props.children}</div>
    </div>
  );
}
