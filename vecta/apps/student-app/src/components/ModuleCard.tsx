import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaShadows } from '../constants/theme';

type CardStatus = 'active' | 'pending' | 'idle' | 'error' | 'locked';

interface ModuleCardProps {
  icon: string;
  title: string;
  status?: CardStatus;
  children: React.ReactNode;
  onPress?: () => void;
  isLoading?: boolean;
  testID?: string;
  style?: ViewStyle;
}

const STATUS_DOT: Record<CardStatus, string> = {
  active:  VectaColors.success,
  pending: VectaColors.warning,
  idle:    VectaColors.textMuted,
  error:   VectaColors.error,
  locked:  VectaColors.textMuted,
};

export function ModuleCard({
  icon, title, status, children, onPress, isLoading, testID, style,
}: ModuleCardProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.92}
      style={[styles.card, VectaShadows.sm, style]}
    >
      <View style={styles.header}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>{title}</Text>
        {status && (
          <View style={[styles.dot, { backgroundColor: STATUS_DOT[status] }]} />
        )}
      </View>
      <View style={styles.body}>
        {isLoading ? (
          <ActivityIndicator size="small" color={VectaColors.primary} style={{ paddingVertical: 8 }} />
        ) : (
          children
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: VectaColors.surfaceBase,
    borderRadius: VectaRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: VectaColors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VectaSpacing['2'],
    paddingHorizontal: VectaSpacing['4'],
    paddingVertical: VectaSpacing['3'],
    borderBottomWidth: 1,
    borderBottomColor: VectaColors.border,
    backgroundColor: VectaColors.surface1,
  },
  icon: {
    fontSize: 18,
  },
  title: {
    flex: 1,
    fontFamily: VectaFonts.semiBold,
    fontSize: VectaFonts.md,
    color: VectaColors.text,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: VectaRadius.full,
  },
  body: {
    padding: VectaSpacing['4'],
  },
});
