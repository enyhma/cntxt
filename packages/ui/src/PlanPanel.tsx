import { Show } from "solid-js";
import type { Accessor } from "solid-js";

// Extracted out of SettingsPanel's "USAGE & LIMITS" block so a caller with
// no device-local settings to show (web/'s standalone dashboard — there's
// no browser.storage.local there, so startupBehavior/theme/etc. don't
// exist) can render just the plan/billing state on its own, instead of
// being forced to supply fake values for six unrelated required props just
// to reach this part of SettingsPanel. SettingsPanel itself now composes
// this component internally — behavior-identical for the extension.
export function PlanPanel(props: {
  maxWorkspaces?: Accessor<number | undefined>;
  groupCount?: Accessor<number>;
  projectCount?: Accessor<number>;
  syncedCount?: Accessor<number>;
  blockedCount?: Accessor<number>;
  overLimitCount?: Accessor<number>;
  accessExpiresAt?: Accessor<string | null | undefined>;
  trashedCount?: Accessor<number>;
  trashRetentionDays?: Accessor<number>;
  hasBasicLicense?: Accessor<boolean>;
  monthlyCheckoutUrl?: string;
  yearlyCheckoutUrl?: string;
  basicCheckoutUrl?: string;
}) {
  return (
    <Show when={props.maxWorkspaces}>
      <div class="flex flex-col gap-2 rounded border border-surface-alt3 bg-surface-alt1 p-3.5 text-sm shadow-[var(--shadow-card)]">
        <span class="font-mono text-[11px] tracking-wider text-surface-txt-faint">
          USAGE &amp; LIMITS
        </span>
        <div class="flex items-baseline gap-1.5">
          <span class="text-lg font-semibold">
            {props.syncedCount?.() ?? 0}
          </span>
          <span class="text-surface-txt-hint">
            of {props.maxWorkspaces!()} used
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-alt3">
          <div
            class={
              "h-full rounded-full " +
              ((props.overLimitCount?.() ?? 0) > 0 ||
              (props.blockedCount?.() ?? 0) > 0
                ? "bg-warning"
                : "bg-accent")
            }
            style={{
              width: `${Math.min(
                100,
                ((props.syncedCount?.() ?? 0) /
                  Math.max(1, props.maxWorkspaces!() ?? 1)) *
                  100,
              )}%`,
            }}
          />
        </div>
        <span class="text-xs text-surface-txt-hint">
          {props.groupCount?.() ?? 0} group
          {props.groupCount?.() === 1 ? "" : "s"}, {props.projectCount?.() ?? 0}{" "}
          project
          {props.projectCount?.() === 1 ? "" : "s"}
        </span>
        <Show when={(props.blockedCount?.() ?? 0) > 0}>
          <span class="text-xs text-warning">
            {props.blockedCount!()} not syncing — plan limit reached
          </span>
        </Show>
        <Show when={(props.overLimitCount?.() ?? 0) > 0}>
          <span class="text-xs text-warning">
            {props.overLimitCount!()} over your plan's limit
          </span>
        </Show>
        <span class="text-xs text-surface-txt-hint">
          {props.accessExpiresAt?.()
            ? `Pro, active until ${new Date(
                props.accessExpiresAt()!,
              ).toLocaleDateString()}`
            : props.hasBasicLicense?.()
              ? "Basic plan"
              : "Free plan"}
        </span>
        <Show when={(props.trashedCount?.() ?? 0) > 0}>
          <span class="text-xs text-surface-txt-hint">
            {props.trashedCount!()} in trash, kept{" "}
            {props.trashRetentionDays?.() ?? 7} days
          </span>
        </Show>
        <Show when={props.monthlyCheckoutUrl && props.yearlyCheckoutUrl}>
          <div class="mt-1 flex flex-wrap gap-2">
            <a
              href={props.monthlyCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-xs border-none bg-accent text-accent-txt hover:bg-accent-alt1"
            >
              Upgrade — Monthly
            </a>
            <a
              href={props.yearlyCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-xs border border-surface-alt3"
            >
              Upgrade — Yearly
            </a>
            <Show when={props.basicCheckoutUrl && !props.hasBasicLicense?.()}>
              <a
                href={props.basicCheckoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-xs border border-surface-alt3"
              >
                Buy Basic — one-time
              </a>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
