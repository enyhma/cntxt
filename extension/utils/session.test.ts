import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  clearWindowBindingMap,
  consumeSearchOpenRequest,
  getWindowBindingBackup,
  getWindowBindingMap,
  removeWindowBinding,
  requestSearchOpen,
  setWindowBinding,
} from "./session";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("storage.local backup", () => {
  it("mirrors every write so it survives storage.session being wiped", async () => {
    await setWindowBinding(1, { kind: "project", projectId: "p1" });
    await setWindowBinding(2, { kind: "group", groupId: "g1" });

    // Simulate a mid-session extension reload: storage.session is wiped,
    // storage.local (and its backup) isn't.
    await browser.storage.session.clear();

    expect(await getWindowBindingMap()).toEqual({});
    expect(await getWindowBindingBackup()).toEqual({
      1: { kind: "project", projectId: "p1" },
      2: { kind: "group", groupId: "g1" },
    });
  });

  it("mirrors removal too, not just additions", async () => {
    await setWindowBinding(1, { kind: "project", projectId: "p1" });
    await removeWindowBinding(1);

    expect(await getWindowBindingBackup()).toEqual({});
  });
});

describe("clearWindowBindingMap", () => {
  it("empties storage.session only, leaving the storage.local backup intact", async () => {
    await setWindowBinding(1, { kind: "project", projectId: "p1" });
    await clearWindowBindingMap();

    expect(await getWindowBindingMap()).toEqual({});
    expect(await getWindowBindingBackup()).toEqual({
      1: { kind: "project", projectId: "p1" },
    });
  });
});

describe("requestSearchOpen / consumeSearchOpenRequest", () => {
  it("consumes a matching request exactly once", async () => {
    await requestSearchOpen(1);

    expect(await consumeSearchOpenRequest(1)).toBe(true);
    expect(await consumeSearchOpenRequest(1)).toBe(false);
  });

  it("doesn't consume a request meant for a different window", async () => {
    await requestSearchOpen(1);

    expect(await consumeSearchOpenRequest(2)).toBe(false);
    // Still pending for the window it was actually requested for.
    expect(await consumeSearchOpenRequest(1)).toBe(true);
  });

  it("a later request overwrites an unconsumed earlier one", async () => {
    await requestSearchOpen(1);
    await requestSearchOpen(2);

    expect(await consumeSearchOpenRequest(1)).toBe(false);
    expect(await consumeSearchOpenRequest(2)).toBe(true);
  });
});
