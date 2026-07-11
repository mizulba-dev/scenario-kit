import type { Page } from "playwright";
import { UserError } from "./errors";

export type Step =
  | { goto: string }
  | { click: string }
  | { type: [string, string] }
  | { move: [number, number] }
  | { scroll: number }
  | { pause: number }
  | { waitFor: string }
  | { mark: string }
  | { highlight: string }
  | { screenshot: string };

export interface Scenario {
  steps: Step[];
}

export interface ScenarioContext {
  page: Page;
  mark: (label: string) => void;
  highlight: (locator: string) => Promise<void>;
  screenshot: (label: string) => Promise<void>;
  /** qa が step 境界（進行位置）を追跡するための内部フック。record/shots では未指定 */
  onStep?: (step: Step, index: number) => void;
}

export const STEP_KEYS = [
  "goto",
  "click",
  "type",
  "move",
  "scroll",
  "pause",
  "waitFor",
  "mark",
  "highlight",
  "screenshot",
] as const;
type StepKey = (typeof STEP_KEYS)[number];

const isStepKey = (key: string): key is StepKey => (STEP_KEYS as readonly string[]).includes(key);

// app-steps.ts と共用するバリデーションヘルパー
export const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value === "") {
    throw new UserError(`${path} must be a non-empty string`);
  }
  return value;
};

export const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UserError(`${path} must be a finite number`);
  }
  return value;
};

const parseStep = (value: unknown, index: number): Step => {
  const path = `steps[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError(`${path} must be an object with exactly one step key`);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new UserError(`${path} must have exactly one key (got ${JSON.stringify(keys)})`);
  }
  const [key] = keys;
  if (key === undefined || !isStepKey(key)) {
    throw new UserError(`${path}: unknown step "${key}" (expected one of ${STEP_KEYS.join(", ")})`);
  }
  const arg = (value as Record<string, unknown>)[key];

  switch (key) {
    case "goto":
      return { goto: nonEmptyString(arg, `${path}.goto`) };
    case "click":
      return { click: nonEmptyString(arg, `${path}.click`) };
    case "waitFor":
      return { waitFor: nonEmptyString(arg, `${path}.waitFor`) };
    case "mark":
      return { mark: nonEmptyString(arg, `${path}.mark`) };
    case "highlight":
      return { highlight: nonEmptyString(arg, `${path}.highlight`) };
    case "screenshot":
      return { screenshot: nonEmptyString(arg, `${path}.screenshot`) };
    case "pause":
      return { pause: finiteNumber(arg, `${path}.pause`) };
    case "scroll":
      return { scroll: finiteNumber(arg, `${path}.scroll`) };
    case "move": {
      if (!Array.isArray(arg) || arg.length !== 2) {
        throw new UserError(`${path}.move must be a [x, y] tuple`);
      }
      return {
        move: [finiteNumber(arg[0], `${path}.move[0]`), finiteNumber(arg[1], `${path}.move[1]`)],
      };
    }
    case "type": {
      if (!Array.isArray(arg) || arg.length !== 2) {
        throw new UserError(`${path}.type must be a [locator, text] tuple`);
      }
      return {
        type: [
          nonEmptyString(arg[0], `${path}.type[0]`),
          nonEmptyString(arg[1], `${path}.type[1]`),
        ],
      };
    }
  }
};

// schema/scenario.schema.json の additionalProperties:false と揃える。$schema は
// init が landing.json に書き込むエディタ向けフィールドなので明示的に許可する
const SCENARIO_TOP_LEVEL_KEYS = ["$schema", "steps"] as const;

export const parseScenario = (value: unknown): Scenario => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError('scenario must be an object with a "steps" array');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !(SCENARIO_TOP_LEVEL_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new UserError(
      `scenario: unknown key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} (expected only ${SCENARIO_TOP_LEVEL_KEYS.join(", ")})`,
    );
  }
  const steps = record.steps;
  if (!Array.isArray(steps)) {
    throw new UserError('scenario: "steps" must be an array');
  }
  return { steps: steps.map((step, index) => parseStep(step, index)) };
};

const SCROLL_SETTLE_MS = 1500;
// mac-recorder.ts の type ステップも同じタイプ感に揃えるため export する
export const TYPE_KEY_DELAY_MS = 30;

const runStep = async (step: Step, ctx: ScenarioContext): Promise<void> => {
  const { page, mark, highlight, screenshot } = ctx;
  if ("goto" in step) {
    await page.goto(step.goto, { waitUntil: "networkidle" });
    return;
  }
  if ("click" in step) {
    await page.locator(step.click).click();
    return;
  }
  if ("type" in step) {
    const [locator, text] = step.type;
    await page.locator(locator).pressSequentially(text, { delay: TYPE_KEY_DELAY_MS });
    return;
  }
  if ("move" in step) {
    const [x, y] = step.move;
    await page.mouse.move(x, y, { steps: 25 });
    return;
  }
  if ("scroll" in step) {
    const top = step.scroll;
    await page.evaluate(([y]) => window.scrollTo({ top: y, behavior: "smooth" }), [top] as const);
    await page.waitForTimeout(SCROLL_SETTLE_MS);
    return;
  }
  if ("pause" in step) {
    await page.waitForTimeout(step.pause);
    return;
  }
  if ("waitFor" in step) {
    await page.locator(step.waitFor).waitFor();
    return;
  }
  if ("highlight" in step) {
    await highlight(step.highlight);
    return;
  }
  if ("screenshot" in step) {
    await screenshot(step.screenshot);
    return;
  }
  mark(step.mark);
};

export const runSteps = async (steps: Step[], ctx: ScenarioContext): Promise<void> => {
  for (const [index, step] of steps.entries()) {
    ctx.onStep?.(step, index);
    await runStep(step, ctx);
  }
};
