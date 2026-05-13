import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Colors, Fonts, Radius, statusColor } from '../theme';

// ─── Status Dot ──────────────────────────────────────────────────────────────

export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: statusColor(status) },
      ]}
    />
  );
}

// ─── Accent Button ───────────────────────────────────────────────────────────

export function AccentButton({
  label,
  onPress,
  loading,
  disabled,
  fullWidth,
  small,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  small?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.accentBtn,
        fullWidth && styles.fullWidth,
        small && styles.smallBtn,
        (disabled || loading) && styles.disabledBtn,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}>
      {loading ? (
        <ActivityIndicator color="#000" size="small" />
      ) : (
        <Text style={[styles.accentBtnText, small && styles.smallBtnText]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Ghost Button ─────────────────────────────────────────────────────────────

export function GhostButton({
  label,
  onPress,
  small,
  color,
}: {
  label: string;
  onPress: () => void;
  small?: boolean;
  color?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.ghostBtn, small && styles.smallGhostBtn]}
      onPress={onPress}
      activeOpacity={0.7}>
      <Text style={[styles.ghostBtnText, small && styles.smallBtnText, color ? { color } : undefined]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Control Button ───────────────────────────────────────────────────────────

export function CtrlButton({
  label,
  onPress,
  variant = 'default',
  confirming,
}: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'warn' | 'danger';
  confirming?: boolean;
}) {
  const borderColor =
    variant === 'danger' ? Colors.danger :
    variant === 'warn' ? Colors.warn :
    Colors.borderBright;
  const textColor =
    variant === 'danger' ? Colors.danger :
    variant === 'warn' ? Colors.warn :
    Colors.text;
  const bgColor = confirming
    ? variant === 'danger' ? Colors.dangerDim
    : variant === 'warn' ? 'rgba(255,215,0,0.1)'
    : Colors.accentDim
    : Colors.bgElevated;

  return (
    <TouchableOpacity
      style={[styles.ctrlBtn, { borderColor, backgroundColor: bgColor }]}
      onPress={onPress}
      activeOpacity={0.75}>
      <Text style={[styles.ctrlBtnText, { color: confirming ? Colors.accent : textColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      {right}
    </View>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export function Badge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg?: string;
}) {
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: bg ?? `${color}22` }]}>
      <Text style={[styles.badgeText, { color }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
  accentBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 7 },
  disabledBtn: { opacity: 0.4 },
  accentBtnText: {
    color: '#000',
    fontFamily: Fonts.sansMedium,
    fontWeight: '700',
    fontSize: 14,
  },
  smallBtnText: { fontSize: 12 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallGhostBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  ghostBtnText: {
    color: Colors.textDim,
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  ctrlBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  ctrlBtnText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionHeaderText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontWeight: '600',
    fontSize: 13,
    color: Colors.textBright,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
});
