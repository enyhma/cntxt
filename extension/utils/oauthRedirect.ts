export type OAuthTokens = { accessToken: string; refreshToken: string };

/**
 * Extracts the implicit-flow tokens from the URL browser.identity.
 * launchWebAuthFlow() resolves with. Returns null on anything short of a
 * clean success — missing tokens, malformed URL, or `undefined` (the user
 * closed/cancelled the auth window).
 */
export function parseTokensFromRedirectUrl(
  url: string | undefined,
): OAuthTokens | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}
