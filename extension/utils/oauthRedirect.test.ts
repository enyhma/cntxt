import { describe, expect, it } from "vitest";
import { parseTokensFromRedirectUrl } from "./oauthRedirect";

describe("parseTokensFromRedirectUrl", () => {
  it("extracts access_token and refresh_token from the hash fragment", () => {
    const url =
      "https://abc.chromiumapp.org/#access_token=at123&refresh_token=rt456&expires_in=3600&token_type=bearer";
    expect(parseTokensFromRedirectUrl(url)).toEqual({
      accessToken: "at123",
      refreshToken: "rt456",
    });
  });

  it("returns null when access_token is missing", () => {
    const url = "https://abc.chromiumapp.org/#refresh_token=rt456";
    expect(parseTokensFromRedirectUrl(url)).toBeNull();
  });

  it("returns null when refresh_token is missing", () => {
    const url = "https://abc.chromiumapp.org/#access_token=at123";
    expect(parseTokensFromRedirectUrl(url)).toBeNull();
  });

  it("returns null when there's no hash fragment at all", () => {
    expect(
      parseTokensFromRedirectUrl("https://abc.chromiumapp.org/"),
    ).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(parseTokensFromRedirectUrl("not a url")).toBeNull();
  });

  it("returns null for undefined (e.g. the user cancelled the flow)", () => {
    expect(parseTokensFromRedirectUrl(undefined)).toBeNull();
  });
});
