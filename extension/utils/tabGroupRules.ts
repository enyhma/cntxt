import type { NativeColor } from "./tabGroups";

// Taught via the dashboard's "Always file groups like this here" group
// context-menu item (App.tsx) — snapshots a live native group's title/color
// at the moment it's taught, so a rule always carries whichever fields that
// group actually had then. No update/delete flow in v1: nothing calls one,
// so none is written (see captureGroups.ts for where rules get matched).
export type TabGroupRule = {
  id: string;
  matchTitle?: string;
  matchColor?: NativeColor;
  folderId: string;
  createdAt: number;
};

const STORAGE_KEY = "tabGroupRules";

export async function getTabGroupRules(): Promise<TabGroupRule[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as TabGroupRule[] | undefined) ?? [];
}

export async function addTabGroupRule(
  rule: Omit<TabGroupRule, "id" | "createdAt">,
): Promise<TabGroupRule> {
  const full: TabGroupRule = {
    ...rule,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const rules = await getTabGroupRules();
  await browser.storage.local.set({ [STORAGE_KEY]: [...rules, full] });
  return full;
}

// AND across whatever fields are set on the rule — a rule with neither
// matchTitle nor matchColor set matches nothing, guarding against an
// accidentally-empty rule silently swallowing every future group.
export function matchRule(
  rules: TabGroupRule[],
  group: { title?: string; color: string },
): TabGroupRule | undefined {
  return rules.find((r) => {
    if (r.matchTitle === undefined && r.matchColor === undefined) {
      return false;
    }
    if (
      r.matchTitle !== undefined &&
      (group.title ?? "").toLowerCase() !== r.matchTitle.toLowerCase()
    ) {
      return false;
    }
    if (r.matchColor !== undefined && group.color !== r.matchColor) {
      return false;
    }
    return true;
  });
}
