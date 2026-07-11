import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAppScenario, type AppConfig, type AppStep } from "./app-steps";
import { UserError } from "./errors";
import { parseScenario, runSteps, type ScenarioContext } from "./steps";

export type ScenarioRunner = (ctx: ScenarioContext) => Promise<void>;

export type LoadedScenario =
  | { kind: "web"; scenario: ScenarioRunner }
  | { kind: "app"; app: AppConfig; steps: AppStep[] };

// TS シナリオはプレーンな default export 関数だけで動く（scenario-kit の import は不要
// なので npx 実行のみ・未インストールのプロジェクトでも書ける）。defineScenario は
// scenario-kit を devDependencies に持つプロジェクト向けの型補完用の恒等関数
export const defineScenario = (runner: ScenarioRunner): ScenarioRunner => runner;

const isAppScenarioValue = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "app" in value;

// シナリオ解決順: <name>.json があればそれ、なければ <name>.ts を tsx の tsImport でロード。
// app シナリオ（トップレベルに "app" キー）は JSON のみで、TS シナリオは常に web 扱い
export const loadScenario = async (dir: string, name: string): Promise<LoadedScenario> => {
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
    if (isAppScenarioValue(value)) {
      const { app, steps } = parseAppScenario(value);
      return { kind: "app", app, steps };
    }
    const scenario = parseScenario(value);
    return { kind: "web", scenario: (ctx) => runSteps(scenario.steps, ctx) };
  }

  const tsPath = join(dir, `${name}.ts`);
  if (existsSync(tsPath)) {
    const { tsImport } = await import("tsx/esm/api");
    const mod = (await tsImport(pathToFileURL(tsPath).href, import.meta.url)) as {
      default?: ScenarioRunner | { default?: ScenarioRunner };
    };
    // "type": "module" のないプロジェクトでは tsx が .ts を CJS として解釈し、
    // export default が { default: fn } に interop ラップされるため両対応で取り出す
    const runner = typeof mod.default === "function" ? mod.default : mod.default?.default;
    if (typeof runner !== "function") {
      throw new UserError(
        `${tsPath}: default export must be a function (ctx: ScenarioContext) => Promise<void>`,
      );
    }
    return { kind: "web", scenario: runner };
  }

  throw new UserError(`scenario not found: ${name}.json or ${name}.ts in ${dir}`);
};
