import { UserError } from "./errors";
import { finiteNumber, nonEmptyString } from "./steps";

export type AppStep =
  | { keystroke: string }
  | { type: string }
  | { click: [number, number] }
  | { move: [number, number] }
  | { pause: number }
  | { mark: string };

export interface AppConfig {
  name: string;
  width: number;
  height: number;
}

export interface AppScenario {
  app: AppConfig;
  steps: AppStep[];
}

export const APP_STEP_KEYS = ["keystroke", "type", "click", "move", "pause", "mark"] as const;
type AppStepKey = (typeof APP_STEP_KEYS)[number];

const isAppStepKey = (key: string): key is AppStepKey =>
  (APP_STEP_KEYS as readonly string[]).includes(key);

const DEFAULT_APP_WIDTH = 1440;
const DEFAULT_APP_HEIGHT = 900;

export const KEYSTROKE_MODIFIERS = ["cmd", "shift", "ctrl", "opt"] as const;
type KeystrokeModifier = (typeof KEYSTROKE_MODIFIERS)[number];
const KEYSTROKE_SPECIAL_KEYS = ["enter", "esc", "tab", "space"] as const;

export interface ParsedKeystroke {
  modifiers: KeystrokeModifier[];
  key: string;
}

// "cmd+shift+n" 形式: 修飾子は + 連結、末尾キーは enter/esc/tab/space か英数1文字
export const parseKeystroke = (value: string, path: string): ParsedKeystroke => {
  if (value === "") {
    throw new UserError(`${path} must be a non-empty string`);
  }
  const parts = value.split("+");
  const key = parts.pop();
  const isSpecial =
    key !== undefined && (KEYSTROKE_SPECIAL_KEYS as readonly string[]).includes(key);
  const isSingleChar = key !== undefined && /^[A-Za-z0-9]$/.test(key);
  if (key === undefined || key === "" || (!isSpecial && !isSingleChar)) {
    throw new UserError(
      `${path}: invalid key ${JSON.stringify(key)} in keystroke ${JSON.stringify(value)} (expected one of ${KEYSTROKE_SPECIAL_KEYS.join(", ")} or a single alphanumeric character)`,
    );
  }
  const modifiers: KeystrokeModifier[] = [];
  for (const part of parts) {
    if (!(KEYSTROKE_MODIFIERS as readonly string[]).includes(part)) {
      throw new UserError(
        `${path}: invalid modifier ${JSON.stringify(part)} in keystroke ${JSON.stringify(value)} (expected one of ${KEYSTROKE_MODIFIERS.join(", ")})`,
      );
    }
    modifiers.push(part as KeystrokeModifier);
  }
  return { modifiers, key };
};

// click/move の座標は cliclick の座標引数にそのまま渡すため非負整数に限定する
// （cliclick は小数を受け付けず、先頭が "-" の値は相対移動として解釈してしまう）
const nonNegativeInt = (value: unknown, path: string): number => {
  const num = finiteNumber(value, path);
  if (!Number.isInteger(num) || num < 0) {
    throw new UserError(`${path} must be a non-negative integer (got ${JSON.stringify(value)})`);
  }
  return num;
};

const parseAppStep = (value: unknown, index: number): AppStep => {
  const path = `steps[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError(`${path} must be an object with exactly one step key`);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new UserError(`${path} must have exactly one key (got ${JSON.stringify(keys)})`);
  }
  const [key] = keys;
  if (key === undefined || !isAppStepKey(key)) {
    throw new UserError(
      `${path}: unknown step "${key}" (expected one of ${APP_STEP_KEYS.join(", ")})`,
    );
  }
  const arg = (value as Record<string, unknown>)[key];

  switch (key) {
    case "keystroke": {
      const stroke = nonEmptyString(arg, `${path}.keystroke`);
      parseKeystroke(stroke, `${path}.keystroke`);
      return { keystroke: stroke };
    }
    case "type":
      return { type: nonEmptyString(arg, `${path}.type`) };
    case "pause":
      return { pause: finiteNumber(arg, `${path}.pause`) };
    case "mark":
      return { mark: nonEmptyString(arg, `${path}.mark`) };
    case "click": {
      if (!Array.isArray(arg) || arg.length !== 2) {
        throw new UserError(`${path}.click must be a [x, y] tuple`);
      }
      return {
        click: [
          nonNegativeInt(arg[0], `${path}.click[0]`),
          nonNegativeInt(arg[1], `${path}.click[1]`),
        ],
      };
    }
    case "move": {
      if (!Array.isArray(arg) || arg.length !== 2) {
        throw new UserError(`${path}.move must be a [x, y] tuple`);
      }
      return {
        move: [
          nonNegativeInt(arg[0], `${path}.move[0]`),
          nonNegativeInt(arg[1], `${path}.move[1]`),
        ],
      };
    }
  }
};

const APP_KEYS = ["name", "width", "height"] as const;

const parseAppConfig = (value: unknown): AppConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError('scenario.app must be an object with a "name" key');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !(APP_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new UserError(
      `scenario.app: unknown key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} (expected only ${APP_KEYS.join(", ")})`,
    );
  }
  const name = nonEmptyString(record.name, "scenario.app.name");
  const width =
    record.width !== undefined
      ? finiteNumber(record.width, "scenario.app.width")
      : DEFAULT_APP_WIDTH;
  const height =
    record.height !== undefined
      ? finiteNumber(record.height, "scenario.app.height")
      : DEFAULT_APP_HEIGHT;
  return { name, width, height };
};

// schema/scenario.schema.json の appScenario.additionalProperties:false と揃える
const APP_SCENARIO_TOP_LEVEL_KEYS = ["$schema", "app", "steps"] as const;

export const parseAppScenario = (value: unknown): AppScenario => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError('scenario must be an object with "app" and "steps"');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !(APP_SCENARIO_TOP_LEVEL_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new UserError(
      `scenario: unknown key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} (expected only ${APP_SCENARIO_TOP_LEVEL_KEYS.join(", ")})`,
    );
  }
  const app = parseAppConfig(record.app);
  const steps = record.steps;
  if (!Array.isArray(steps)) {
    throw new UserError('scenario: "steps" must be an array');
  }
  return { app, steps: steps.map((step, index) => parseAppStep(step, index)) };
};
