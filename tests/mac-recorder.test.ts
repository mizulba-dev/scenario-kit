import { describe, expect, it } from "vitest";
import {
  computeCropRectPx,
  computeDisplayScale,
  escapeAppleScriptString,
  isExpectedFfmpegStopExit,
  parseMainDisplayPixelWidth,
} from "../src/lib/mac-recorder";

// ブラウザ・ffmpeg・osascript を要する経路（起動・録画・操作）はテストしない。
// crop 計算のみ純関数として切り出されているためここで検証する
describe("computeCropRectPx", () => {
  it("scales a window size by the display scale", () => {
    expect(computeCropRectPx({ width: 1440, height: 900 }, { x: 0, y: 0 }, 2)).toEqual({
      x: 0,
      y: 0,
      width: 2880,
      height: 1800,
    });
  });

  it("scales the origin too", () => {
    expect(computeCropRectPx({ width: 1440, height: 900 }, { x: 0, y: 25 }, 2)).toEqual({
      x: 0,
      y: 50,
      width: 2880,
      height: 1800,
    });
  });

  it("rounds an odd-pt window size up to the nearest even pixel", () => {
    expect(computeCropRectPx({ width: 1441, height: 900 }, { x: 0, y: 0 }, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1442,
      height: 900,
    });
  });

  it("rounds a fractional scale result to the nearest even pixel", () => {
    // 1441 * 1.5 = 2161.5 -> round 2162 (すでに偶数)
    expect(computeCropRectPx({ width: 1441, height: 901 }, { x: 0, y: 0 }, 1.5)).toEqual({
      x: 0,
      y: 0,
      width: 2162,
      height: 1352,
    });
  });

  // detectDisplayScale (IO) が computeDisplayScale の結果を丸めてしまうと、1.5 のような
  // 非整数 scale は本番コードから決して出てこなくなり、上のテストが空通しになる。
  // computeDisplayScale が丸めずに 1.5 を返すことをここで直接検証する
  it("uses an unrounded scale end-to-end when fed a non-integer physical/logical ratio", () => {
    const scale = computeDisplayScale(2160, 1440);
    expect(scale).toBe(1.5);
    expect(computeCropRectPx({ width: 1440, height: 900 }, { x: 0, y: 0 }, scale)).toEqual({
      x: 0,
      y: 0,
      width: 2160,
      height: 1350,
    });
  });
});

describe("computeDisplayScale", () => {
  it("divides physical pixel width by logical point width without rounding", () => {
    expect(computeDisplayScale(3456, 1728)).toBe(2);
    expect(computeDisplayScale(2160, 1440)).toBe(1.5);
    expect(computeDisplayScale(1440, 1440)).toBe(1);
  });
});

describe("parseMainDisplayPixelWidth", () => {
  const block = (resolution: string, main: boolean): string =>
    `          Resolution: ${resolution}\n${main ? "          Main Display: Yes\n" : ""}          Mirror: Off\n`;

  it("picks the single display's resolution when only one is listed", () => {
    expect(parseMainDisplayPixelWidth(block("3456 x 2234 Retina", true))).toBe(3456);
  });

  it("falls back to the first resolution when no Main Display marker exists", () => {
    expect(parseMainDisplayPixelWidth(block("3456 x 2234", false))).toBe(3456);
  });

  it("picks the resolution of the block marked Main Display: Yes among multiple displays", () => {
    const text = block("1920 x 1080", false) + block("3456 x 2234 Retina", true);
    expect(parseMainDisplayPixelWidth(text)).toBe(3456);
  });

  it("does not pick a later display's resolution past the Main Display marker", () => {
    const text = block("3456 x 2234 Retina", true) + block("1920 x 1080", false);
    expect(parseMainDisplayPixelWidth(text)).toBe(3456);
  });

  it("returns undefined when no resolution line is present", () => {
    expect(parseMainDisplayPixelWidth("Graphics/Displays:\n")).toBeUndefined();
  });
});

describe("escapeAppleScriptString", () => {
  it("passes through a plain string unchanged", () => {
    expect(escapeAppleScriptString("Claude")).toBe("Claude");
  });

  it("escapes double quotes so an app name can't close the AppleScript string literal early", () => {
    expect(escapeAppleScriptString('Evil" & do shell script "rm -rf ~" & "')).toBe(
      'Evil\\" & do shell script \\"rm -rf ~\\" & \\"',
    );
  });

  it("escapes backslashes before quote-escaping runs", () => {
    expect(escapeAppleScriptString("back\\slash")).toBe("back\\\\slash");
  });

  it("replaces literal newlines with a space so multi-line input can't break the script", () => {
    // \r と \n はそれぞれ1文字ずつ空白に置換されるため、\r\n の直後は空白2つになる
    expect(escapeAppleScriptString("line1\nline2\r\nline3")).toBe("line1 line2  line3");
  });
});

describe("isExpectedFfmpegStopExit", () => {
  it("accepts a clean exit (code 0)", () => {
    expect(isExpectedFfmpegStopExit({ code: 0, signal: null })).toBe(true);
  });

  it("accepts ffmpeg's own SIGINT-handling exit code 255", () => {
    expect(isExpectedFfmpegStopExit({ code: 255, signal: null })).toBe(true);
  });

  it("rejects any other exit code as an unexpected abnormal exit", () => {
    expect(isExpectedFfmpegStopExit({ code: 1, signal: null })).toBe(false);
    expect(isExpectedFfmpegStopExit({ code: null, signal: "SIGSEGV" })).toBe(false);
    expect(isExpectedFfmpegStopExit({ code: null, signal: "SIGKILL" })).toBe(false);
  });
});
