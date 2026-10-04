// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tina from "@tinacms/astro/integration";

// https://astro.build/config
export default defineConfig({
  site: "https://cntxt.work",
  // Everything prerenders to static HTML by default; only
  // src/pages/tina-island/[name].ts opts out (export const prerender =
  // false) to power Tina's live-preview bridge. See src/tina/islands.ts.
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [tina()],
});
