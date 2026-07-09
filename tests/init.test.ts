import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../src/lib/init";

describe("runInit", () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("scaffolds config.json, scenarios/landing.json and .gitignore", () => {
    cwd = mkdtempSync(join(tmpdir(), "scenario-kit-init-"));

    const targetDir = runInit({ cwd });

    expect(targetDir).toBe(join(cwd, "scenario-kit"));
    expect(existsSync(join(targetDir, "config.json"))).toBe(true);
    expect(existsSync(join(targetDir, ".gitignore"))).toBe(true);

    const landing = JSON.parse(
      readFileSync(join(targetDir, "scenarios", "landing.json"), "utf8"),
    ) as { $schema: string; steps: unknown[] };
    expect(landing.$schema).toMatch(/^https:\/\/unpkg\.com\/scenario-kit@.+\/schema\//);
    expect(Array.isArray(landing.steps)).toBe(true);
  });

  it("throws a UserError when config.json already exists", () => {
    cwd = mkdtempSync(join(tmpdir(), "scenario-kit-init-"));
    runInit({ cwd });
    expect(() => runInit({ cwd })).toThrow("already exists");
  });
});
