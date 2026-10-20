import { describe, expect, it } from "vitest";
import { matchScore, TAB_URL_MATCH_SCORE } from "./search";

describe("matchScore", () => {
  it("scores an exact match highest", () => {
    expect(matchScore("Design review", "design review")).toBe(3);
  });

  it("scores a prefix match above a mid-string match", () => {
    expect(matchScore("Design review", "design")).toBe(2);
    expect(matchScore("Design review", "review")).toBe(1);
  });

  it("is case-insensitive on the text side (q is already lowercased by the caller)", () => {
    expect(matchScore("DESIGN REVIEW", "design review")).toBe(3);
    expect(matchScore("Design Review", "design")).toBe(2);
  });

  it("scores no match as 0", () => {
    expect(matchScore("Design review", "marketing")).toBe(0);
  });

  it("ranks exact > prefix > substring > no match, strictly descending", () => {
    const exact = matchScore("design", "design");
    const prefix = matchScore("design review", "design");
    const substring = matchScore("a design review", "design");
    const none = matchScore("marketing", "design");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(none);
  });
});

describe("TAB_URL_MATCH_SCORE", () => {
  it("sits strictly below even the weakest name-match score", () => {
    expect(TAB_URL_MATCH_SCORE).toBeGreaterThan(0);
    expect(TAB_URL_MATCH_SCORE).toBeLessThan(
      matchScore("a design review", "design"),
    );
  });
});
