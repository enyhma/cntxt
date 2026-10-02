import type { Accessor } from "solid-js";

export type StartupBehavior = "none" | "lastUsed";
export type Theme = "baseline" | "indigo" | "brass";

export function SettingsPanel(props: {
  startupBehavior: Accessor<StartupBehavior>;
  onStartupBehaviorChange: (v: StartupBehavior) => void;
  theme: Accessor<Theme>;
  onThemeChange: (v: Theme) => void;
  manualPullEnabled: Accessor<boolean>;
  onManualPullEnabledChange: (v: boolean) => void;
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
        <label class="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
            checked={props.manualPullEnabled()}
            onChange={(e) =>
              props.onManualPullEnabledChange(e.currentTarget.checked)
            }
          />
          <span class="flex flex-col gap-0.5">
            <span>Manual sync pull (experimental)</span>
            <span class="text-xs text-surface-txt-hint">
              Adds a "Pull workspaces now" option to the account menu, to fetch
              from your account on demand instead of waiting for sign-in or a
              token refresh.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
