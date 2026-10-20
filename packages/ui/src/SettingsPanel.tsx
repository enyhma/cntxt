import type { Accessor } from "solid-js";
import { PlanPanel } from "./PlanPanel";

export type StartupBehavior = "none" | "lastUsed";
export type Theme = "baseline" | "indigo" | "brass";

export function SettingsPanel(props: {
  startupBehavior: Accessor<StartupBehavior>;
  onStartupBehaviorChange: (v: StartupBehavior) => void;
  theme: Accessor<Theme>;
  onThemeChange: (v: Theme) => void;
  manualPullEnabled: Accessor<boolean>;
  onManualPullEnabledChange: (v: boolean) => void;
  experimentalFeaturesEnabled: Accessor<boolean>;
  onExperimentalFeaturesEnabledChange: (v: boolean) => void;
  autoArchiveDays: Accessor<number>;
  onAutoArchiveDaysChange: (v: number) => void;
  sessionCaptureIntervalMinutes: Accessor<number>;
  onSessionCaptureIntervalMinutesChange: (v: number) => void;
  // Usage & limits — all optional so this panel still renders sensibly
  // before entitlements have loaded (e.g. signed out, or mid-fetch).
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
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-md flex-col gap-5">
        <h2 class="text-base font-semibold">Settings</h2>

        <PlanPanel
          maxWorkspaces={props.maxWorkspaces}
          groupCount={props.groupCount}
          projectCount={props.projectCount}
          syncedCount={props.syncedCount}
          blockedCount={props.blockedCount}
          overLimitCount={props.overLimitCount}
          accessExpiresAt={props.accessExpiresAt}
          trashedCount={props.trashedCount}
          trashRetentionDays={props.trashRetentionDays}
          hasBasicLicense={props.hasBasicLicense}
          monthlyCheckoutUrl={props.monthlyCheckoutUrl}
          yearlyCheckoutUrl={props.yearlyCheckoutUrl}
          basicCheckoutUrl={props.basicCheckoutUrl}
        />

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
            <option value="lastUsed">Resume last used group</option>
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
              Adds a "Pull groups now" option to the account menu, to fetch from
              your account on demand instead of waiting for sign-in or a token
              refresh.
            </span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            class="checkbox checkbox-sm mt-0.5"
            checked={props.experimentalFeaturesEnabled()}
            onChange={(e) =>
              props.onExperimentalFeaturesEnabledChange(e.currentTarget.checked)
            }
          />
          <span class="flex flex-col gap-0.5">
            <span>Experimental features</span>
            <span class="text-xs text-surface-txt-hint">
              Turns on in-progress features, like Shortcuts, that aren't fully
              finished yet.
            </span>
          </span>
        </label>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="text-surface-txt-hint">
            Auto-archive done groups after
          </span>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="1"
              class="input input-sm w-20 bg-surface-alt1 shadow-[var(--shadow-card)]"
              value={props.autoArchiveDays()}
              onChange={(e) =>
                props.onAutoArchiveDaysChange(
                  Math.max(1, Number(e.currentTarget.value) || 1),
                )
              }
            />
            <span class="text-xs text-surface-txt-hint">
              days of inactivity
            </span>
          </div>
        </label>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="text-surface-txt-hint">Capture a snapshot every</span>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="1"
              class="input input-sm w-20 bg-surface-alt1 shadow-[var(--shadow-card)]"
              value={props.sessionCaptureIntervalMinutes()}
              onChange={(e) =>
                props.onSessionCaptureIntervalMinutesChange(
                  Math.max(1, Number(e.currentTarget.value) || 1),
                )
              }
            />
            <span class="text-xs text-surface-txt-hint">minutes</span>
          </div>
        </label>
      </div>
    </div>
  );
}
