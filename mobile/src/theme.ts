import { useColorScheme, Appearance, type ColorSchemeName } from 'react-native';

const paletteLight = {
  background: '#f6fdf5',
  canvas: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#eef7ed',
  primary: '#16a34a',
  primarySoft: '#dcfce7',
  accent: '#22c55e',
  textPrimary: '#0b2815',
  textSecondary: '#3f6249',
  textMuted: '#8ea497',
  success: '#16a34a',
  warning: '#f97316',
  danger: '#ef4444',
  border: '#dbe7d7',
};

const paletteDark = {
  background: '#06130a',
  canvas: '#0c1b11',
  surface: '#122318',
  surfaceMuted: '#152b1c',
  primary: '#34d399',
  primarySoft: '#123524',
  accent: '#4ade80',
  textPrimary: '#e7f6ec',
  textSecondary: '#a5cbb1',
  textMuted: '#6f8f78',
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

const initialScheme = Appearance.getColorScheme() ?? 'light';
export const palette: Palette = initialScheme === 'dark' ? paletteDark : paletteLight;
export const shadow = buildShadow(initialScheme);

export const useTheme = () => {
  const scheme = useColorScheme() ?? 'light';
  const palette = scheme === 'dark' ? paletteDark : paletteLight;
  const shadow = buildShadow(scheme);
  return { palette, spacing, radius, shadow, colorScheme: scheme };
};
