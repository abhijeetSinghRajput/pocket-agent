import { useColorScheme } from 'react-native';
import { useThemePreference } from '@/lib/appearance';

/**
 * Design tokens, the same ones as the web app (apps/web/src/app/globals.css) converted to sRGB:
 * neutral surfaces, one accent, semantic status colours.
 */
const light = {
  background: '#eff0f3',
  foreground: '#151619',
  card: '#ffffff',
  popover: '#ffffff',
  primary: '#c64200',
  primaryForeground: '#fcfcfc',
  secondary: '#eaebee',
  secondaryForeground: '#202225',
  muted: '#eaebee',
  mutedForeground: '#616369',
  accent: '#ffeee2',
  accentForeground: '#6f2a00',
  destructive: '#d02b31',
  border: '#e2e3e6',
  input: '#e2e3e6',
  success: '#1c985a',
  warning: '#da950b',
  bar: '#f9fafb',
  bubbleOut: '#d95800',
  bubbleOutForeground: '#fefbf8',
  bubbleMeta: '#645048',
  toolLink: '#0465af',
  code: '#f6f7f9',
  overlay: 'rgba(10, 10, 12, 0.45)',
  hlKeyword: '#cf222e',
  hlString: '#0a3069',
  hlTitle: '#8250df',
  hlNumber: '#0550ae',
  hlComment: '#6e7781',
  hlBuiltin: '#953800',
  hlAdd: '#116329',
  hlDel: '#82071e',
};

const dark: typeof light = {
  background: '#070709',
  foreground: '#eeeef0',
  card: '#313135',
  popover: '#38383d',
  primary: '#f67f2f',
  primaryForeground: '#0d0d0f',
  secondary: '#3d3d42',
  secondaryForeground: '#e4e4e7',
  muted: '#404045',
  mutedForeground: '#aeb1b8',
  accent: '#573b2e',
  accentForeground: '#f9d6bf',
  destructive: '#ed5350',
  border: '#47474d',
  input: '#4c4c52',
  success: '#43c07a',
  warning: '#edb345',
  bar: '#1d1d20',
  bubbleOut: '#c84f00',
  bubbleOutForeground: '#fefbf8',
  bubbleMeta: '#d3c0b1',
  toolLink: '#68b5f5',
  code: '#1b1b1e',
  overlay: 'rgba(0, 0, 0, 0.6)',
  hlKeyword: '#ff7b72',
  hlString: '#a5d6ff',
  hlTitle: '#d2a8ff',
  hlNumber: '#79c0ff',
  hlComment: '#8b949e',
  hlBuiltin: '#ffa657',
  hlAdd: '#aff5b4',
  hlDel: '#ffdcd7',
};

export type Colors = typeof light;
export const palettes = { light, dark };

export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

export const radius = { sm: 8, md: 10, lg: 14, xl: 18, xxl: 24, full: 999 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;

export interface Theme {
  dark: boolean;
  c: Colors;
}

/**
 * The colours to draw with. A light/dark choice made in the app is read from its own store, so
 * every screen switches in the same render (the system appearance event arrives late and one
 * component at a time); "System" follows the phone.
 */
export function useTheme(): Theme {
  const pref = useThemePreference();
  const system = useColorScheme();
  const isDark = pref === 'system' ? system === 'dark' : pref === 'dark';
  return { dark: isDark, c: isDark ? dark : light };
}

/** `#rrggbb` + alpha (0..1) as an rgba() string. Also usable inside animations (a worklet). */
export function alpha(hex: string, a: number): string {
  'worklet';
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
