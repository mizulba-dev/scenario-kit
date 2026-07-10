import { describe, expect, it, vi } from "vitest";
import { parseScenario, runSteps } from "../src/lib/steps";

describe("parseScenario", () => {
  it("parses all known step kinds", () => {
    const scenario = parseScenario({
      steps: [
        { goto: "https://example.com" },
        { move: [10, 20] },
        { click: "text=Go" },
        { type: ["input[name=q]", "hello"] },
        { scroll: 760 },
        { waitFor: ".hero" },
        { pause: 500 },
        { mark: "hero" },
        { highlight: ".hero" },
        { screenshot: "hero" },
      ],
    });
    expect(scenario.steps).toHaveLength(10);
  });

  it("rejects a non-object scenario", () => {
    expect(() => parseScenario(null)).toThrow("scenario must be an object");
    expect(() => parseScenario([])).toThrow("scenario must be an object");
  });

  it("rejects a scenario without a steps array", () => {
    expect(() => parseScenario({})).toThrow('"steps" must be an array');
    expect(() => parseScenario({ steps: "nope" })).toThrow('"steps" must be an array');
  });

  it("rejects unknown step keys before execution", () => {
    expect(() => parseScenario({ steps: [{ hover: "x" }] })).toThrow('unknown step "hover"');
  });

  it("rejects a step object with more than one key", () => {
    expect(() => parseScenario({ steps: [{ goto: "a", click: "b" }] })).toThrow("exactly one key");
  });

  it("rejects malformed arguments with the step index", () => {
    expect(() => parseScenario({ steps: [{ goto: "" }] })).toThrow("steps[0].goto");
    expect(() => parseScenario({ steps: [{ move: [1] }] })).toThrow("steps[0].move");
    expect(() => parseScenario({ steps: [{ type: ["a"] }] })).toThrow("steps[0].type");
    expect(() => parseScenario({ steps: [{ pause: "later" }] })).toThrow("steps[0].pause");
    expect(() => parseScenario({ steps: [{ highlight: "" }] })).toThrow("steps[0].highlight");
    expect(() => parseScenario({ steps: [{ screenshot: "" }] })).toThrow("steps[0].screenshot");
    expect(() => parseScenario({ steps: [{ highlight: 1 }] })).toThrow("steps[0].highlight");
    expect(() => parseScenario({ steps: [{ screenshot: 1 }] })).toThrow("steps[0].screenshot");
  });

  it("accepts $schema alongside steps but rejects any other unknown top-level key", () => {
    expect(() =>
      parseScenario({ $schema: "https://example.com/schema.json", steps: [] }),
    ).not.toThrow();
    expect(() => parseScenario({ steps: [], foo: 1 })).toThrow('"foo"');
  });
});

const fakePage = () => {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    page: {
      goto: vi.fn(async (url: string) => calls.push(["goto", url])),
      mouse: { move: vi.fn(async (x: number, y: number) => calls.push(["move", [x, y]])) },
      evaluate: vi.fn(async (_fn: unknown, arg: unknown) => calls.push(["evaluate", arg])),
      waitForTimeout: vi.fn(async (ms: number) => calls.push(["waitForTimeout", ms])),
      locator: vi.fn((selector: string) => ({
        click: vi.fn(async () => calls.push(["click", selector])),
        pressSequentially: vi.fn(async (text: string) =>
          calls.push(["pressSequentially", [selector, text]]),
        ),
        waitFor: vi.fn(async () => calls.push(["waitFor", selector])),
      })),
    },
  };
};

describe("runSteps", () => {
  it("dispatches each step kind to the expected page action", async () => {
    const { page, calls } = fakePage();
    const mark = vi.fn();
    const highlight = vi.fn(async (locator: string) => {
      calls.push(["highlight", locator]);
    });
    const screenshot = vi.fn(async (label: string) => {
      calls.push(["screenshot", label]);
    });
    const scenario = parseScenario({
      steps: [
        { goto: "https://example.com" },
        { move: [10, 20] },
        { click: "text=Go" },
        { type: ["input[name=q]", "hi"] },
        { scroll: 400 },
        { waitFor: ".hero" },
        { pause: 100 },
        { highlight: ".hero" },
        { screenshot: "done" },
        { mark: "done" },
      ],
    });

    await runSteps(scenario.steps, { page: page as never, mark, highlight, screenshot });

    expect(calls[0]).toEqual(["goto", "https://example.com"]);
    expect(calls[1]).toEqual(["move", [10, 20]]);
    expect(calls[2]).toEqual(["click", "text=Go"]);
    expect(calls[3]).toEqual(["pressSequentially", ["input[name=q]", "hi"]]);
    expect(calls[4]).toEqual(["evaluate", [400]]);
    expect(calls[5]).toEqual(["waitForTimeout", 1500]);
    expect(calls[6]).toEqual(["waitFor", ".hero"]);
    expect(calls[7]).toEqual(["waitForTimeout", 100]);
    expect(calls[8]).toEqual(["highlight", ".hero"]);
    expect(calls[9]).toEqual(["screenshot", "done"]);
    expect(highlight).toHaveBeenCalledWith(".hero");
    expect(screenshot).toHaveBeenCalledWith("done");
    expect(mark).toHaveBeenCalledWith("done");
  });
});
