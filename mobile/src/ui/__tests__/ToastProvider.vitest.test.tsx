import React from 'react';
import { render, renderHook, act, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Animated } from 'react-native';
import { ToastProvider, useToast } from '../ToastProvider';

vi.useFakeTimers();

function renderToastProvider() {
  const latest: { current: ReturnType<typeof useToast> | null } = { current: null };

  function Capture() {
    latest.current = useToast();
    return null;
  }

  render(
    <ToastProvider>
      <Capture />
      <></>
    </ToastProvider>
  );

  return latest;
}

describe('ToastProvider', () => {
  let timingSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    timingSpy = vi.spyOn(Animated, 'timing').mockImplementation(() => ({
      start: (cb?: () => void) => {
        cb?.();
        return { stop: vi.fn() };
      },
    }) as unknown as Animated.CompositeAnimation);
  });

  it('shows and hides toast message', async () => {
    const latest = renderToastProvider();
    expect(latest.current).not.toBeNull();

    act(() => {
      latest.current?.showToast('Hello world', 1000);
    });

    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(timingSpy).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Hello world')).toBeNull();
  });

  it('restarts timer when new toast arrives', () => {
    const latest = renderToastProvider();

    act(() => {
      latest.current?.showToast('First', 500);
    });
    act(() => {
      vi.advanceTimersByTime(400);
      latest.current?.showToast('Second', 500);
    });

    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Second')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByText('Second')).toBeNull();
  });

  it('throws when useToast called outside provider', () => {
    const run = () => renderHook(() => useToast());
    expect(run).toThrow('useToast must be used within a ToastProvider');
  });
});
