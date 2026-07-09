import { describe, expect, it } from 'vitest';
import { FPS, INTRO_FRAMES, OUTRO_FRAMES, totalFrames, videoFrames } from '../src/lib/timing';

describe('videoFrames', () => {
  it('converts seconds to frames at FPS', () => {
    expect(videoFrames(10)).toBe(10 * FPS);
  });

  it('rounds fractional seconds', () => {
    expect(videoFrames(9.02)).toBe(Math.round(9.02 * FPS));
  });

  it('rejects zero, negative, and non-finite durations', () => {
    expect(() => videoFrames(0)).toThrow();
    expect(() => videoFrames(-3)).toThrow();
    expect(() => videoFrames(Number.NaN)).toThrow();
  });
});

describe('totalFrames', () => {
  it('adds intro and outro to the video frames', () => {
    expect(totalFrames(10)).toBe(INTRO_FRAMES + 10 * FPS + OUTRO_FRAMES);
  });
});
