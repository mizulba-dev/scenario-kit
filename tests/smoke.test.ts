import { describe, expect, it } from "vitest";
import {
  buildReport,
  classifyIssue,
  MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX,
  reserveIssueShot,
  safeUrl,
  shouldCaptureIssueShot,
  type Failure,
  type Issue,
  type MutableIssueShotState,
  type StepReportEntry,
} from "../src/lib/smoke";

describe("safeUrl", () => {
  it("returns the value when getUrl succeeds", () => {
    expect(safeUrl(() => "https://example.com")).toBe("https://example.com");
  });

  it("falls back to an empty string when getUrl throws", () => {
    // request.frame()/response.frame() は Service Worker 起源のリクエスト等で
    // 例外を投げることがある。その場合でも issue の記録自体は継続させる
    expect(
      safeUrl(() => {
        throw new Error("no frame for this request");
      }),
    ).toBe("");
  });
});

describe("classifyIssue", () => {
  it.each([
    { status: 500, resourceType: "xhr", expected: "http-error" },
    { status: 404, resourceType: "fetch", expected: "http-error" },
    { status: 400, resourceType: "document", expected: "http-error" },
  ])(
    "flags $resourceType responses with status $status as http-error",
    ({ status, resourceType, expected }) => {
      expect(classifyIssue({ status, resourceType })).toBe(expected);
    },
  );

  it.each([
    { status: 404, resourceType: "image", desc: "image 404 (noise)" },
    { status: 404, resourceType: "stylesheet", desc: "stylesheet 404 (noise)" },
    { status: 404, resourceType: "font", desc: "font 404 (noise)" },
    { status: 200, resourceType: "xhr", desc: "successful xhr" },
    { status: 304, resourceType: "document", desc: "not-modified document" },
  ])("does not flag $desc", ({ status, resourceType }) => {
    expect(classifyIssue({ status, resourceType })).toBeNull();
  });
});

describe("shouldCaptureIssueShot", () => {
  it("captures the first issue for a given step index", () => {
    expect(shouldCaptureIssueShot(0, { capturedStepIndices: new Set(), totalCaptured: 0 })).toBe(
      true,
    );
  });

  it("does not capture a second issue for the same step index", () => {
    expect(shouldCaptureIssueShot(2, { capturedStepIndices: new Set([2]), totalCaptured: 1 })).toBe(
      false,
    );
  });

  it("still captures a different step index even after another step was captured", () => {
    expect(shouldCaptureIssueShot(3, { capturedStepIndices: new Set([2]), totalCaptured: 1 })).toBe(
      true,
    );
  });

  it("caps total captures at 10 when step index is unavailable (TS scenarios)", () => {
    expect(shouldCaptureIssueShot(null, { capturedStepIndices: new Set(), totalCaptured: 9 })).toBe(
      true,
    );
    expect(
      shouldCaptureIssueShot(null, {
        capturedStepIndices: new Set(),
        totalCaptured: MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX,
      }),
    ).toBe(false);
  });
});

describe("reserveIssueShot", () => {
  it("reserves at most one shot for the same step index even when called twice back-to-back (race fix)", () => {
    const state: MutableIssueShotState = { capturedStepIndices: new Set(), totalCaptured: 0 };
    // 実際の addIssue は判定と予約を同一の同期区間で行う。ここでは同一 step で
    // 連続発火する2件の issue（例: request-failed の直後の page-error）を模して、
    // 2回連続で呼んでも1回しか予約されないことを検証する
    expect(reserveIssueShot(2, state)).toBe(true);
    expect(reserveIssueShot(2, state)).toBe(false);
    expect(state.capturedStepIndices.has(2)).toBe(true);
    expect(state.totalCaptured).toBe(1);
  });

  it("still reserves a different step index after another step was reserved", () => {
    const state: MutableIssueShotState = { capturedStepIndices: new Set(), totalCaptured: 0 };
    expect(reserveIssueShot(2, state)).toBe(true);
    expect(reserveIssueShot(3, state)).toBe(true);
    expect(state.totalCaptured).toBe(2);
  });

  it("stops reserving once the total cap is reached when step index is unavailable", () => {
    const state: MutableIssueShotState = { capturedStepIndices: new Set(), totalCaptured: 0 };
    for (let i = 0; i < MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX; i++) {
      expect(reserveIssueShot(null, state)).toBe(true);
    }
    expect(reserveIssueShot(null, state)).toBe(false);
    expect(state.totalCaptured).toBe(MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX);
  });
});

describe("buildReport", () => {
  const step: StepReportEntry = { index: 0, step: { goto: "https://example.com" }, status: "ok" };
  const issue: Issue = {
    type: "console-error",
    message: "boom",
    pageUrl: "https://example.com",
    stepIndex: 0,
    mark: null,
    screenshot: null,
  };
  const failure: Failure = {
    stepIndex: 1,
    message: "locator not found",
    url: "https://example.com",
    screenshot: "failure.png",
  };

  it("is ok when there is no failure and no issues", () => {
    const report = buildReport({
      name: "landing",
      video: "video.mp4",
      scenarioType: "json",
      steps: [step],
      failure: null,
      issues: [],
    });
    expect(report.ok).toBe(true);
  });

  it("is not ok when a failure is present, even without issues", () => {
    const report = buildReport({
      name: "landing",
      video: "video.mp4",
      scenarioType: "json",
      steps: [step],
      failure,
      issues: [],
    });
    expect(report.ok).toBe(false);
  });

  it("is not ok when issues are present, even without a failure", () => {
    const report = buildReport({
      name: "landing",
      video: "video.mp4",
      scenarioType: "json",
      steps: [step],
      failure: null,
      issues: [issue],
    });
    expect(report.ok).toBe(false);
  });

  it("is not ok when both a failure and issues are present", () => {
    const report = buildReport({
      name: "landing",
      video: "video.mp4",
      scenarioType: "json",
      steps: [step],
      failure,
      issues: [issue],
    });
    expect(report.ok).toBe(false);
  });
});
