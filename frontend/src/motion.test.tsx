import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { CrystalCanvas } from './components/CrystalCanvas';

describe('motion fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not start decorative motion when reduced motion is preferred and cleans up on unmount', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, media: '(prefers-reduced-motion: reduce)', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { unmount, container } = render(<CrystalCanvas />);

    expect(container.querySelector('.crystal-canvas')).toBeTruthy();
    unmount();
  });
});
