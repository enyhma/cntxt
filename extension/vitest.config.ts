import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    setupFiles: ["./test/setup.ts"],
    // e2e/ is Playwright's suite (`pnpm e2e`), not vitest's — it drives a
    // real built browser, which vitest/fakeBrowser can't do.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
