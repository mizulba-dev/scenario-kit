// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { installCursor } from '../src/lib/cursor';

const getCursor = (): HTMLElement => {
  const el = document.getElementById('__demo_cursor');
  if (!el) throw new Error('cursor element not found');
  return el;
};

describe('installCursor', () => {
  beforeEach(() => {
    document.getElementById('__demo_cursor')?.remove();
  });

  it('creates a single cursor element even when called twice', () => {
    installCursor();
    installCursor();
    expect(document.querySelectorAll('#__demo_cursor')).toHaveLength(1);
  });

  it('follows mousemove events', () => {
    installCursor();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 123, clientY: 45 }));
    const cursor = getCursor();
    expect(cursor.style.left).toBe('123px');
    expect(cursor.style.top).toBe('45px');
  });

  it('shrinks on mousedown and restores on mouseup', () => {
    installCursor();
    window.dispatchEvent(new MouseEvent('mousedown'));
    expect(getCursor().style.width).toBe('14px');
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(getCursor().style.width).toBe('20px');
  });
});
