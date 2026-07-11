import { describe, expect, it } from "vitest";
import { APP_STEP_KEYS, parseAppScenario, parseKeystroke } from "../src/lib/app-steps";

describe("parseAppScenario", () => {
  it("parses all known app step kinds", () => {
    const scenario = parseAppScenario({
      app: { name: "Claude" },
      steps: [
        { keystroke: "cmd+n" },
        { type: "hello" },
        { click: [10, 20] },
        { move: [30, 40] },
        { pause: 500 },
        { mark: "reply" },
      ],
    });
    expect(scenario.steps).toHaveLength(APP_STEP_KEYS.length);
  });

  it("defaults app.width/height to 1440x900 when omitted", () => {
    const scenario = parseAppScenario({ app: { name: "Claude" }, steps: [] });
    expect(scenario.app).toEqual({ name: "Claude", width: 1440, height: 900 });
  });

  it("accepts explicit app.width/height", () => {
    const scenario = parseAppScenario({
      app: { name: "Claude", width: 1600, height: 1000 },
      steps: [],
    });
    expect(scenario.app).toEqual({ name: "Claude", width: 1600, height: 1000 });
  });

  it("rejects a non-object scenario", () => {
    expect(() => parseAppScenario(null)).toThrow("scenario must be an object");
    expect(() => parseAppScenario([])).toThrow("scenario must be an object");
  });

  it("rejects a scenario without app or steps", () => {
    expect(() => parseAppScenario({ steps: [] })).toThrow("scenario.app");
    expect(() => parseAppScenario({ app: { name: "Claude" } })).toThrow('"steps" must be an array');
  });

  it("rejects an unknown top-level key", () => {
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [], foo: 1 })).toThrow('"foo"');
  });

  it("rejects app.name missing or empty", () => {
    expect(() => parseAppScenario({ app: {}, steps: [] })).toThrow("scenario.app.name");
    expect(() => parseAppScenario({ app: { name: "" }, steps: [] })).toThrow("scenario.app.name");
  });

  it("rejects an unknown app key", () => {
    expect(() => parseAppScenario({ app: { name: "Claude", foo: 1 }, steps: [] })).toThrow('"foo"');
  });

  it("rejects unknown app step keys before recording starts", () => {
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ hover: "x" }] })).toThrow(
      'unknown step "hover"',
    );
  });

  it("rejects a web step key mixed into an app scenario", () => {
    expect(() =>
      parseAppScenario({ app: { name: "Claude" }, steps: [{ goto: "https://example.com" }] }),
    ).toThrow('unknown step "goto"');
  });

  it("rejects an app step object with more than one key", () => {
    expect(() =>
      parseAppScenario({ app: { name: "Claude" }, steps: [{ mark: "a", pause: 1 }] }),
    ).toThrow("exactly one key");
  });

  it("rejects malformed app step arguments with the step index", () => {
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ keystroke: "" }] })).toThrow(
      "steps[0].keystroke",
    );
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ type: "" }] })).toThrow(
      "steps[0].type",
    );
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ click: [1] }] })).toThrow(
      "steps[0].click",
    );
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ move: [1] }] })).toThrow(
      "steps[0].move",
    );
    expect(() =>
      parseAppScenario({ app: { name: "Claude" }, steps: [{ pause: "later" }] }),
    ).toThrow("steps[0].pause");
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ mark: "" }] })).toThrow(
      "steps[0].mark",
    );
  });

  it("rejects fractional and negative click/move coordinates (cliclick would misinterpret them)", () => {
    expect(() =>
      parseAppScenario({ app: { name: "Claude" }, steps: [{ click: [100.5, 200] }] }),
    ).toThrow("steps[0].click[0] must be a non-negative integer");
    expect(() =>
      parseAppScenario({ app: { name: "Claude" }, steps: [{ click: [100, -5] }] }),
    ).toThrow("steps[0].click[1] must be a non-negative integer");
    expect(() => parseAppScenario({ app: { name: "Claude" }, steps: [{ move: [-1, 0] }] })).toThrow(
      "steps[0].move[0] must be a non-negative integer",
    );
  });
});

describe("parseKeystroke", () => {
  it("parses a bare special key", () => {
    expect(parseKeystroke("enter", "path")).toEqual({ modifiers: [], key: "enter" });
  });

  it("parses a single modifier + letter", () => {
    expect(parseKeystroke("cmd+n", "path")).toEqual({ modifiers: ["cmd"], key: "n" });
  });

  it("parses multiple modifiers in order", () => {
    expect(parseKeystroke("cmd+shift+n", "path")).toEqual({
      modifiers: ["cmd", "shift"],
      key: "n",
    });
  });

  it("parses a bare single alphanumeric key", () => {
    expect(parseKeystroke("7", "path")).toEqual({ modifiers: [], key: "7" });
  });

  it("rejects an empty string", () => {
    expect(() => parseKeystroke("", "path")).toThrow("path must be a non-empty string");
  });

  it("rejects an invalid modifier", () => {
    expect(() => parseKeystroke("meta+n", "path")).toThrow('invalid modifier "meta"');
  });

  it("rejects a multi-character non-special key", () => {
    expect(() => parseKeystroke("cmd+nn", "path")).toThrow('invalid key "nn"');
  });

  it("rejects a trailing +", () => {
    expect(() => parseKeystroke("cmd+", "path")).toThrow("invalid key");
  });
});
