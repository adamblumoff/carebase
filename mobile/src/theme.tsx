import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';

const paletteLight = {
  background: '#e8f3eb',
  canvas: '#ffffff',
  surface: '#f8fffb',
  surfaceMuted: '#d8ebde',
  primary: '#15803d',
  primarySoft: '#c7f0d5',
  accent: '#22c55e',
  textPrimary: '#06321a',
  textSecondary: '#2f5b3d',
  textMuted: '#6c8f78',
  success: '#16a34a',
  warning: '#ea580c',
  danger: '#dc2626',
  border: '#bcd8c4',
};

const paletteDark = {
  background: '#05130a',
  canvas: '#0c2316',
  surface: '#12331f',
  surfaceMuted: '#1a3f29',
  primary: '#34d399',
  primarySoft: '#0f291a',
  accent: '#4ade80',
  textPrimary: '#ecfdf3',
  textSecondary: '#b6e3c8',
  textMuted: '#7ba889',
  success: '#22c55e',
  warning: '#fb923c',
  danger: '#f87171',
  border: '#275a3c',
};

export type Palette = typeof paletteLight;

function buildShadow(scheme: ColorSchemeName) {
  const isDark = scheme === 'dark';
  return {
    card: {
      shadowColor: isDark ? '#000000' : '#0f172a',
      shadowOffset: { width: 0, height: isDark ? 4 : 8 },
      shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: isDark ? 12 : 16,
      elevation: isDark ? 3 : 6,
    },
  } as const;
}

export const spacing = (factor: number) => factor * 8;

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
};

type Shadow = ReturnType<typeof buildShadow>;

interface Theme {
  palette: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  shadow: Shadow;
  colorScheme: ColorSchemeName;
}

const defaultScheme: ColorSchemeName = 'light';
const defaultTheme: Theme = {
  palette: paletteLight,
  spacing,
  radius,
  shadow: buildShadow(defaultScheme),
  colorScheme: defaultScheme,
};

const ThemeContext = createContext<Theme>(defaultTheme);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const scheme = useColorScheme() ?? defaultScheme;

  const value = useMemo<Theme>(() => {
    const nextPalette = scheme === 'dark' ? paletteDark : paletteLight;
    return {
      palette: nextPalette,
      spacing,
      radius,
      shadow: buildShadow(scheme),
      colorScheme: scheme,
    };
  }, [scheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);

export type { Theme, Shadow };
export { paletteLight, paletteDark };
