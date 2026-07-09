import { describe, expect, it } from "vitest";
import { parseBrand } from "../src/lib/brand";

const valid = {
  name: "PaPut",
  tagline: "tagline",
  url: "paput.io",
  bg: "#1E293B",
  accent: "#6366F1",
  text: "#F8FAFC",
};

describe("parseBrand", () => {
  it("accepts a valid config", () => {
    expect(parseBrand(valid)).toEqual(valid);
  });

  it("rejects non-object values", () => {
    expect(() => parseBrand(null)).toThrow("must be an object");
    expect(() => parseBrand("a")).toThrow("must be an object");
  });

  it("rejects missing or empty fields with the field name", () => {
    expect(() => parseBrand({ ...valid, url: "" })).toThrow('"url"');
    const { tagline: _tagline, ...missing } = valid;
    expect(() => parseBrand(missing)).toThrow('"tagline"');
  });

  it("rejects non-hex colors with the field name", () => {
    expect(() => parseBrand({ ...valid, bg: "navy" })).toThrow('"bg"');
    expect(() => parseBrand({ ...valid, accent: "#12345" })).toThrow('"accent"');
  });
});
