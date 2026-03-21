/**
 * onboarding/passport-scan.tsx — Didit NFC Passport Scan Screen
 *
 * Flow:
 *   IDLE → tap "Start Scan" → SDK opens → SCANNING →
 *   server-side webhook processes result → APPROVED / FAILED
 *
 * The Didit SDK handles the actual NFC tap UI — this screen shows
 * the pre-scan briefing, real-time status polling, and result state.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanState = 'idle' | 'initiating' | 'scanning' | 'processing' | 'approved' | 'failed';

// ---------------------------------------------------------------------------
// Step instructions
// ---------------------------------------------------------------------------

const SCAN_STEPS = [
  { icon: 'book', title: 'Have your passport ready', detail: 'Open to the photo page — the NFC chip is inside.' },
  { icon: 'phone-portrait', title: 'Place passport on phone', detail: 'Hold the back of your phone flat against the data page for 5–10 seconds.' },
  { icon: 'eye', title: 'Complete liveness check', detail: "You'll be prompted to blink or turn your head. This prevents spoofing." },
  { icon: 'shield-checkmark', title: 'Biometric match', detail: 'Your passport photo is compared to the liveness capture. 90%+ match required.' },
] as const;

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function PassportScanScreen() {
  const { profile, authToken, fetchProfile } = useStudentStore();
  const [scanState, setScanState]   = useState<ScanState>('idle');
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [pollCount, setPollCount]   = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If already verified, skip ahead
  useEffect(() => {
    if (profile?.kycStatus === 'APPROVED') {
      router.replace('/onboarding/banking');
    }
  }, [profile?.kycStatus]);

  // Poll session status after scan initiated
  useEffect(() => {
    if (scanState !== 'scanning' && scanState !== 'processing') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      if (!sessionId || !authToken) return;

      try {
        const res = await fetch(`${API_BASE}/identity/verify/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await res.json() as { status: string; kycStatus?: string };

        setPollCount((c) => c + 1);

        if (data.kycStatus === 'APPROVED') {
          clearInterval(pollRef.current!);
          setScanState('approved');
          await fetchProfile();
          setTimeout(() => router.replace('/onboarding/banking'), 1500);
        } else if (data.kycStatus === 'REJECTED' || data.status === 'failed') {
          clearInterval(pollRef.current!);
          setScanState('failed');
        }
      } catch { /* poll again next interval */ }
    }, 2500);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [scanState, sessionId, authToken, fetchProfile]);

  const handleStartScan = useCallback(async () => {
    if (!authToken || !profile?.id) return;

    setScanState('initiating');
    try {
      const res = await fetch(`${API_BASE}/identity/verify/initiate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: profile.id }),
      });
      const data = await res.json() as { sessionId: string; sdkToken: string };

      setSessionId(data.sessionId);
      setScanState('scanning');

      // In production: DiditSDK.startVerification(data.sdkToken)
      // For now, transition to processing state to simulate
      setTimeout(() => setScanState('processing'), 3000);
    } catch (err) {
      setScanState('failed');
      Alert.alert('Error', 'Could not start verification. Please try again.');
    }
  }, [authToken, profile?.id]);

  const handleRetry = useCallback(() => {
    setScanState('idle');
    setSessionId(null);
    setPollCount(0);
  }, []);

  const handleSkip = useCallback(() => {
    router.replace('/onboarding/banking');
  }, []);

  return (
    <LinearGradient colors={VectaGradients.hero} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Back button */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {/* State: APPROVED */}
        {scanState === 'approved' && (
          <View style={styles.centeredState}>
            <View style={[styles.stateIcon, { backgroundColor: VectaColors.successBg }]}>
              <Ionicons name="shield-checkmark" size={56} color={VectaColors.success} />
            </View>
            <Text style={styles.stateTitle}>Identity Verified!</Text>
            <Text style={styles.stateSub}>Your passport has been authenticated. Setting up your bank account…</Text>
            <ActivityIndicator color="#FFF" style={{ marginTop: VectaSpacing['4'] }} />
          </View>
        )}

        {/* State: FAILED */}
        {scanState === 'failed' && (
          <View style={styles.centeredState}>
            <View style={[styles.stateIcon, { backgroundColor: VectaColors.errorBg }]}>
              <Ionicons name="close-circle" size={56} color={VectaColors.error} />
            </View>
            <Text style={styles.stateTitle}>Verification Failed</Text>
            <Text style={styles.stateSub}>
              The passport scan could not be completed. Common causes:{'\n'}
              • NFC not held long enough{'\n'}
              • Passport chip not readable{'\n'}
              • Liveness check not passed
            </Text>
            <TouchableOpacity onPress={handleRetry} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSkip} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* State: SCANNING / PROCESSING */}
        {(scanState === 'scanning' || scanState === 'processing') && (
          <View style={styles.centeredState}>
            <View style={[styles.stateIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              {scanState === 'scanning' ? (
                <Ionicons name="radio" size={56} color={VectaColors.accent} />
              ) : (
                <ActivityIndicator size="large" color={VectaColors.accent} />
              )}
            </View>
            <Text style={styles.stateTitle}>
              {scanState === 'scanning' ? 'Scanning Passport…' : 'Processing…'}
            </Text>
            <Text style={styles.stateSub}>
              {scanState === 'scanning'
                ? 'Hold your passport flat against the back of your phone.'
                : 'Running liveness check and biometric match. This takes 10–30 seconds.'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: VectaFonts.mono, fontSize: VectaFonts.xs, marginTop: VectaSpacing['4'] }}>
              {pollCount > 0 ? `Polling… (${pollCount})` : 'Waiting for NFC…'}
            </Text>
          </View>
        )}

        {/* State: IDLE or INITIATING */}
        {(scanState === 'idle' || scanState === 'initiating') && (
          <>
            {/* Icon */}
            <View style={styles.heroIcon}>
              <Ionicons name="book" size={52} color={VectaColors.accent} />
            </View>

            <Text style={styles.tag}>STEP 1 OF 5 · IDENTITY</Text>
            <Text style={styles.title}>Passport Verification</Text>
            <Text style={styles.subtitle}>
              We scan your passport's NFC chip to verify your identity with government-level security.
              Your passport number is encrypted and never shared with landlords.
            </Text>

            {/* Step list */}
            <View style={styles.stepList}>
              {SCAN_STEPS.map((step, i) => (
                <View key={step.title} style={styles.stepRow}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.stepHeader}>
                      <Ionicons name={step.icon} size={16} color={VectaColors.accent} />
                      <Text style={styles.stepTitle}>{step.title}</Text>
                    </View>
                    <Text style={styles.stepDetail}>{step.detail}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Privacy notice */}
            <View style={styles.privacyBox}>
              <Ionicons name="lock-closed" size={14} color={VectaColors.accent} />
              <Text style={styles.privacyText}>
                Your passport number is AES-256-GCM encrypted and never included in any landlord view or JWT token.
              </Text>
            </View>

            {/* CTA */}
            <TouchableOpacity
              onPress={handleStartScan}
              disabled={scanState === 'initiating'}
              style={[styles.primaryBtn, scanState === 'initiating' && { opacity: 0.7 }]}
              activeOpacity={0.88}
            >
              {scanState === 'initiating' ? (
                <ActivityIndicator color={VectaColors.primary} />
              ) : (
                <Text style={styles.primaryBtnText}>Start Passport Scan</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSkip} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>I'll do this later</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: VectaSpacing['6'],
    paddingTop: 60,
    paddingBottom: 48,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: VectaRadius.full,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: VectaSpacing['6'],
  },

  // Shared state layouts
  centeredState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: VectaSpacing['4'] },
  stateIcon:     { width: 100, height: 100, borderRadius: VectaRadius.full, alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['2'] },
  stateTitle:    { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', textAlign: 'center' },
  stateSub:      { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 22, maxWidth: 300 },

  // Idle layout
  heroIcon: { width: 96, height: 96, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['5'] },
  tag:      { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', letterSpacing: VectaFonts.letterSpacing.widest, marginBottom: VectaSpacing['2'] },
  title:    { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF', marginBottom: VectaSpacing['3'], lineHeight: VectaFonts['3xl'] * 1.2 },
  subtitle: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: 'rgba(255,255,255,0.8)', lineHeight: 24, marginBottom: VectaSpacing['6'] },

  stepList: { gap: VectaSpacing['4'], marginBottom: VectaSpacing['5'] },
  stepRow:  { flexDirection: 'row', gap: VectaSpacing['3'], alignItems: 'flex-start' },
  stepNum:  { width: 24, height: 24, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  stepNumText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.accent },
  stepHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  stepTitle:   { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: '#FFF' },
  stepDetail:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.65)', lineHeight: 18 },

  privacyBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(0,212,255,0.1)', borderRadius: VectaRadius.md, padding: VectaSpacing['3'], marginBottom: VectaSpacing['6'], borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)' },
  privacyText: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.7)', flex: 1, lineHeight: 16 },

  primaryBtn:     { backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], alignItems: 'center', marginBottom: VectaSpacing['3'] },
  primaryBtnText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.primary },
  ghostBtn:       { paddingVertical: VectaSpacing['2'], alignItems: 'center' },
  ghostBtnText:   { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.55)' },
});
