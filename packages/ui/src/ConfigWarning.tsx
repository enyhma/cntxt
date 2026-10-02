import type { JSX } from "solid-js";

// Both apps render this exact block when their Supabase env vars aren't
// set — only the instructions (file paths, var name prefixes, dev command)
// differ, so those are passed in as children rather than templated here.
export function ConfigWarning(props: { children: JSX.Element }) {
  return (
    <div class="min-h-screen bg-surface p-8 font-sans text-surface-txt">
      <div class="mx-auto max-w-2xl rounded border border-warning bg-warning/10 p-4 text-sm shadow-[var(--shadow-card)]">
        <p class="font-medium">Supabase isn't configured yet.</p>
        <p class="mt-1">{props.children}</p>
      </div>
    </div>
  );
}
