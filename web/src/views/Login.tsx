import { createSignal } from "solid-js";
import { supabase } from "../supabase";

// Simpler than the extension's sign-in (typed-OTP code,
// browser.identity.launchWebAuthFlow): those workarounds exist only
// because of extension-specific redirect-URL limits (chrome-extension://
// pinning, Firefox's randomized uuid, Edge's no-pre-pin — see
// docs/architecture-sync.md's M3 notes). A plain web page has none of
// that, so this uses supabase-js's standard flows directly.
export function Login() {
  const [email, setEmail] = createSignal("");
  const [linkSent, setLinkSent] = createSignal(false);
  const [error, setError] = createSignal("");

  async function handleSendMagicLink(e: Event) {
    e.preventDefault();
    setError("");
    const { error } = await supabase!.auth.signInWithOtp({
      email: email(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else setLinkSent(true);
  }

  async function handleGoogleSignIn() {
    setError("");
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  return (
    <div class="flex min-h-screen items-center justify-center bg-surface p-8 font-sans text-surface-txt">
      <div class="w-full max-w-sm rounded border border-surface-alt3 bg-surface-alt1 p-6 shadow-[var(--shadow-raised)]">
        <h2 class="mb-4 text-lg font-medium">Sign in to cntxt</h2>
        {linkSent() ? (
          <p class="text-sm text-surface-txt-hint">
            Check {email()} for a sign-in link.
          </p>
        ) : (
          <>
            <form class="flex flex-col gap-2" onSubmit={handleSendMagicLink}>
              <input
                type="email"
                required
                placeholder="you@example.com"
                class="input bg-surface-alt2"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
              />
              <button
                type="submit"
                class="btn border-none bg-accent text-accent-txt hover:bg-accent-alt1"
              >
                Send magic link
              </button>
            </form>
            <div class="my-3 text-center text-xs text-surface-txt-hint">or</div>
            <button
              onClick={handleGoogleSignIn}
              class="btn w-full border border-surface-alt3"
            >
              Continue with Google
            </button>
          </>
        )}
        {error() && <p class="mt-3 text-sm text-danger">{error()}</p>}
      </div>
    </div>
  );
}
