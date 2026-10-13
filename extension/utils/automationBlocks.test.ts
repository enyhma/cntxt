import { describe, expect, it } from "vitest";
import { BLOCK_REGISTRY } from "./automationBlocks";
import type { Group } from "./groups";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    name: "Group",
    tabs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
    ...overrides,
  };
}

describe("groupDoneAndStale trigger", () => {
  const block = BLOCK_REGISTRY.groupDoneAndStale;
  if (block.kind !== "trigger") throw new Error("expected a trigger block");

  it("does not match a group that isn't done", () => {
    expect(block.matches(group({ status: "active" }), { days: 30 })).toBe(
      false,
    );
  });

  it("does not match a done group that was seen recently", () => {
    expect(
      block.matches(group({ status: "done", lastSeenAt: Date.now() }), {
        days: 30,
      }),
    ).toBe(false);
  });

  it("matches a done group unseen for longer than the configured days", () => {
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(
      block.matches(group({ status: "done", lastSeenAt: longAgo }), {
        days: 30,
      }),
    ).toBe(true);
  });
});

describe("groupTabsEmpty trigger", () => {
  const block = BLOCK_REGISTRY.groupTabsEmpty;
  if (block.kind !== "trigger") throw new Error("expected a trigger block");

  it("does not match a group with tabs open", () => {
    expect(
      block.matches(
        group({ tabs: [{ url: "https://a.example/", title: "" }] }),
        {},
      ),
    ).toBe(false);
  });

  it("does not match an already-done group", () => {
    expect(block.matches(group({ status: "done", tabs: [] }), {})).toBe(false);
  });

  it("matches a non-done group with zero tabs", () => {
    expect(block.matches(group({ status: "active", tabs: [] }), {})).toBe(true);
  });
});
