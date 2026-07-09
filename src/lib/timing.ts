export const FPS = 30;
export const INTRO_FRAMES = 50;
export const OUTRO_FRAMES = 70;

export const videoFrames = (durationSec: number): number => {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`invalid durationSec: ${durationSec}`);
  }
  return Math.round(durationSec * FPS);
};

export const totalFrames = (durationSec: number): number =>
  INTRO_FRAMES + videoFrames(durationSec) + OUTRO_FRAMES;
