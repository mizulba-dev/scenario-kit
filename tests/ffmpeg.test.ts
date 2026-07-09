import { describe, expect, it } from 'vitest';
import { parseDuration } from '../src/lib/ffmpeg';

describe('parseDuration', () => {
  it('parses ffprobe output with trailing newline', () => {
    expect(parseDuration('9.033333\n')).toBeCloseTo(9.033333);
  });

  it('rejects N/A, empty, and non-positive output', () => {
    expect(() => parseDuration('N/A\n')).toThrow('ffprobe');
    expect(() => parseDuration('')).toThrow('ffprobe');
    expect(() => parseDuration('0')).toThrow('ffprobe');
  });
});
