/**
 * app/onboarding/passport-scan.tsx
 *
 * Vecta In-house NFC Passport Verification Screen
 * Replaces the Didit SDK redirect with our own ICAO 9303 pipeline.
 *
 * Flow:
 *   1. MRZ Scanner — camera overlay with MRZ zone highlighted
 *   2. NFC prompt — "Tap back of passport to phone"
 *   3. Chip read progress
 *   4. Liveness challenges
 *   5. Result
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import { API_V1_BASE } from '../../config/api';
import { useTheme } from '../../context/ThemeContext';
import {
  VectaIDService,
  type VerificationStep,
  type VectaIDResult,
} from '../../services/nfc/VectaIDService';
import { LivenessDetector } from '../../services/nfc/LivenessDetector';

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface StepDef {
  key:         VerificationStep;
  label:       string;
  description: string;
  icon:        string;
}

const STEPS: StepDef[] = [
  { key: 'MRZ_SCANNING',    label: 'Scan Passport',  description: 'Align the bottom of your passport in the frame', icon: 'scan' },
  { key: 'MRZ_DETECTED',    label: 'Passport Found', description: 'Hold steady — reading passport data',           icon: 'checkmark-circle' },
  { key: 'NFC_WAITING',     label: 'Tap Chip',       description: 'Hold the back of your passport to your phone', icon: 'wifi' },
  { key: 'NFC_READING_DG1', label: 'Reading Chip',   description: 'Reading identity data…',                       icon: 'document-text' },
  { key: 'NFC_READING_DG2', label: 'Reading Chip',   description: 'Reading biometric photo…',                    icon: 'person' },
  { key: 'NFC_READING_SOD', label: 'Reading Chip',   description: 'Reading security certificate…',               icon: 'shield' },
  { key: 'PASSIVE_AUTH',    label: 'Verifying',      description: 'Verifying chip signature…',                   icon: 'lock-closed' },
  { key: 'ACTIVE_AUTH',     label: 'Verifying',      description: 'Confirming chip is genuine…',                 icon: 'key' },
  { key: 'LIVENESS_BLINK',  label: 'Liveness',       description: 'Please BLINK both eyes slowly',              icon: 'eye' },
  { key: 'LIVENESS_SMILE',  label: 'Liveness',       description: 'Please SMILE',                               icon: 'happy' },
  { key: 'LIVENESS_TURN_LEFT',  label: 'Liveness',   description: 'Turn your head SLOWLY TO THE LEFT',          icon: 'arrow-back' },
  { key: 'LIVENESS_TURN_RIGHT', label: 'Liveness',   description: 'Turn your head SLOWLY TO THE RIGHT',         icon: 'arrow-forward' },
  { key: 'FACE_MATCH',      label: 'Face Match',     description: 'Comparing with passport photo…',             icon: 'people' },
  { key: 'COMPLETE',        label: 'Verified',       description: 'Identity verified successfully',             icon: 'checkmark-circle' },
  { key: 'FAILED',          label: 'Failed',         description: 'Verification failed — please retry',         icon: 'close-circle' },
];

// ---------------------------------------------------------------------------
// Result display component
// ---------------------------------------------------------------------------

function VerificationResult({ result, onRetry }: {
  result: VectaIDResult;
  onRetry: () => void;
}) {
  const { colors } = useTheme();

  if (!result.success) {
    return (
      <View style={[res.card, { backgroundColor: colors.surface1 }]}>
        <Ionicons name="close-circle" size={64} color="#EF4444" />
        <Text style={[res.title, { color: colors.text }]}>Verification Failed</Text>
        <Text style={[res.reason, { color: colors.textSecondary }]}>{result.error ?? 'Unknown error'}</Text>
        <View style={res.checks}>
          <CheckItem label="NFC Chip"      passed={result.chipAuthenticated} />
          <CheckItem label="Chip Signature" passed={result.passiveAuthPassed} />
          <CheckItem label="Anti-Clone"    passed={result.activeAuthPassed} />
          <CheckItem label="Liveness"      passed={result.livenessScore >= 0.92} />
          <CheckItem label="Face Match"    passed={result.facialMatchScore >= 0.90} />
        </View>
        <TouchableOpacity onPress={onRetry} style={res.retryBtn}>
          <Text style={res.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[res.card, { backgroundColor: colors.surface1 }]}>
      <Ionicons name="shield-checkmark" size={64} color="#00E6CC" />
      <Text style={[res.title, { color: colors.text }]}>Identity Verified</Text>
      <Text style={[res.subtitle, { color: colors.textSecondary }]}>
        Your passport has been verified using NFC chip technology
      </Text>
      <View style={res.checks}>
        <CheckItem label="NFC Chip Authenticated" passed={true} />
        <CheckItem label="Chip Signature Valid"   passed={true} />
        <CheckItem label="Anti-Clone Check"       passed={true} />
        <CheckItem label={`Liveness ${(result.livenessScore * 100).toFixed(0)}%`} passed={true} />
        <CheckItem label={`Face Match ${(result.facialMatchScore * 100).toFixed(0)}%`} passed={true} />
      </View>
    </View>
  );
}

function CheckItem({ label, passed }: { label: string; passed: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={res.checkRow}>
      <Ionicons
        name={passed ? 'checkmark-circle' : 'close-circle'}
        size={20}
        color={passed ? '#00C896' : '#EF4444'}
      />
      <Text style={[res.checkLabel, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function PassportScanScreen() {
  const { colors }      = useTheme();
  const authToken       = useStudentStore((s) => s.authToken);
  const fetchProfile    = useStudentStore((s) => s.fetchProfile);

  const [currentStep,   setCurrentStep]   = useState<VerificationStep>('IDLE');
  const [progress,      setProgress]      = useState(0);
  const [result,        setResult]        = useState<VectaIDResult | null>(null);
  const [isRunning,     setIsRunning]     = useState(false);
  const [submitting,    setSubmitting]    = useState(false);

  const stepDef = STEPS.find(s => s.key === currentStep) ?? STEPS[0];

  const handleStep = useCallback((step: VerificationStep, prog: number) => {
    setCurrentStep(step);
    setProgress(prog);
  }, []);

  // ---------------------------------------------------------------------------
  // Start verification
  // ---------------------------------------------------------------------------

  const handleStart = useCallback(async () => {
    setIsRunning(true);
    setResult(null);
    setCurrentStep('MRZ_SCANNING');

    try {
      // In production: MRZ is extracted by the camera overlay component
      // and passed to VectaIDService. For scaffold, we show the camera
      // and wait for the user to position the passport.

      // Simulate MRZ capture prompt (real implementation uses expo-camera + ML Kit OCR)
      Alert.alert(
        'Position Your Passport',
        'Align the bottom lines of your passport data page in the frame.',
        [{ text: 'Ready', onPress: () => runVerification() }],
      );
    } catch (err) {
      setIsRunning(false);
      Alert.alert('Error', 'Could not start verification. Please try again.');
    }
  }, []);

  const runVerification = useCallback(async () => {
    const service = new VectaIDService(handleStep);

    // In production: mrzLine1 and mrzLine2 come from the camera OCR
    // These are placeholder values for scaffolding
    const mrzLine1 = 'P<USASMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<';
    const mrzLine2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<14';

    const verificationResult = await service.verify(mrzLine1, mrzLine2);
    setResult(verificationResult);
    setIsRunning(false);

    if (verificationResult.success) {
      await submitToBackend(verificationResult);
    }
  }, [handleStep]);

  // ---------------------------------------------------------------------------
  // Submit to backend
  // ---------------------------------------------------------------------------

  const submitToBackend = useCallback(async (verResult: VectaIDResult) => {
    if (!authToken) return;
    setSubmitting(true);

    try {
      const biometricPhotoHash = verResult.biometricPhoto
        ? btoa(verResult.biometricPhoto).substring(0, 64) // simplified hash for scaffold
        : '';

      const res = await fetch(`${API_V1_BASE}/identity/vecta-id/verify`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          chipAuthenticated: verResult.chipAuthenticated,
          passiveAuthPassed: verResult.passiveAuthPassed,
          activeAuthPassed:  verResult.activeAuthPassed,
          livenessScore:     verResult.livenessScore,
          facialMatchScore:  verResult.facialMatchScore,
          documentData:      verResult.documentData,
          biometricPhotoHash,
        }),
      });

      const data = await res.json() as { kycStatus: string; vectaIdToken?: string };

      if (data.kycStatus === 'APPROVED') {
        await fetchProfile();
        router.replace('/onboarding/banking');
      } else if (data.kycStatus === 'REVIEW') {
        Alert.alert(
          'Under Review',
          'Your identity is being reviewed by our compliance team. You will be notified within 24 hours.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)') }],
        );
      } else {
        Alert.alert('Verification Failed', data.kycStatus || 'Please try again.');
      }
    } catch (err) {
      Alert.alert('Network Error', 'Could not submit verification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [authToken, fetchProfile]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface1 }}>
      {/* Header */}
      <LinearGradient colors={['#001F3F', '#001A33']} style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Passport Verification</Text>
        <Text style={s.headerSub}>NFC chip · ICAO 9303 · Liveness check</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>

        {/* Result */}
        {result && (
          <VerificationResult result={result} onRetry={() => { setResult(null); setCurrentStep('IDLE'); }} />
        )}

        {/* Progress indicator */}
        {isRunning && (
          <View style={[s.progressCard, { backgroundColor: colors.surfaceBase, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color="#00E6CC" />
            <Text style={[s.stepLabel, { color: colors.text }]}>{stepDef.label}</Text>
            <Text style={[s.stepDesc, { color: colors.textSecondary }]}>{stepDef.description}</Text>

            <View style={[s.progressBar, { backgroundColor: colors.border }]}>
              <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>

            {/* Liveness challenge animation hint */}
            {(currentStep.startsWith('LIVENESS')) && (
              <View style={s.challengeHint}>
                <Ionicons name={stepDef.icon as 'eye'} size={48} color="#00E6CC" />
                <Text style={[s.challengeText, { color: colors.text }]}>{stepDef.description}</Text>
              </View>
            )}
          </View>
        )}

        {/* Start screen */}
        {!isRunning && !result && (
          <>
            {/* Feature list */}
            <View style={[s.featCard, { backgroundColor: colors.surfaceBase, borderColor: colors.border }]}>
              <Text style={[s.featTitle, { color: colors.text }]}>How it works</Text>
              {[
                { icon: 'scan',           text: 'Scan the bottom lines of your passport page' },
                { icon: 'wifi',           text: 'Tap your passport to the back of your phone (NFC)' },
                { icon: 'shield-checkmark', text: 'We verify the chip signature against government certificates' },
                { icon: 'eye',            text: 'Complete a 30-second liveness check' },
                { icon: 'person',         text: 'Face matched to your passport biometric photo' },
              ].map(({ icon, text }) => (
                <View key={text} style={s.featRow}>
                  <Ionicons name={icon as 'scan'} size={18} color="#00E6CC" />
                  <Text style={[s.featText, { color: colors.textSecondary }]}>{text}</Text>
                </View>
              ))}
            </View>

            {/* Privacy note */}
            <View style={[s.privacyCard, { backgroundColor: 'rgba(0,230,204,0.08)', borderColor: 'rgba(0,230,204,0.2)' }]}>
              <Ionicons name="lock-closed" size={16} color="#00E6CC" />
              <Text style={[s.privacyText, { color: colors.textSecondary }]}>
                Your passport number, date of birth, and nationality are encrypted immediately and
                never shown to landlords. Only your verified name and nationality tier are shared.
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleStart}
              style={s.startBtn}
              activeOpacity={0.85}
            >
              <Ionicons name="scan" size={20} color="#001F3F" />
              <Text style={s.startBtnText}>Start Passport Verification</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Submit spinner */}
        {submitting && (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color="#00E6CC" />
            <Text style={{ color: colors.textSecondary }}>Submitting to Vecta…</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  header:      { paddingTop: 16, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 },

  progressCard: { borderRadius: 16, padding: 24, borderWidth: 1, alignItems: 'center', gap: 12 },
  stepLabel:    { fontSize: 18, fontWeight: '700' },
  stepDesc:     { fontSize: 14, textAlign: 'center' },
  progressBar:  { width: '100%', height: 6, borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#00E6CC' },
  challengeHint:{ alignItems: 'center', gap: 8, marginTop: 8 },
  challengeText:{ fontSize: 20, fontWeight: '700', textAlign: 'center' },

  featCard:  { borderRadius: 16, padding: 20, borderWidth: 1, gap: 14 },
  featTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  featRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  featText:  { fontSize: 13, flex: 1, lineHeight: 18 },

  privacyCard: { borderRadius: 12, padding: 14, borderWidth: 1, flexDirection: 'row', gap: 10 },
  privacyText: { fontSize: 12, flex: 1, lineHeight: 17 },

  startBtn:     { backgroundColor: '#00E6CC', borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  startBtnText: { fontSize: 16, fontWeight: '700', color: '#001F3F' },
});

const res = StyleSheet.create({
  card:       { borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
  title:      { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitle:   { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  reason:     { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  checks:     { width: '100%', gap: 10, marginTop: 8 },
  checkRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkLabel: { fontSize: 14 },
  retryBtn:   { backgroundColor: '#001F3F', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32, marginTop: 8 },
  retryText:  { color: '#FFF', fontWeight: '700', fontSize: 15 },
});
