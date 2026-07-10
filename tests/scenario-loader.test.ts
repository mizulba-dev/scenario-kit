import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadScenario } from "../src/lib/scenario-loader";

// tsx の tsImport 自体は本物の動的トランスパイルを行う（plain node 実行では確認済み）。
// Vitest（Vite の ESM ローダー）配下でプロジェクト外の .ts を実 tsImport すると default
// export が二重ラップされるテスト環境固有の癖があるため、ここではモックしてロジックのみ検証する。
vi.mock("tsx/esm/api", () => ({ tsImport: vi.fn() }));

describe("loadScenario", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    const { tsImport } = await import("tsx/esm/api");
    vi.mocked(tsImport).mockReset();
  });

  it("loads a <name>.json scenario and runs it against a fake page", async () => {
    dir = mkdtempSync(join(tmpdir(), "scenario-kit-scenario-"));
    writeFileSync(
      join(dir, "landing.json"),
      JSON.stringify({ steps: [{ goto: "https://example.com" }, { mark: "start" }] }),
    );

    const runner = await loadScenario(dir, "landing");
    const goto = vi.fn(async () => {});
    const mark = vi.fn();
    const highlight = vi.fn(async () => {});
    const screenshot = vi.fn(async () => {});
    await runner({ page: { goto } as never, mark, highlight, screenshot });

    expect(goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "networkidle" });
    expect(mark).toHaveBeenCalledWith("start");
  });

  it("prefers <name>.json over <name>.ts when both exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "scenario-kit-scenario-"));
    writeFileSync(join(dir, "landing.json"), JSON.stringify({ steps: [{ mark: "json" }] }));
    writeFileSync(join(dir, "landing.ts"), "export default async (ctx) => { ctx.mark('ts'); };\n");

    const runner = await loadScenario(dir, "landing");
    const mark = vi.fn();
    const highlight = vi.fn(async () => {});
    const screenshot = vi.fn(async () => {});
    await runner({ page: {} as never, mark, highlight, screenshot });

    expect(mark).toHaveBeenCalledWith("json");
  });

  it("loads a <name>.ts scenario via tsImport when no json file exists", async () => {
    dir = mkdtempSync(join(tmpdir(), "scenario-kit-scenario-"));
    writeFileSync(
      join(dir, "landing.ts"),
      "export default async (ctx) => { ctx.mark('from-ts'); };\n",
    );

    const runner = vi.fn(async (ctx: { mark: (label: string) => void }) => ctx.mark("from-ts"));
    const { tsImport } = await import("tsx/esm/api");
    vi.mocked(tsImport).mockResolvedValueOnce({ default: runner });

    const loaded = await loadScenario(dir, "landing");
    const mark = vi.fn();
    const highlight = vi.fn(async () => {});
    const screenshot = vi.fn(async () => {});
    await loaded({ page: {} as never, mark, highlight, screenshot });

    expect(tsImport).toHaveBeenCalledWith(
      expect.stringContaining("landing.ts"),
      expect.any(String),
    );
    expect(mark).toHaveBeenCalledWith("from-ts");
  });

  it("throws a UserError when the ts scenario has no function default export", async () => {
    dir = mkdtempSync(join(tmpdir(), "scenario-kit-scenario-"));
    writeFileSync(join(dir, "landing.ts"), "export const notDefault = 1;\n");

    const { tsImport } = await import("tsx/esm/api");
    vi.mocked(tsImport).mockResolvedValueOnce({ default: undefined });

    await expect(loadScenario(dir, "landing")).rejects.toThrow("default export must be a function");
  });

  it("throws a UserError when neither json nor ts scenario exists", async () => {
    dir = mkdtempSync(join(tmpdir(), "scenario-kit-scenario-"));
    await expect(loadScenario(dir, "missing")).rejects.toThrow("scenario not found");
  });
});
