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
    const config = parseConfig("/proj/scenario-kit", { brand: validBrand });
    expect(config.outDir).toBe(join("/proj/scenario-kit", "out"));
    expect(config.storageState).toBeUndefined();
    expect(config.brand).toEqual(validBrand);
  });

  it("resolves outDir and storageState relative to the config directory", () => {
    const config = parseConfig("/proj/scenario-kit", {
      brand: validBrand,
      outDir: "build",
      storageState: ".auth/state.json",
    });
    expect(config.outDir).toBe(join("/proj/scenario-kit", "build"));
    expect(config.storageState).toBe(join("/proj/scenario-kit", ".auth/state.json"));
  });

  it("keeps an absolute storageState untouched", () => {
    const config = parseConfig("/proj/scenario-kit", {
      brand: validBrand,
      storageState: "/secure/state.json",
    });
    expect(config.storageState).toBe("/secure/state.json");
  });

  it("rejects a non-object config", () => {
    expect(() => parseConfig("/proj/scenario-kit", null)).toThrow("must be an object");
  });

  it("rejects an invalid brand with the config file context", () => {
    expect(() =>
      parseConfig("/proj/scenario-kit", { brand: { ...validBrand, bg: "navy" } }),
    ).toThrow("scenario-kit/config.json");
  });

  it("rejects a non-string outDir", () => {
    expect(() => parseConfig("/proj/scenario-kit", { brand: validBrand, outDir: 1 })).toThrow(
      '"outDir"',
    );
  });

  it("rejects an unknown top-level key (e.g. a typo like outdir)", () => {
    expect(() => parseConfig("/proj/scenario-kit", { brand: validBrand, outdir: "out" })).toThrow(
      '"outdir"',
    );
  });
});

describe("loadConfig", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("searches upward from a nested cwd to find scenario-kit/config.json", () => {
    root = mkdtempSync(join(tmpdir(), "scenario-kit-config-"));
    const scenarioKitDir = join(root, "scenario-kit");
    const nestedCwd = join(root, "nested", "deeper");
    mkdirSync(scenarioKitDir, { recursive: true });
    mkdirSync(nestedCwd, { recursive: true });
    writeFileSync(join(scenarioKitDir, "config.json"), JSON.stringify({ brand: validBrand }));

    const config = loadConfig(nestedCwd);
    expect(config.dir).toBe(scenarioKitDir);
    expect(config.outDir).toBe(join(scenarioKitDir, "out"));
  });

  it("throws a UserError when no scenario-kit/config.json is found", () => {
    root = mkdtempSync(join(tmpdir(), "scenario-kit-config-"));
    expect(() => loadConfig(root)).toThrow("scenario-kit/config.json not found");
  });
});
