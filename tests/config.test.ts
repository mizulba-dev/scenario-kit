import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/lib/config";

const validBrand = {
  name: "PaPut",
  tagline: "tagline",
  url: "paput.io",
  bg: "#1E293B",
  accent: "#6366F1",
  text: "#F8FAFC",
};

describe("parseConfig", () => {
  it('accepts a minimal config and defaults outDir to "out"', () => {
    const config = parseConfig("/proj/demoreel", { brand: validBrand });
    expect(config.outDir).toBe(join("/proj/demoreel", "out"));
    expect(config.storageState).toBeUndefined();
    expect(config.brand).toEqual(validBrand);
  });

  it("resolves outDir and storageState relative to the config directory", () => {
    const config = parseConfig("/proj/demoreel", {
      brand: validBrand,
      outDir: "build",
      storageState: ".auth/state.json",
    });
    expect(config.outDir).toBe(join("/proj/demoreel", "build"));
    expect(config.storageState).toBe(join("/proj/demoreel", ".auth/state.json"));
  });

  it("keeps an absolute storageState untouched", () => {
    const config = parseConfig("/proj/demoreel", {
      brand: validBrand,
      storageState: "/secure/state.json",
    });
    expect(config.storageState).toBe("/secure/state.json");
  });

  it("rejects a non-object config", () => {
    expect(() => parseConfig("/proj/demoreel", null)).toThrow("must be an object");
  });

  it("rejects an invalid brand with the config file context", () => {
    expect(() => parseConfig("/proj/demoreel", { brand: { ...validBrand, bg: "navy" } })).toThrow(
      "demoreel/config.json",
    );
  });

  it("rejects a non-string outDir", () => {
    expect(() => parseConfig("/proj/demoreel", { brand: validBrand, outDir: 1 })).toThrow(
      '"outDir"',
    );
  });

  it("rejects an unknown top-level key (e.g. a typo like outdir)", () => {
    expect(() => parseConfig("/proj/demoreel", { brand: validBrand, outdir: "out" })).toThrow(
      '"outdir"',
    );
  });
});

describe("loadConfig", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("searches upward from a nested cwd to find demoreel/config.json", () => {
    root = mkdtempSync(join(tmpdir(), "demoreel-config-"));
    const demoreelDir = join(root, "demoreel");
    const nestedCwd = join(root, "nested", "deeper");
    mkdirSync(demoreelDir, { recursive: true });
    mkdirSync(nestedCwd, { recursive: true });
    writeFileSync(join(demoreelDir, "config.json"), JSON.stringify({ brand: validBrand }));

    const config = loadConfig(nestedCwd);
    expect(config.dir).toBe(demoreelDir);
    expect(config.outDir).toBe(join(demoreelDir, "out"));
  });

  it("throws a UserError when no demoreel/config.json is found", () => {
    root = mkdtempSync(join(tmpdir(), "demoreel-config-"));
    expect(() => loadConfig(root)).toThrow("demoreel/config.json not found");
  });
});
