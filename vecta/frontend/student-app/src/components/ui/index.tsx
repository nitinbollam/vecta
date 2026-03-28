/**
 * components/ui/index.tsx — Core reusable UI components for Vecta Student App
 *
 * Components:
 *   VectaIDStatusBadge  — NFC verification status pill
 *   ModuleCard          — Dashboard module card with gradient header
 *   StatusRow           — Label + value row for module cards
 *   SkeletonLoader      — Loading placeholder
 *   VectaBadge          — Small coloured tag (score tiers, etc.)
 *   SolvencyBadge       — ✅ SOLVENT / ⚠️ PENDING indicator
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaShadows, VectaGradients } from '../../constants/theme';

// ---------------------------------------------------------------------------
// VectaIDStatusBadge
// ---------------------------------------------------------------------------

type VectaIDStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'EXPIRED';

interface VectaIDStatusBadgeProps {
  status: VectaIDStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<VectaIDStatus, {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  label: string;
}> = {
  UNVERIFIED: { icon: 'alert-circle', color: VectaColors.textMuted,  bg: VectaColors.surface2,  label: 'Identity Unverified'     },
  PENDING:    { icon: 'time',         color: VectaColors.warning,    bg: VectaColors.warningBg, label: 'Verification Pending'    },
  VERIFIED:   { icon: 'shield-checkmark', color: VectaColors.success, bg: VectaColors.successBg, label: 'NFC CHIP VERIFIED'   },
  EXPIRED:    { icon: 'refresh-circle',  color: VectaColors.error,   bg: VectaColors.errorBg,   label: 'Token Expired — Renew'  },
};

export function VectaIDStatusBadge({ status, size = 'md', showLabel = true }: VectaIDStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  const fontSize = size === 'sm' ? VectaFonts.xs : size === 'lg' ? VectaFonts.md : VectaFonts.sm;

  return (
    <View style={[badgeStyles.container, { backgroundColor: config.bg }]}>
      <Ionicons name={config.icon} size={iconSize} color={config.color} />
      {showLabel && (
        <Text style={[badgeStyles.label, { color: config.color, fontSize }]}>
          {status === 'VERIFIED' ? `✅ IDENTITY SECURE — ${config.label}` : config.label}
        </Text>
      )}
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: VectaSpacing['3'],
    paddingVertical: 6,
    borderRadius: VectaRadius.full,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: VectaFonts.semiBold,
    letterSpacing: VectaFonts.letterSpacing.wide,
  },
});

// ---------------------------------------------------------------------------
// ModuleCard
// ---------------------------------------------------------------------------

type ModuleType = 'banking' | 'housing' | 'mobility' | 'connectivity' | 'insurance' | 'identity';

const MODULE_CONFIG: Record<ModuleType, {
  gradient: readonly [string, string];
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
}> = {
  banking:     { gradient: VectaGradients.banking,  icon: 'card',          accentColor: VectaColors.banking     },
  housing:     { gradient: VectaGradients.housing,  icon: 'home',          accentColor: VectaColors.housing     },
  mobility:    { gradient: VectaGradients.mobility, icon: 'car-sport',     accentColor: VectaColors.mobility    },
  connectivity:{ gradient: ['#06B6D4', '#0284C7'] as const, icon: 'cellular', accentColor: VectaColors.connectivity },
  insurance:   { gradient: ['#001F3F', '#001A33'] as const, icon: 'shield',   accentColor: VectaColors.insurance   },
  identity:    { gradient: VectaGradients.hero,     icon: 'finger-print',  accentColor: VectaColors.accent      },
};

interface ModuleCardProps {
  type: ModuleType;
  title: string;
  subtitle?: string;
  status?: 'active' | 'pending' | 'locked' | 'error';
  children: React.ReactNode;
  onPress?: () => void;
  isLoading?: boolean;
  style?: ViewStyle;
}

export function ModuleCard({
  type, title, subtitle, status, children, onPress, isLoading, style,
}: ModuleCardProps) {
  const config = MODULE_CONFIG[type];

  const statusDot = status ? (
    <View style={[cardStyles.statusDot, {
      backgroundColor:
        status === 'active'  ? VectaColors.success  :
        status === 'pending' ? VectaColors.warning   :
        status === 'error'   ? VectaColors.error     :
        VectaColors.textMuted,
    }]} />
  ) : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.92}
      style={[cardStyles.wrapper, VectaShadows.md, style]}
    >
      {/* Header gradient */}
      <LinearGradient
        colors={config.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={cardStyles.header}
      >
        <View style={cardStyles.headerLeft}>
          <View style={cardStyles.iconCircle}>
            <Ionicons name={config.icon} size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={cardStyles.headerTitle}>{title}</Text>
            {subtitle && <Text style={cardStyles.headerSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        <View style={cardStyles.headerRight}>
          {statusDot}
          {onPress && (
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
          )}
        </View>
      </LinearGradient>

      {/* Body */}
      <View style={cardStyles.body}>
        {isLoading ? (
          <ActivityIndicator size="small" color={config.accentColor} style={{ paddingVertical: 12 }} />
        ) : (
          children
        )}
      </View>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: VectaColors.surfaceBase,
    borderRadius: VectaRadius.xl,
    overflow: 'hidden',
    marginBottom: VectaSpacing['4'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: VectaSpacing['4'],
    paddingVertical: VectaSpacing['3'],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VectaSpacing['3'],
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: VectaRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: VectaFonts.bold,
    fontSize: VectaFonts.md,
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontFamily: VectaFonts.regular,
    fontSize: VectaFonts.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: VectaRadius.full,
  },
  body: {
    padding: VectaSpacing['4'],
    gap: VectaSpacing['2'],
  },
});

// ---------------------------------------------------------------------------
// StatusRow — label + value row inside ModuleCard
// ---------------------------------------------------------------------------

interface StatusRowProps {
  label: string;
  value: string;
  valueColor?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function StatusRow({ label, value, valueColor, icon, style }: StatusRowProps) {
  return (
    <View style={[rowStyles.container, style]}>
      <Text style={rowStyles.label}>{label}</Text>
      <View style={rowStyles.valueRow}>
        {icon && (
          <Ionicons
            name={icon}
            size={14}
            color={valueColor ?? VectaColors.text}
            style={{ marginRight: 4 }}
          />
        )}
        <Text style={[rowStyles.value, valueColor ? { color: valueColor } : {}]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  label: {
    fontFamily: VectaFonts.regular,
    fontSize: VectaFonts.sm,
    color: VectaColors.textSecondary,
    flex: 1,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: {
    fontFamily: VectaFonts.semiBold,
    fontSize: VectaFonts.sm,
    color: VectaColors.text,
    textAlign: 'right',
  },
});

// ---------------------------------------------------------------------------
// SolvencyBadge
// ---------------------------------------------------------------------------

type SolvencyStatus = 'SOLVENT' | 'PENDING' | 'INSUFFICIENT' | 'UNCHECKED';

interface SolvencyBadgeProps {
  status: SolvencyStatus;
  guaranteeMonths?: number;
}

export function SolvencyBadge({ status, guaranteeMonths = 12 }: SolvencyBadgeProps) {
  const config = {
    SOLVENT:      { icon: '✅', color: VectaColors.success, bg: VectaColors.successBg, label: `SOLVENT: ${guaranteeMonths} Months Rent Guaranteed` },
    PENDING:      { icon: '⏳', color: VectaColors.warning, bg: VectaColors.warningBg, label: 'Solvency Check In Progress'  },
    INSUFFICIENT: { icon: '⚠️', color: VectaColors.error,   bg: VectaColors.errorBg,   label: 'Insufficient Funds Detected' },
    UNCHECKED:    { icon: '🔒', color: VectaColors.textMuted, bg: VectaColors.surface2, label: 'Bank Not Yet Connected'      },
  }[status];

  return (
    <View style={[solvencyStyles.container, { backgroundColor: config.bg }]}>
      <Text style={{ fontSize: 14 }}>{config.icon}</Text>
      <Text style={[solvencyStyles.label, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
}

const solvencyStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: VectaSpacing['3'],
    paddingVertical: 8,
    borderRadius: VectaRadius.md,
  },
  label: {
    fontFamily: VectaFonts.semiBold,
    fontSize: VectaFonts.sm,
    flex: 1,
    flexWrap: 'wrap',
  },
});

// ---------------------------------------------------------------------------
// SkeletonLoader
// ---------------------------------------------------------------------------

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonLoader({ width = '100%', height = 16, borderRadius = VectaRadius.sm, style }: SkeletonProps) {
  return (
    <View
      style={[
        { width: width as ViewStyle['width'], height, borderRadius, backgroundColor: VectaColors.surface2 },
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// VectaBadge — small coloured tag
// ---------------------------------------------------------------------------

interface VectaBadgeProps {
  label: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'primary';
}

export function VectaBadge({ label, variant = 'primary' }: VectaBadgeProps) {
  const colorMap = {
    success: { bg: VectaColors.successBg, text: VectaColors.success },
    warning: { bg: VectaColors.warningBg, text: VectaColors.warning },
    error:   { bg: VectaColors.errorBg,   text: VectaColors.error   },
    info:    { bg: '#EFF6FF',             text: VectaColors.info     },
    primary: { bg: '#EEF2FF',             text: VectaColors.primary  },
  }[variant];

  return (
    <View style={[vbStyles.container, { backgroundColor: colorMap.bg }]}>
      <Text style={[vbStyles.text, { color: colorMap.text }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const vbStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: VectaRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: VectaFonts.bold,
    fontSize: VectaFonts.xs,
    letterSpacing: VectaFonts.letterSpacing.widest,
  },
});
