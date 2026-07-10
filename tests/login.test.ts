import { describe, expect, it } from "vitest";
import { UserError } from "../src/lib/errors";
import { assertLoginUrl, hasGitignoreEntry } from "../src/lib/login";

describe("assertLoginUrl", () => {
  it("accepts http and https URLs", () => {
    expect(() => assertLoginUrl("http://localhost:3000/login")).not.toThrow();
    expect(() => assertLoginUrl("https://example.com/login")).not.toThrow();
  });

  it("rejects URLs without an http(s) scheme", () => {
    for (const url of ["localhost:3000", "ftp://example.com", "example.com/login"]) {
      expect(() => assertLoginUrl(url)).toThrow(UserError);
    }
  });
});

describe("hasGitignoreEntry", () => {
  it("matches an exact line, ignoring surrounding whitespace", () => {
    expect(hasGitignoreEntry("out/\n.auth/\n", ".auth/")).toBe(true);
    expect(hasGitignoreEntry("  .auth/  \n", ".auth/")).toBe(true);
  });

  it("does not match substrings or partial paths", () => {
    expect(hasGitignoreEntry("out/.auth/\n", ".auth/")).toBe(false);
    expect(hasGitignoreEntry(".auth/state.json\n", ".auth/")).toBe(false);
    expect(hasGitignoreEntry("", ".auth/")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    expect(hasGitignoreEntry("out/\r\n.auth/\r\n", ".auth/")).toBe(true);
  });
});
