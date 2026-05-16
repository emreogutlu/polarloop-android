// hooks/use-app-colors.ts
// Central color palette that respects dark mode.
// Import this in every screen and use colors.xxx instead of hardcoded values.

import { useColorScheme } from '@/hooks/use-color-scheme';

const light = {
  // Backgrounds
  background: '#FFFFFF',
  cardBg: '#FCFCFC',
  cardBgAlt: '#FAFAFA',
  innerCardBg: '#F2F2F2',
  inputBg: '#F4F6F5',
  modalBg: '#F2F2F7',

  // Text
  textPrimary: '#434F4D',
  textSecondary: 'rgba(67,79,77,0.80)',
  textTertiary: 'rgba(67,79,77,0.55)',
  textMuted: 'rgba(67,79,77,0.4)',
  textHeading: '#2E3B39',
  textLabel: '#5A6B68',
  textGray: '#8E8E93',

  // Borders & Dividers
  border: 'rgba(67,79,77,0.05)',
  divider: 'rgba(67,79,77,0.1)',
  separator: 'rgba(0,0,0,0.05)',

  // Shadows
  shadowColor: '#3D4E4A',

  // Accent
  accent: '#5CB89A',
  accentLight: 'rgba(92,184,154,0.1)',
  accentBorder: 'rgba(92,184,154,0.18)',

  // Status
  destructive: '#DC4545',
  destructiveBg: 'rgba(220,69,69,0.07)',
  errorBg: 'rgba(217,68,68,0.07)',

  // Dashboard specific
  widgetBg: '#FDFDFD',
  statCardBg: '#F2F2F2',

  // Charts
  barInactive: '#D9D9D9',
  baseline: '#E3C937',
  hrvActive: '#90E2DA',

  // Misc
  switchTrackFalse: '#767577',
  placeholder: '#B8C4C2',
  iconDefault: '#434F4D',

  // Insight gradients
  insightGradientGreen: ['#F4F5F4', '#CBEBD1'] as [string, string],
  insightGradientPurple: ['#F5F5F6', '#F0E1FF'] as [string, string],
};

const dark = {
  // Backgrounds
  background: '#000000',
  cardBg: '#1C1E1D',
  cardBgAlt: '#1A1C1B',
  innerCardBg: '#262928',
  inputBg: '#2A2D2C',
  modalBg: '#1C1E1D',

  // Text
  textPrimary: '#E8EAE9',
  textSecondary: 'rgba(232,234,233,0.75)',
  textTertiary: 'rgba(232,234,233,0.55)',
  textMuted: 'rgba(232,234,233,0.35)',
  textHeading: '#F0F2F1',
  textLabel: '#A0ABA8',
  textGray: '#8E8E93',

  // Borders & Dividers
  border: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.1)',
  separator: 'rgba(255,255,255,0.06)',
 

  // Shadows
  shadowColor: '#000000',

  // Accent
  accent: '#5CB89A',
  accentLight: 'rgba(92,184,154,0.15)',
  accentBorder: 'rgba(92,184,154,0.25)',

  // Status
  destructive: '#FF6B6B',
  destructiveBg: 'rgba(255,107,107,0.12)',
  errorBg: 'rgba(255,107,107,0.12)',

  // Dashboard specific
  widgetBg: '#1C1E1D',
  statCardBg: '#262928',

  // Charts
  // Bumped from #3A3D3C → #55595A so inactive HRV bars stay readable against
  // the dark card background (#1C1E1D). Light mode (#D9D9D9) is unchanged.
  barInactive: '#55595A',
  baseline: '#E3C937',
  hrvActive: '#90E2DA',

  // Misc
  switchTrackFalse: '#555',
  placeholder: '#6A7472',
  iconDefault: '#C0C8C6',

  // Insight gradients
  insightGradientGreen: ['#2B2F2D', '#285338'] as [string, string],
  insightGradientPurple: ['#2B2F2D', '#433056'] as [string, string],
};

export function useAppColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}
