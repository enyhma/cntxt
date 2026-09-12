import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { extensionStorage } from "./supabaseStorage";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("extensionStorage", () => {
  it("returns null for a key that was never set", async () => {
    expect(await extensionStorage.getItem("session")).toBeNull();
  });

  it("round-trips a value through setItem/getItem", async () => {
    await extensionStorage.setItem("session", '{"access_token":"abc"}');
    expect(await extensionStorage.getItem("session")).toBe(
      '{"access_token":"abc"}',
    );
  });

  it("persists in browser.storage.local, not some other store", async () => {
    await extensionStorage.setItem("session", "value");
    const raw = await browser.storage.local.get("session");
    expect(raw.session).toBe("value");
  });

  it("removeItem clears the key", async () => {
    await extensionStorage.setItem("session", "value");
    await extensionStorage.removeItem("session");
    expect(await extensionStorage.getItem("session")).toBeNull();
  });

  it("keeps different keys independent", async () => {
    await extensionStorage.setItem("a", "1");
    await extensionStorage.setItem("b", "2");
    expect(await extensionStorage.getItem("a")).toBe("1");
    expect(await extensionStorage.getItem("b")).toBe("2");
  });
});
