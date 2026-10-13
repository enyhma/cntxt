import { runScheduledAutomations } from "./automationEngine";

// This used to be the hardcoded check (status "done" + unreferenced by a
// session capture for Settings.autoArchiveDays); it's now expressed as
// the seeded "Archive stale done quests" Automation (utils/automations.ts),
// run by the generic schedule runner alongside any other
// "scheduleTick"-triggered automation — see utils/automationEngine.ts and
// utils/automationBlocks.ts. Kept as a thin re-export so
// entrypoints/background.ts's alarm-tick call site didn't need to change.
export const runAutoArchiveCheck = runScheduledAutomations;
