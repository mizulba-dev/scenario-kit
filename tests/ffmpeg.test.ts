import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDuration } from "../src/lib/ffmpeg";

describe("parseDuration", () => {
  it("parses ffprobe output with trailing newline", () => {
    expect(parseDuration("9.033333\n")).toBeCloseTo(9.033333);
  });

  it("rejects N/A, empty, and non-positive output", () => {
    expect(() => parseDuration("N/A\n")).toThrow("ffprobe");
    expect(() => parseDuration("")).toThrow("ffprobe");
    expect(() => parseDuration("0")).toThrow("ffprobe");
  });
});

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

describe("assertFfmpegAvailable", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not throw when both ffmpeg and ffprobe are on PATH", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    const { assertFfmpegAvailable } = await import("../src/lib/ffmpeg");
    expect(() => assertFfmpegAvailable()).not.toThrow();
  });

  it("throws a UserError naming the missing binaries with install guidance", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementation((bin) => {
      if (bin === "ffmpeg") return Buffer.from("");
      throw new Error("ENOENT");
    });
    const { assertFfmpegAvailable } = await import("../src/lib/ffmpeg");
    expect(() => assertFfmpegAvailable()).toThrow("ffprobe");
    expect(() => assertFfmpegAvailable()).toThrow("brew install ffmpeg");
  });

  it("marks missing ffmpeg as a runtime-environment failure (exit code 2)", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { assertFfmpegAvailable } = await import("../src/lib/ffmpeg");
    const { UserError } = await import("../src/lib/errors");
    try {
      assertFfmpegAvailable();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as InstanceType<typeof UserError>).exitCode).toBe(2);
    }
  });
});
