import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../theme';
import { RetrySplash } from '../ui/RetrySplash';

function renderWithTheme(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('RetrySplash', () => {
  it('shows retry controls when not pending', () => {
    const onRetry = vi.fn();
    const onSignOut = vi.fn();

    const screen = renderWithTheme(
      <RetrySplash message="Unable to refresh" pending={false} onRetry={onRetry} onSignOut={onSignOut} />
    );

    expect(screen.getByText('Unable to refresh')).toBeTruthy();

    const retryButton = screen.getByText('Try again');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalled();

    const signOutButton = screen.getByText('Sign out instead');
    fireEvent.click(signOutButton);
    expect(onSignOut).toHaveBeenCalled();
  });

  it('disables retry and shows reconnect copy while pending', () => {
    const onRetry = vi.fn();
    const onSignOut = vi.fn();

    const screen = renderWithTheme(
      <RetrySplash message={null} pending={true} onRetry={onRetry} onSignOut={onSignOut} />
    );

    expect(screen.getByText("Hang tight—we're reconnecting.")).toBeTruthy();

    const retryButton = screen.getByText('Retrying…');
    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();

    const signOutButton = screen.getByText('Sign out instead');
    fireEvent.click(signOutButton);
    expect(onSignOut).toHaveBeenCalled();
  });
});
