export const palette = {
  background: '#f1f5f9',
  canvas: '#0f172a',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  primary: '#2563eb',
  primarySoft: '#dbeafe',
  accent: '#38bdf8',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  success: '#10b981',
  warning: '#f97316',
  danger: '#ef4444',
};

export const spacing = (factor: number) => factor * 8;

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
};

export const shadow = {
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
};
