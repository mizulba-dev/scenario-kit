import { execFileSync } from "node:child_process";
import { UserError } from "./errors";

const isOnPath = (bin: string): boolean => {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const assertFfmpegAvailable = (): void => {
  const missing = ["ffmpeg", "ffprobe"].filter((bin) => !isOnPath(bin));
  if (missing.length > 0) {
    throw new UserError(
      `${missing.join(" and ")} not found on PATH. Install ffmpeg (it bundles ffprobe) — e.g. "brew install ffmpeg" on macOS — then retry.`,
      2,
    );
  }
};

export const parseDuration = (output: string): number => {
  const value = Number.parseFloat(output.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`could not parse duration from ffprobe output: ${JSON.stringify(output)}`);
  }
  return value;
};

// Playwright の webm は duration メタデータを持たないことがあるため h264 mp4 に変換してから使う
export const convertToMp4 = (src: string, dst: string): void => {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      src,
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      dst,
    ],
    { stdio: "inherit" },
  );
};

export const probeDuration = (file: string): number =>
  parseDuration(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]).toString(),
  );
