import { describe, expect, it } from "vitest";
import { BLOCK_REGISTRY } from "./automationBlocks";
import type { Quest } from "./quests";

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q1",
    name: "Quest",
    tabs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
    ...overrides,
  };
}

describe("questDoneAndStale trigger", () => {
  const block = BLOCK_REGISTRY.questDoneAndStale;
  if (block.kind !== "trigger") throw new Error("expected a trigger block");

  it("does not match a quest that isn't done", () => {
    expect(block.matches(quest({ status: "active" }), { days: 30 })).toBe(
      false,
    );
  });

  it("does not match a done quest that was seen recently", () => {
    expect(
      block.matches(quest({ status: "done", lastSeenAt: Date.now() }), {
        days: 30,
      }),
    ).toBe(false);
  });

  it("matches a done quest unseen for longer than the configured days", () => {
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(
      block.matches(quest({ status: "done", lastSeenAt: longAgo }), {
        days: 30,
      }),
    ).toBe(true);
  });
});

describe("questTabsEmpty trigger", () => {
  const block = BLOCK_REGISTRY.questTabsEmpty;
  if (block.kind !== "trigger") throw new Error("expected a trigger block");

  it("does not match a quest with tabs open", () => {
    expect(
      block.matches(
        quest({ tabs: [{ url: "https://a.example/", title: "" }] }),
        {},
      ),
    ).toBe(false);
  });

  it("does not match an already-done quest", () => {
    expect(block.matches(quest({ status: "done", tabs: [] }), {})).toBe(false);
  });

  it("matches a non-done quest with zero tabs", () => {
    expect(block.matches(quest({ status: "active", tabs: [] }), {})).toBe(true);
  });
});
