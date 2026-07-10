import { describe, expect, it } from "vitest";
import { shotFileName } from "../src/lib/shots";

describe("shotFileName", () => {
  it("zero-pads the index to 2 digits", () => {
    expect(shotFileName(1, "hero")).toBe("01-hero.png");
    expect(shotFileName(9, "hero")).toBe("09-hero.png");
    expect(shotFileName(12, "hero")).toBe("12-hero.png");
  });

  it("preserves non-ASCII labels such as Japanese", () => {
    expect(shotFileName(1, "ログイン画面")).toBe("01-ログイン画面.png");
  });

  it("replaces path separators and control characters with -", () => {
    expect(shotFileName(1, "a/b\\c")).toBe("01-a-b-c.png");
    expect(shotFileName(1, "line1\nline2")).toBe("01-line1-line2.png");
    expect(shotFileName(1, "tab\ttab")).toBe("01-tab-tab.png");
  });

  it("keeps other punctuation and spaces intact", () => {
    expect(shotFileName(1, "top nav (open)")).toBe("01-top nav (open).png");
  });
});
