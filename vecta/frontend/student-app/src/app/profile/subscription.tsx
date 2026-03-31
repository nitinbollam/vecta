/**
 * Vecta subscription plans — billed via Vecta Ledger.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/banking/billing/subscription`, { headers });
      const data = (await res.json()) as Record<string, unknown>;
      setCurrent(data);
    } catch {
      setCurrent({ plan: 'student_basic', status: 'FREE' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sub = isDark ? '#7A9BAD' : VectaColors.textSecondary;
  const surface = isDark ? '#152238' : VectaColors.surface1;

  const planLabel =
    current?.status === 'FREE'
      ? 'Vecta Basic'
      : String((current?.name as string) ?? current?.plan ?? 'Vecta');

  const upgradePro = () => {
    Alert.alert(
      'Upgrade to Vecta Pro',
      'Vecta Pro is $19.99/month charged to your Vecta account balance.\n\nMake sure your account has sufficient funds before upgrading.',
      [
        {
          text: 'Upgrade Now',
          onPress: async () => {
            try {
              const headers = await getAuthHeaders();
              const res = await fetch(`${API_V1_BASE}/banking/billing/subscribe`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ planId: 'student_pro' }),
              });
              const data = (await res.json()) as { success?: boolean; error?: string; message?: string };
              if (res.ok && data.success) {
                Alert.alert('Welcome to Vecta Pro! 🎉', data.message ?? 'Your subscription is now active.');
                void load();
              } else if (data.error === 'ALREADY_SUBSCRIBED') {
                Alert.alert('Already subscribed', 'You already have an active plan.');
              } else {
                Alert.alert(
                  'Upgrade Failed',
                  data.error === 'INSUFFICIENT_BALANCE'
                    ? 'Insufficient balance. Add funds to your Vecta account first.'
                    : 'Could not process upgrade. Please try again.',
                );
              }
            } catch {
              Alert.alert('Error', 'Could not reach Vecta. Try again.');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={VectaColors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: isDark ? VectaColors.primaryMid : VectaColors.surfaceBase, paddingTop: insets.top }}
      contentContainerStyle={{ padding: VectaSpacing.lg, paddingBottom: 48 }}
    >
      <Text style={[styles.head, { color: colors.text }]}>Subscription</Text>
      <Text style={[styles.current, { color: sub }]}>
        Current: {planLabel} · {String(current?.status ?? 'FREE')}
      </Text>

      <PlanCard
        title="Vecta Basic (Free)"
        surface={surface}
        border={colors.border}
        textColor={colors.text}
        sub={sub}
        lines={[
          '✓ Vecta ID (NFC verified identity)',
          '✓ US eSIM',
          '✓ Ride booking (priority + carpool)',
          '✗ Housing Guarantee',
          '✗ Letter of Credit',
          '✗ Insurance',
        ]}
      />

      <PlanCard
        title="Vecta Pro"
        surface={surface}
        border={colors.border}
        textColor={colors.text}
        sub={sub}
        badge="MOST POPULAR"
        lines={[
          'Everything in Basic',
          '✓ Housing Guarantee (no co-signer needed)',
          '✓ Letter of Credit generation',
          '✓ Insurance access',
          '✓ Priority support',
        ]}
        footer="$19.99/month · billed from Vecta Ledger"
        action={
          <TouchableOpacity style={styles.upgradeBtn} onPress={upgradePro}>
            <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        }
      />

      <PlanCard
        title="Vecta Annual"
        surface={surface}
        border={colors.border}
        textColor={colors.text}
        sub={sub}
        badge="BEST VALUE"
        lines={['Everything in Pro', '2 months free vs monthly']}
        footer="$199.99/year"
      />

      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24 }}>
        <Text style={{ color: VectaColors.accent, fontFamily: VectaFonts.semiBold }}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function PlanCard(props: {
  title: string;
  surface: string;
  border: string;
  textColor: string;
  sub: string;
  badge?: string;
  lines: string[];
  footer?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: props.surface, borderColor: props.border }]}>
      {props.badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{props.badge}</Text>
        </View>
      ) : null}
      <Text style={[styles.cardTitle, { color: props.textColor }]}>{props.title}</Text>
      {props.lines.map((line) => (
        <Text key={line} style={[styles.line, { color: props.sub }]}>
          {line}
        </Text>
      ))}
      {props.footer ? <Text style={[styles.footer, { color: props.textColor }]}>{props.footer}</Text> : null}
      {props.action}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  head: { fontFamily: VectaFonts.bold, fontSize: 24, marginBottom: 8 },
  current: { fontFamily: VectaFonts.regular, marginBottom: 20 },
  card: {
    borderRadius: VectaRadius.lg,
    borderWidth: 1,
    padding: VectaSpacing.lg,
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#00E6CC',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 12,
  },
  badgeText: { fontSize: 10, fontFamily: VectaFonts.bold, color: '#001F3F' },
  cardTitle: { fontFamily: VectaFonts.bold, fontSize: 18, marginBottom: 10 },
  line: { fontSize: 13, marginBottom: 6, fontFamily: VectaFonts.regular },
  footer: { fontFamily: VectaFonts.semiBold, marginTop: 10, fontSize: 14 },
  upgradeBtn: {
    marginTop: 14,
    backgroundColor: '#00E6CC',
    borderRadius: VectaRadius.md,
    padding: 14,
    alignItems: 'center',
  },
  upgradeBtnText: { color: '#001F3F', fontFamily: VectaFonts.bold, fontSize: 15 },
});
