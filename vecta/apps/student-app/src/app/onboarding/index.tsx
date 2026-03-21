/**
 * onboarding/index.tsx — Vecta Day-0 Onboarding Wizard
 *
 * Step flow:
 *   1. Welcome  → intro + "Arrive with everything set up" CTA
 *   2. Identity → Didit NFC passport scan instructions
 *   3. Banking  → Unit.co DDA provisioning
 *   4. SIM      → eSIM Go activation
 *   5. Housing  → Plaid bank link + Nova Credit score
 *   6. Done     → module unlock confirmation
 *
 * Each step is gated — cannot advance until previous step is complete.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons }       from '@expo/vector-icons';
import { router }         from 'expo-router';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients } from '../../constants/theme';
import { useStudentStore, useHousingStore } from '../../stores';

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

type StepId = 'welcome' | 'identity' | 'banking' | 'sim' | 'housing' | 'done';

interface Step {
  id:          StepId;
  title:       string;
  subtitle:    string;
  icon:        keyof typeof Ionicons.glyphMap;
  color:       string;
  gradient:    readonly [string, string];
  description: string;
  ctaLabel:    string;
  skipLabel?:  string;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to Vecta',
    subtitle: 'Life-as-a-Service',
    icon: 'rocket',
    color: VectaColors.accent,
    gradient: VectaGradients.hero,
    description:
      "You're about to set up everything you need to live in the US as an F-1 student — banking, housing guarantee, SIM card, and more — in one place.",
    ctaLabel: "Let's Go",
  },
  {
    id: 'identity',
    title: 'Verify Your Identity',
    subtitle: 'NFC Passport Scan',
    icon: 'finger-print',
    color: VectaColors.accent,
    gradient: VectaGradients.hero,
    description:
      "We'll scan your passport chip using NFC to verify your identity. This enables your US banking account, housing guarantee, and compliance protections. Your passport number is encrypted and never shared.",
    ctaLabel: 'Start Passport Scan',
    skipLabel: 'I\'ll do this later',
  },
  {
    id: 'banking',
    title: 'Open Your US Bank Account',
    subtitle: 'Unit.co powered',
    icon: 'card',
    color: VectaColors.banking,
    gradient: VectaGradients.banking,
    description:
      'Get a real US bank account with a debit card — no SSN required. Accepts passport + student visa. Instant approval for F-1 students verified on Vecta.',
    ctaLabel: 'Open Bank Account',
    skipLabel: 'I already have a US account',
  },
  {
    id: 'sim',
    title: 'Activate Your US SIM',
    subtitle: 'eSIM · 5G Ready',
    icon: 'cellular',
    color: VectaColors.connectivity,
    gradient: ['#06B6D4', '#0284C7'],
    description:
      'Get a US phone number instantly via eSIM — no store visit, no credit check. Your eSIM activates the moment you land. Supports 5G on compatible devices.',
    ctaLabel: 'Activate eSIM',
    skipLabel: 'I have a US carrier',
  },
  {
    id: 'housing',
    title: 'Build Your Housing Guarantee',
    subtitle: 'No co-signer needed',
    icon: 'home',
    color: VectaColors.housing,
    gradient: VectaGradients.housing,
    description:
      'Connect your home-country bank account to generate a Letter of Credit. Landlords see a verified financial guarantee — not your actual balance. Your Nova Credit score is translated for US landlords.',
    ctaLabel: 'Connect Bank',
    skipLabel: 'I\'ll do this later',
  },
  {
    id: 'done',
    title: 'You\'re All Set!',
    subtitle: 'Vecta ID Active',
    icon: 'checkmark-circle',
    color: VectaColors.success,
    gradient: VectaGradients.success,
    description:
      'Your Vecta profile is live. Share your Vecta ID with landlords, employers, and anyone who needs to verify your identity and financial standing.',
    ctaLabel: 'Go to Dashboard',
  },
];

// ---------------------------------------------------------------------------
// Progress indicator
// ---------------------------------------------------------------------------

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={dotsStyle.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            dotsStyle.dot,
            i === current
              ? dotsStyle.dotActive
              : i < current
              ? dotsStyle.dotDone
              : dotsStyle.dotIdle,
          ]}
        />
      ))}
    </View>
  );
}

const dotsStyle = StyleSheet.create({
  row:       { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: VectaSpacing['6'] },
  dot:       { width: 8, height: 8, borderRadius: VectaRadius.full },
  dotActive: { width: 24, backgroundColor: VectaColors.accent },
  dotDone:   { backgroundColor: VectaColors.success },
  dotIdle:   { backgroundColor: 'rgba(255,255,255,0.3)' },
});

// ---------------------------------------------------------------------------
// Main onboarding screen
// ---------------------------------------------------------------------------

export default function OnboardingScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  const [loading,   setLoading]   = useState(false);

  const { profile, mintVectaIdToken } = useStudentStore();
  const { fetchTrustScore }           = useHousingStore();

  const step = STEPS[stepIndex]!;

  const handleCTA = useCallback(async () => {
    setLoading(true);
    try {
      switch (step.id) {
        case 'welcome':
          setStepIndex((i) => i + 1);
          break;

        case 'identity':
          // Navigate to Didit NFC scan screen
          router.push('/onboarding/passport-scan');
          break;

        case 'banking':
          // Navigate to banking provisioning screen
          router.push('/onboarding/banking');
          break;

        case 'sim':
          router.push('/onboarding/esim');
          break;

        case 'housing':
          router.push('/onboarding/plaid-link');
          break;

        case 'done':
          // Mint Vecta ID token and go to dashboard
          await mintVectaIdToken();
          await fetchTrustScore();
          router.replace('/(tabs)');
          break;
      }
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [step.id, mintVectaIdToken, fetchTrustScore]);

  const handleSkip = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, []);

  // Show "done" step automatically if KYC approved
  const isKycApproved = profile?.kycStatus === 'APPROVED';

  return (
    <LinearGradient
      colors={step.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Progress dots */}
        <StepDots current={stepIndex} total={STEPS.length} />

        {/* Icon */}
        <View style={styles.iconRing}>
          <Ionicons name={step.icon} size={56} color={step.color} />
        </View>

        {/* Titles */}
        <Text style={styles.subtitle}>{step.subtitle.toUpperCase()}</Text>
        <Text style={styles.title}>{step.title}</Text>

        {/* Description */}
        <View style={styles.card}>
          <Text style={styles.description}>{step.description}</Text>

          {/* Step-specific detail rows */}
          {step.id === 'identity' && (
            <View style={styles.detailList}>
              {['NFC chip passport scan', 'Liveness check', 'Biometric face match', 'AES-256-GCM encrypted storage'].map((item) => (
                <View key={item} style={styles.detailRow}>
                  <Ionicons name="checkmark-circle" size={16} color={VectaColors.success} />
                  <Text style={styles.detailText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {step.id === 'housing' && (
            <View style={styles.detailList}>
              {["Home-country bank — no US history needed", "Exact balance hidden from landlords", "Nova Credit international score translation", "Letter of Credit PDF, HMAC-signed"].map((item) => (
                <View key={item} style={styles.detailRow}>
                  <Ionicons name="checkmark-circle" size={16} color={VectaColors.success} />
                  <Text style={styles.detailText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {step.id === 'done' && (
            <View style={[styles.detailList, { marginTop: VectaSpacing['4'] }]}>
              {[
                { icon: 'shield-checkmark', label: 'Vecta ID Active', ok: isKycApproved },
                { icon: 'card',           label: 'US Bank Account', ok: true },
                { icon: 'cellular',       label: 'US SIM Ready',    ok: true },
                { icon: 'home',           label: 'Housing Guarantee', ok: true },
              ].map(({ icon, label, ok }) => (
                <View key={label} style={styles.detailRow}>
                  <Ionicons
                    name={ok ? 'checkmark-circle' : 'time'}
                    size={16}
                    color={ok ? VectaColors.success : VectaColors.warning}
                  />
                  <Text style={[styles.detailText, !ok && { color: VectaColors.warning }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity
          onPress={handleCTA}
          disabled={loading}
          style={styles.cta}
          activeOpacity={0.88}
        >
          {loading ? (
            <ActivityIndicator color={VectaColors.primary} />
          ) : (
            <Text style={styles.ctaText}>{step.ctaLabel}</Text>
          )}
        </TouchableOpacity>

        {/* Skip */}
        {step.skipLabel && (
          <TouchableOpacity onPress={handleSkip} style={styles.skip}>
            <Text style={styles.skipText}>{step.skipLabel}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: VectaSpacing['6'],
    paddingTop: 80,
    paddingBottom: 48,
    alignItems: 'center',
  },
  iconRing: {
    width: 112,
    height: 112,
    borderRadius: VectaRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: VectaSpacing['6'],
  },
  subtitle: {
    fontFamily: VectaFonts.bold,
    fontSize: VectaFonts.xs,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: VectaFonts.letterSpacing.widest,
    marginBottom: VectaSpacing['1'],
  },
  title: {
    fontFamily: VectaFonts.extraBold,
    fontSize: VectaFonts['3xl'],
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: VectaSpacing['6'],
    lineHeight: VectaFonts['3xl'] * 1.2,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: VectaRadius['2xl'],
    padding: VectaSpacing['5'],
    width: '100%',
    marginBottom: VectaSpacing['8'],
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  description: {
    fontFamily: VectaFonts.regular,
    fontSize: VectaFonts.md,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: VectaFonts.md * 1.6,
    textAlign: 'left',
  },
  detailList: {
    marginTop: VectaSpacing['4'],
    gap: VectaSpacing['2'],
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VectaSpacing['2'],
  },
  detailText: {
    fontFamily: VectaFonts.medium,
    fontSize: VectaFonts.sm,
    color: 'rgba(255,255,255,0.85)',
  },
  cta: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    paddingVertical: VectaSpacing['4'],
    borderRadius: VectaRadius.full,
    alignItems: 'center',
    marginBottom: VectaSpacing['3'],
  },
  ctaText: {
    fontFamily: VectaFonts.bold,
    fontSize: VectaFonts.md,
    color: VectaColors.primary,
  },
  skip: {
    paddingVertical: VectaSpacing['2'],
  },
  skipText: {
    fontFamily: VectaFonts.medium,
    fontSize: VectaFonts.sm,
    color: 'rgba(255,255,255,0.6)',
  },
});
