import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { APP_STEP_KEYS, parseAppScenario } from "../src/lib/app-steps";
import { parseScenario, STEP_KEYS } from "../src/lib/steps";

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema",
  "scenario.schema.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv({ strict: false }).compile(schema);

// loadScenario と同じ分岐（トップレベル "app" キーの有無）で web/app どちらの
// ランタイムバリデータに通すかを決める
const isAppScenarioValue = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "app" in value;

const runtimeAccepts = (value: unknown): boolean => {
  try {
    if (isAppScenarioValue(value)) {
      parseAppScenario(value);
    } else {
      parseScenario(value);
    }
    return true;
  } catch {
    return false;
  }
};

describe("scenario.schema.json", () => {
  it("documents exactly the web step keys implemented by the runtime validator", () => {
    const schemaKeys = Object.keys(schema.definitions.step.properties).sort();
    expect(schemaKeys).toEqual([...STEP_KEYS].sort());
  });

  it("documents exactly the app step keys implemented by the runtime validator", () => {
    const schemaKeys = Object.keys(schema.definitions.appStep.properties).sort();
    expect(schemaKeys).toEqual([...APP_STEP_KEYS].sort());
  });

  it("is valid JSON", () => {
    expect(() => JSON.parse(readFileSync(schemaPath, "utf8"))).not.toThrow();
  });
});

// schema と runtime (parseScenario) は「同一定義」である契約なので、代表的な入力
// それぞれについて accept/reject が一致することを確認する。片方だけ緩い/厳しいと
// $schema でエディタが通しても scenario-kit run が拒否する、または逆の空通しになる。
describe("schema/runtime parity", () => {
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "valid minimal", value: { steps: [] } },
    {
      name: "valid with $schema and steps",
      value: {
        $schema: "https://unpkg.com/scenario-kit/schema/scenario.schema.json",
        steps: [{ goto: "https://example.com" }, { mark: "hero" }],
      },
    },
    { name: "unknown top-level key", value: { steps: [], foo: 1 } },
    { name: "missing steps", value: {} },
    { name: "steps not an array", value: { steps: "nope" } },
    { name: "unknown step key", value: { steps: [{ hover: "x" }] } },
    {
      name: "step object with more than one key",
      value: { steps: [{ goto: "https://example.com", click: "text=Go" }] },
    },
    { name: "goto with empty string", value: { steps: [{ goto: "" }] } },
    { name: "move with wrong tuple length", value: { steps: [{ move: [1] }] } },
    { name: "valid highlight", value: { steps: [{ highlight: "x" }] } },
    { name: "highlight with empty string", value: { steps: [{ highlight: "" }] } },
    { name: "valid screenshot", value: { steps: [{ screenshot: "x" }] } },
    { name: "valid app scenario, minimal", value: { app: { name: "Claude" }, steps: [] } },
    {
      name: "valid app scenario with all app steps",
      value: {
        app: { name: "Claude", width: 1440, height: 900 },
        steps: [
          { keystroke: "cmd+n" },
          { type: "hello" },
          { click: [10, 20] },
          { move: [10, 20] },
          { pause: 500 },
          { mark: "reply" },
        ],
      },
    },
    { name: "app scenario missing app.name", value: { app: {}, steps: [] } },
    {
      name: "app scenario with unknown app key",
      value: { app: { name: "Claude", foo: 1 }, steps: [] },
    },
    {
      name: "app scenario mixing a web step key",
      value: { app: { name: "Claude" }, steps: [{ goto: "https://example.com" }] },
    },
    { name: "app key on an otherwise-empty object", value: { app: { name: "Claude" } } },
  ];

  for (const { name, value } of cases) {
    it(`schema and runtime agree on: ${name}`, () => {
      expect(runtimeAccepts(value)).toBe(validateSchema(value));
    });
  }
});
