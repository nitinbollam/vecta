/**
 * app/auth/login.tsx — Student App Login Screen
 *
 * Authentication flow:
 *   Option A: Magic link (email) — recommended for F-1 students (no US phone needed)
 *   Option B: Google OAuth — for students with Google accounts
 *
 * Post-auth:
 *   New students → /onboarding
 *   Returning students with VERIFIED status → /(tabs)
 *   Returning students without verification → /onboarding/passport-scan
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { API_V1_BASE } from '../../config/api';

type AuthStep = 'entry' | 'check_email' | 'verifying';

export default function LoginScreen() {
  const setAuthToken = useStudentStore((s) => s.setAuthToken);
  const setProfile   = useStudentStore((s) => s.setProfile);

  const [step,    setStep]    = useState<AuthStep>('entry');
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // ---------------------------------------------------------------------------
  // Send magic link
  // ---------------------------------------------------------------------------
  const handleSendMagicLink = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_V1_BASE}/auth/magic-link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? 'Failed to send link');
      }

      setStep('check_email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ---------------------------------------------------------------------------
  // Dev bypass — inject mock data locally, no network call needed.
  // Works on physical devices where localhost:4000 is unreachable, and on
  // Render where NODE_ENV=production disables the dev-token endpoint.
  // ---------------------------------------------------------------------------
  const handleDevBypass = useCallback(() => {
    if (process.env.NODE_ENV === 'production') return;

    setAuthToken('dev-token-local');
    setProfile({
      id:               'dev-student-00000000-0000-0000-0000-000000000000',
      fullName:         'Dev Student',
      universityName:   'MIT',
      programOfStudy:   'Computer Science',
      visaStatus:       'F-1',
      visaValidThrough: '2027-08-31',
      kycStatus:        'APPROVED',
      vectaIdStatus:    'VERIFIED',
      role:             'STUDENT',
    });
    router.replace('/(tabs)');
  }, [setAuthToken, setProfile]);

  return (
    <LinearGradient colors={VectaGradients.hero} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Ionicons name="shield-checkmark" size={40} color={VectaColors.accent} />
            </View>
            <Text style={styles.wordmark}>VECTA</Text>
            <Text style={styles.tagline}>Life-as-a-Service for F-1 Students</Text>
          </View>

          {/* --- Step: Entry --- */}
          {step === 'entry' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardSubtitle}>
                Enter your university email to receive a sign-in link.
                No password needed.
              </Text>

              <Text style={styles.inputLabel}>University Email</Text>
              <TextInput
                style={[styles.input, error ? styles.inputError : null]}
                placeholder="you@university.edu"
                placeholderTextColor={VectaColors.textMuted}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={handleSendMagicLink}
              />

              {error ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : null}

              <TouchableOpacity
                onPress={handleSendMagicLink}
                disabled={loading || !email}
                style={[styles.primaryBtn, (!email || loading) && styles.btnDisabled]}
                activeOpacity={0.88}
              >
                {loading ? (
                  <ActivityIndicator color={VectaColors.primary} />
                ) : (
                  <>
                    <Ionicons name="mail" size={18} color={VectaColors.primary} />
                    <Text style={styles.primaryBtnText}>Send Sign-In Link</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity style={styles.googleBtn} activeOpacity={0.88}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </TouchableOpacity>

              {/* Dev bypass — only in non-production */}
              {__DEV__ && (
                <TouchableOpacity onPress={handleDevBypass} style={styles.devBtn}>
                  <Text style={styles.devBtnText}>⚡ Dev: Skip Auth</Text>
                </TouchableOpacity>
              )}

              <Text style={styles.disclaimer}>
                By signing in, you agree to Vecta's{' '}
                <Text style={styles.link}>Terms of Service</Text> and{' '}
                <Text style={styles.link}>Privacy Policy</Text>.
              </Text>
            </View>
          )}

          {/* --- Step: Check email --- */}
          {step === 'check_email' && (
            <View style={styles.card}>
              <View style={styles.emailIcon}>
                <Text style={{ fontSize: 40 }}>📧</Text>
              </View>
              <Text style={styles.cardTitle}>Check Your Email</Text>
              <Text style={styles.cardSubtitle}>
                We sent a sign-in link to{'\n'}
                <Text style={{ fontFamily: VectaFonts.bold, color: VectaColors.text }}>
                  {email}
                </Text>
              </Text>

              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={16} color={VectaColors.info} />
                <Text style={styles.infoText}>
                  The link expires in 15 minutes and can only be used once.
                  Check your spam folder if you don't see it.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => { setStep('entry'); setEmail(''); }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>Use a different email</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* --- Step: Verifying (deep link handler) --- */}
          {step === 'verifying' && (
            <View style={[styles.card, { alignItems: 'center', gap: VectaSpacing['4'] }]}>
              <ActivityIndicator size="large" color={VectaColors.accent} />
              <Text style={styles.cardTitle}>Signing you in…</Text>
            </View>
          )}

          {/* Benefits strip */}
          <View style={styles.benefitsRow}>
            {[
              { icon: 'shield-checkmark', label: 'NFC Verified' },
              { icon: 'card',            label: 'US Banking'    },
              { icon: 'home',            label: 'No Co-signer'  },
              { icon: 'car-sport',       label: 'Fleet Income'  },
            ].map(({ icon, label }) => (
              <View key={label} style={styles.benefit}>
                <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color="rgba(255,255,255,0.7)" />
                <Text style={styles.benefitLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll:      { flexGrow: 1, padding: VectaSpacing['6'], paddingTop: 80, paddingBottom: 40 },

  logoArea:    { alignItems: 'center', marginBottom: VectaSpacing['8'] },
  logoCircle:  { width: 80, height: 80, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['3'] },
  wordmark:    { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['4xl'], color: '#FFF', letterSpacing: 4 },
  tagline:     { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.65)', marginTop: VectaSpacing['1'] },

  card:        { backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius['2xl'], padding: VectaSpacing['6'], marginBottom: VectaSpacing['6'] },
  cardTitle:   { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: VectaColors.text, marginBottom: VectaSpacing['2'] },
  cardSubtitle:{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, lineHeight: 20, marginBottom: VectaSpacing['5'] },

  inputLabel:  { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text, marginBottom: VectaSpacing['2'] },
  input:       { borderWidth: 1, borderColor: VectaColors.border, borderRadius: VectaRadius.lg, paddingHorizontal: VectaSpacing['4'], paddingVertical: VectaSpacing['3'], fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: VectaColors.text, backgroundColor: VectaColors.surface1, marginBottom: VectaSpacing['4'] },
  inputError:  { borderColor: VectaColors.error },
  errorText:   { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.error, marginTop: -VectaSpacing['3'], marginBottom: VectaSpacing['3'] },

  primaryBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], marginBottom: VectaSpacing['3'] },
  btnDisabled:    { opacity: 0.5 },
  primaryBtnText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.primary },

  divider:     { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], marginVertical: VectaSpacing['3'] },
  dividerLine: { flex: 1, height: 1, backgroundColor: VectaColors.border },
  dividerText: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted },

  googleBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: VectaSpacing['3'], borderWidth: 1, borderColor: VectaColors.border, borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['3'], backgroundColor: VectaColors.surface1 },
  googleIcon:    { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.lg, color: '#4285F4' },
  googleBtnText: { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text },

  devBtn:        { alignItems: 'center', paddingVertical: VectaSpacing['3'], marginTop: VectaSpacing['2'] },
  devBtnText:    { fontFamily: VectaFonts.mono, fontSize: VectaFonts.xs, color: VectaColors.textMuted },

  disclaimer:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center', marginTop: VectaSpacing['4'], lineHeight: 18 },
  link:        { color: VectaColors.primary, fontFamily: VectaFonts.medium },

  emailIcon:   { alignItems: 'center', marginBottom: VectaSpacing['4'] },
  infoBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#EFF6FF', borderRadius: VectaRadius.md, padding: VectaSpacing['3'], marginBottom: VectaSpacing['5'] },
  infoText:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.info, flex: 1, lineHeight: 18 },

  ghostBtn:     { alignItems: 'center', paddingVertical: VectaSpacing['2'] },
  ghostBtnText: { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textSecondary },

  benefitsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  benefit:     { alignItems: 'center', gap: VectaSpacing['1'] },
  benefitLabel:{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.55)' },
});
