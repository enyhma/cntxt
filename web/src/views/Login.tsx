import { createSignal } from "solid-js";
import { supabase } from "../supabase";

// Typed OTP code, same as the extension's sign-in (App.tsx's
// handleSendCode/handleVerifyCode) — unified across both surfaces so
// signing in feels identical regardless of which one you're using. A
// clickable magic link would actually be simpler here (a plain web page
// has a stable https:// redirect URL, unlike the extension — see
// docs/architecture-sync.md's M3 notes on why it can't use one), but
// consistency with the extension won out.
export function Login() {
  const [email, setEmail] = createSignal("");
  const [otpSent, setOtpSent] = createSignal(false);
  const [otpCode, setOtpCode] = createSignal("");
  const [error, setError] = createSignal("");

  async function handleSendCode(e: Event) {
    e.preventDefault();
    setError("");
    const { error } = await supabase!.auth.signInWithOtp({ email: email() });
    if (error) setError(error.message);
    else setOtpSent(true);
  }

  async function handleVerifyCode(e: Event) {
    e.preventDefault();
    setError("");
    const { error } = await supabase!.auth.verifyOtp({
      email: email(),
      token: otpCode(),
      type: "email",
    });
    if (error) setError(error.message);
  }

  return (
    <div class="flex min-h-screen items-center justify-center bg-surface p-8 font-sans text-surface-txt">
      <div class="w-full max-w-sm rounded border border-surface-alt3 bg-surface-alt1 p-6 shadow-[var(--shadow-raised)]">
        <h2 class="mb-4 text-lg font-medium">Sign in to cntxt</h2>
        {otpSent() ? (
          <form class="flex flex-col gap-2" onSubmit={handleVerifyCode}>
            <p class="text-sm text-surface-txt-hint">
              Enter the code sent to {email()}.
            </p>
            <input
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
              placeholder="123456"
              class="input bg-surface-alt2"
              value={otpCode()}
              onInput={(e) => setOtpCode(e.currentTarget.value)}
            />
            <button
              type="submit"
              class="btn border-none bg-accent text-accent-txt hover:bg-accent-alt1"
            >
              Verify code
            </button>
          </form>
        ) : (
          <form class="flex flex-col gap-2" onSubmit={handleSendCode}>
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
              Send sign-in code
            </button>
          </form>
        )}
        {error() && <p class="mt-3 text-sm text-danger">{error()}</p>}
      </div>
    </div>
  );
}
