// Smallest reusable piece of a drill-down detail view's header — composed
// by DetailHeader (molecule), which in turn is composed by DetailPageShell
// (template). See those two for why this package is starting to lay out
// new components by atomic-design layer instead of the flat file list the
// 13 pre-existing components use — not a retroactive migration, just the
// convention going forward.
export function BackButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="btn btn-sm border border-surface-alt3"
    >
      ← Back
    </button>
  );
}
