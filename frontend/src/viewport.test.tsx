import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useViewport } from './hooks/useViewport';

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

afterEach(() => {
  cleanup();
  setViewport(1024, 768);
});

describe('responsive viewport policy', () => {
  it.each([
    { name: 'desktop', width: 1440, height: 900, compact: false, short: false },
    { name: 'tablet', width: 1024, height: 768, compact: true, short: false },
    { name: 'mobile', width: 390, height: 844, compact: true, short: false },
  ])('selects the one-panel layout for $name', ({ width, height, compact, short }) => {
    setViewport(width, height);
    const { result } = renderHook(() => useViewport());
    expect(result.current).toMatchObject({ width, height, compact, short });
  });

  it('re-evaluates the compact and short policy after a resize', () => {
    setViewport(1440, 900);
    const { result } = renderHook(() => useViewport());
    expect(result.current.compact).toBe(false);

    setViewport(390, 480);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current).toMatchObject({ width: 390, height: 480, compact: true, short: true });
  });
});
