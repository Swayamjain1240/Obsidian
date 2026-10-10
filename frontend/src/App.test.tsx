import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

describe('application shell', () => {
  it('does not show fabricated repositories on the home screen', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Improve your project safely')).toBeTruthy();
    expect(screen.queryByText('dashboard-app')).toBeNull();
  });
});
