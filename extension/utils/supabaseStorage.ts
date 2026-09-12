/**
 * Adapts browser.storage.local's multi-key, object-based API to the
 * single-key string interface supabase-js expects for session persistence
 * (its SupportedStorage type) — extensions have no window.localStorage.
 */
export const extensionStorage = {
  async getItem(key: string): Promise<string | null> {
    const result = await browser.storage.local.get(key);
    return (result[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};
