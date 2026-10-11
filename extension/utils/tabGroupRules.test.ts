import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { addTabGroupRule, getTabGroupRules, matchRule } from "./tabGroupRules";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("tabGroupRules storage", () => {
  it("starts empty", async () => {
    expect(await getTabGroupRules()).toEqual([]);
  });

  it("adds a rule with a generated id and timestamp", async () => {
    const rule = await addTabGroupRule({
      matchTitle: "Research",
      folderId: "folder-1",
    });
    expect(rule.id).toBeTruthy();
    expect(rule.createdAt).toBeGreaterThan(0);
    expect(await getTabGroupRules()).toEqual([rule]);
  });

  it("appends rather than overwriting existing rules", async () => {
    await addTabGroupRule({ matchTitle: "A", folderId: "f1" });
    await addTabGroupRule({ matchTitle: "B", folderId: "f2" });
    expect((await getTabGroupRules()).map((r) => r.matchTitle)).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("matchRule", () => {
  it("matches on title, case-insensitively", () => {
    const rules = [
      { id: "1", matchTitle: "Invoices", folderId: "f1", createdAt: 0 },
    ];
    expect(matchRule(rules, { title: "invoices", color: "grey" })?.id).toBe(
      "1",
    );
    expect(matchRule(rules, { title: "Other", color: "grey" })).toBeUndefined();
  });

  it("matches on color", () => {
    const rules = [
      {
        id: "1",
        matchColor: "blue" as const,
        folderId: "f1",
        createdAt: 0,
      },
    ];
    expect(matchRule(rules, { title: "anything", color: "blue" })?.id).toBe(
      "1",
    );
    expect(
      matchRule(rules, { title: "anything", color: "red" }),
    ).toBeUndefined();
  });

  it("requires both title and color to match when both are set on the rule", async () => {
    const rules = [
      {
        id: "1",
        matchTitle: "Work",
        matchColor: "blue" as const,
        folderId: "f1",
        createdAt: 0,
      },
    ];
    expect(matchRule(rules, { title: "Work", color: "red" })).toBeUndefined();
    expect(matchRule(rules, { title: "Other", color: "blue" })).toBeUndefined();
    expect(matchRule(rules, { title: "Work", color: "blue" })?.id).toBe("1");
  });

  it("never matches a rule with neither field set", () => {
    const rules = [{ id: "1", folderId: "f1", createdAt: 0 }];
    expect(
      matchRule(rules, { title: "anything", color: "grey" }),
    ).toBeUndefined();
  });

  it("matches a group with no title only via matchColor", () => {
    const rules = [
      { id: "1", matchColor: "grey" as const, folderId: "f1", createdAt: 0 },
    ];
    expect(matchRule(rules, { title: undefined, color: "grey" })?.id).toBe("1");
  });
});
