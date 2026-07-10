import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parseScenario, STEP_KEYS } from "../src/lib/steps";

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema",
  "scenario.schema.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv({ strict: false }).compile(schema);

const runtimeAccepts = (value: unknown): boolean => {
  try {
    parseScenario(value);
    return true;
  } catch {
    return false;
  }
};

describe("scenario.schema.json", () => {
  it("documents exactly the step keys implemented by the runtime validator", () => {
    const schemaKeys = Object.keys(schema.definitions.step.properties).sort();
    expect(schemaKeys).toEqual([...STEP_KEYS].sort());
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
  ];

  for (const { name, value } of cases) {
    it(`schema and runtime agree on: ${name}`, () => {
      expect(runtimeAccepts(value)).toBe(validateSchema(value));
    });
  }
});
