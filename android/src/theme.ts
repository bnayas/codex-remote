import { StyleSheet, Platform } from 'react-native';

export const Colors = {
  bg: '#0a0a0f',
  bgCard: '#0f0f18',
  bgElevated: '#13131f',
  bgInput: '#0c0c14',
  border: '#1e1e30',
  borderBright: '#2a2a42',
  text: '#c8c8e0',
  textDim: '#6a6a88',
  textBright: '#e8e8ff',
  accent: '#00ff9d',
  accentDim: 'rgba(0,255,157,0.15)',
  warn: '#ffd700',
  danger: '#ff4444',
  dangerDim: 'rgba(255,68,68,0.15)',
  terminalText: '#c8ffc8',
  terminalBg: '#060609',
  // Status colors
  statusRunning: '#00ff9d',
  statusStarting: '#ffd700',
  statusExited: '#555',
  statusKilled: '#ff4444',
  statusError: '#ff4444',
  statusUnknown: '#444',
} as const;

export const Fonts = {
  mono: Platform.select({ android: 'monospace', ios: 'Courier New' }),
  sans: Platform.select({ android: 'sans-serif', ios: 'System' }),
  sansMedium: Platform.select({ android: 'sans-serif-medium', ios: 'System' }),
} as const;

export const Radius = {
  sm: 3,
  md: 6,
  lg: 10,
} as const;

export function statusColor(status: string): string {
  switch (status) {
    case 'running': return Colors.statusRunning;
    case 'starting': return Colors.statusStarting;
    case 'exited': return Colors.statusExited;
    case 'killed': return Colors.statusKilled;
    case 'error': return Colors.statusError;
    default: return Colors.statusUnknown;
  }
}

export const globalStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textDim,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: Fonts.sans,
  },
  monoText: {
    fontFamily: Fonts.mono,
  },
  dimText: {
    color: Colors.textDim,
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyStateText: {
    color: Colors.textDim,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: Fonts.sans,
  },
});
