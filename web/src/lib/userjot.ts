// Loads the UserJot feedback widget SDK with its own floating launcher
// disabled (widget: false) — the app triggers it from its own "Feedback"
// button instead, so the button's label and placement match the rest of
// the UI rather than UserJot's default bubble. Same project + loader
// snippet as marketing/src/pages/index.astro's (floating) widget, just
// with widget:false + a manual openFeedback() trigger instead of true.
const PROJECT_ID = "cmulrcfq8009h0jnurgitgtvv";

declare global {
  interface Window {
    $ujq?: unknown[][];
    uj?: Record<string, (...args: unknown[]) => void>;
  }
}

let initialized = false;

export function initFeedbackWidget() {
  if (initialized) return;
  initialized = true;
  window.$ujq = window.$ujq || [];
  window.uj =
    window.uj ||
    new Proxy({} as Record<string, (...args: unknown[]) => void>, {
      get:
        (_, p: string) =>
        (...a: unknown[]) =>
          window.$ujq!.push([p, ...a]),
    });
  document.head.appendChild(
    Object.assign(document.createElement("script"), {
      src: "https://cdn.userjot.com/sdk/v2/uj.js",
      type: "module",
      async: true,
    }),
  );
  window.uj.init(PROJECT_ID, { widget: false });
}

export function openFeedback() {
  window.uj?.showWidget({ section: "feedback" });
}
