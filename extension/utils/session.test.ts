import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  clearWindowBindingMap,
  getWindowBindingBackup,
  getWindowBindingMap,
  removeWindowBinding,
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
