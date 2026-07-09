import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { UserError } from "./errors";
import { parseScenario, runSteps, type ScenarioContext } from "./steps";

export type ScenarioRunner = (ctx: ScenarioContext) => Promise<void>;

// TS シナリオはプレーンな default export 関数だけで動く（scenario-kit の import は不要
// なので npx 実行のみ・未インストールのプロジェクトでも書ける）。defineScenario は
// scenario-kit を devDependencies に持つプロジェクト向けの型補完用の恒等関数
export const defineScenario = (runner: ScenarioRunner): ScenarioRunner => runner;

// シナリオ解決順: <name>.json があればそれ、なければ <name>.ts を tsx の tsImport でロード
export const loadScenario = async (dir: string, name: string): Promise<ScenarioRunner> => {
  const jsonPath = join(dir, `${name}.json`);
  if (existsSync(jsonPath)) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch (err) {
      throw new UserError(
        `failed to parse ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const scenario = parseScenario(value);
    return (ctx) => runSteps(scenario.steps, ctx);
  }

  const tsPath = join(dir, `${name}.ts`);
  if (existsSync(tsPath)) {
    const { tsImport } = await import("tsx/esm/api");
    const mod = (await tsImport(pathToFileURL(tsPath).href, import.meta.url)) as {
      default?: ScenarioRunner;
    };
    if (typeof mod.default !== "function") {
      throw new UserError(
        `${tsPath}: default export must be a function (ctx: ScenarioContext) => Promise<void>`,
      );
    }
    return mod.default;
  }

  throw new UserError(`scenario not found: ${name}.json or ${name}.ts in ${dir}`);
};
