import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt2b4ZN+HRDxf4Ks6Xo0k74HQFdf3pS0n/HT+0uBQ1/hs0hhUBm4iPHeycRYZuwoXvhhXBKTRjJC0iJW5kF6aCMM/QQx5S66b04UJbEzjBKpeXiR9i44PEr0vRT+fGTsJXUKDPEjhj4Pjn6HyiSy6UVAGcM92UYKf5b2WXCfg3EZiZlDbEQfhTX6Szu0NRWBHZRnCulGkvP5bOamjtfth9+z4Dpv19YqmtWRu2GPmmEej9EZSjMP+zCrbLwaJpyJc+o4ljmmrH2ZgUSB6aED0o+wgh/ZI5sr/dwy8i/2rq/u6sY3npe7knGh/sdOlQRa/aa6sEWJnd++aHTuopdCoiQIDAQAB";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    // Catch a missing/unset Supabase config at build time instead of
    // shipping a zip that silently shows "Supabase isn't configured" —
    // this is what CI's `pnpm release` (and any local `build`/`zip`) hits
    // if WXT_SUPABASE_URL / WXT_SUPABASE_PUBLISHABLE_KEY aren't in the
    // env (see .env.example, .github/workflows/release.yml).
    "build:before": (wxt) => {
      if (
        wxt.config.mode === "production" &&
        (!process.env.WXT_SUPABASE_URL ||
          !process.env.WXT_SUPABASE_PUBLISHABLE_KEY)
      ) {
        throw new Error(
          "WXT_SUPABASE_URL / WXT_SUPABASE_PUBLISHABLE_KEY must be set for a production build. See extension/.env.example.",
        );
      }
    },
  },
  manifest: (env) => {
    const base = {
      // "identity" is for browser.identity.launchWebAuthFlow /
      // getRedirectURL (Google sign-in) — see App.tsx handleGoogleSignIn.
      // Deliberately not using a plain page-redirect OAuth flow: that would
      // reintroduce exactly the per-browser redirect-URL problem this
      // permission avoids (chrome-extension:// pinning, Edge's
      // can't-pin-ahead-of-time id, Firefox's randomized moz-extension://
      // uuid — see docs/architecture-sync.md).
      permissions: ["tabs", "storage", "identity"] as const,
      action: {},
    };

    if (env.browser === "chrome") {
      // Pins the extension ID to the one Chrome Web Store assigned to the
      // draft listing (ehnhkcnmbkboaljolbndgdgfmjkgipih), so local dev
      // builds and the eventually-published version share one stable id —
      // needed so the Supabase auth redirect URL
      // (chrome-extension://<id>/dashboard.html) never has to change. This
      // is the PUBLIC half of the keypair — safe to commit, not a secret.
      //
      // Also covers Edge for local *testing* purposes (same Chromium id
      // algorithm), but NOT for the published Edge Add-on: Microsoft's own
      // support answer confirms Edge Add-ons always assigns its own id on
      // publish and doesn't honor `key` — see docs/... TODO once decided.
      return { ...base, key: CHROME_KEY };
    }

    if (env.browser === "firefox") {
      return {
        ...base,
        browser_specific_settings: {
          // Fixes cntxt's identity for AMO updates/versioning — this does
          // NOT make the runtime moz-extension://<uuid> redirect URL
          // stable, though: Firefox randomizes that uuid per browser
          // profile on install, specifically to prevent extension
          // fingerprinting. See the auth redirect discussion in
          // docs/architecture-sync.md before wiring Firefox sign-in.
          gecko: { id: "{7d2117d6-63a3-4d90-9c8a-671515993bc9}" },
        },
      };
    }

    // Edge and anything else (e.g. `-b edge`): no `key` (Edge Add-ons
    // rejects/ignores it and there's no way to pre-pin an id there per
    // Microsoft support), so the Supabase redirect URL for Edge can only be
    // registered *after* creating a draft listing and reading the id it
    // assigns — same process as Chrome, just without the pinning step.
    return base;
  },
});
