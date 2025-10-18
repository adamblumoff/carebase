import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme, paletteDark, paletteLight } from '../../theme';

describe('ThemeProvider', () => {
  it('provides light palette by default', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    expect(result.current.palette).toEqual(paletteLight);
    expect(result.current.colorScheme).toBe('light');
  });

  it('switches to dark palette when system scheme is dark', async () => {
    const rn = await import('react-native');
    const spy = vi.spyOn(rn, 'useColorScheme').mockReturnValue('dark');

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    expect(result.current.palette).toEqual(paletteDark);
    expect(result.current.colorScheme).toBe('dark');
    spy.mockRestore();
  });
});
