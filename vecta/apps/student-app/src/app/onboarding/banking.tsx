/**
 * onboarding/banking.tsx — Unit.co Banking Provisioning Screen
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients } from '../../constants/theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const BANKING_FEATURES = [
  { icon: 'card',           text: 'Real US debit card — Visa network' },
  { icon: 'wallet',         text: 'US routing + account number' },
  { icon: 'globe',          text: 'International transfers supported' },
  { icon: 'shield',         text: 'FDIC insured up to $250,000' },
  { icon: 'document-text',  text: 'No SSN required — passport accepted' },
  { icon: 'flash',          text: 'Instant approval for Vecta-verified students' },
] as const;

export default function BankingOnboardingScreen() {
  const { profile, authToken, fetchProfile } = useStudentStore();
  const [state, setState] = useState<'idle' | 'provisioning' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (profile?.kycStatus === 'APPROVED') setState('success');
  }, [profile?.kycStatus]);

  const handleProvision = useCallback(async () => {
    if (!authToken) return;
    setState('provisioning');
    try {
      const res = await fetch(`${API_BASE}/identity/banking/provision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error('Provisioning failed');
      await fetchProfile();
      setState('success');
      setTimeout(() => router.replace('/onboarding/esim'), 1800);
    } catch {
      setState('error');
    }
  }, [authToken, fetchProfile]);

  return (
    <LinearGradient colors={VectaGradients.banking} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: VectaSpacing['6'], paddingTop: 72 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['6'] }}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {state === 'success' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: VectaSpacing['4'] }}>
            <View style={{ width: 100, height: 100, borderRadius: VectaRadius.full, backgroundColor: VectaColors.successBg, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="checkmark-circle" size={56} color={VectaColors.success} />
            </View>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', textAlign: 'center' }}>
              Account Opening!
            </Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
              Unit.co is verifying your identity. Your debit card will arrive in 5–7 business days.
            </Text>
            <ActivityIndicator color="#FFF" />
          </View>
        ) : (
          <>
            <View style={{ width: 88, height: 88, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['5'] }}>
              <Ionicons name="card" size={44} color="#FFF" />
            </View>

            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', letterSpacing: 2, marginBottom: VectaSpacing['2'] }}>
              STEP 2 OF 5 · BANKING
            </Text>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF', marginBottom: VectaSpacing['3'], lineHeight: 38 }}>
              Open Your US Bank Account
            </Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: 'rgba(255,255,255,0.8)', lineHeight: 24, marginBottom: VectaSpacing['6'] }}>
              Get a real US DDA account powered by Unit.co — no SSN, no credit history required.
            </Text>

            <View style={{ gap: VectaSpacing['3'], marginBottom: VectaSpacing['6'] }}>
              {BANKING_FEATURES.map(({ icon, text }) => (
                <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'] }}>
                  <View style={{ width: 32, height: 32, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={icon} size={16} color="rgba(255,255,255,0.9)" />
                  </View>
                  <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.85)', flex: 1 }}>{text}</Text>
                </View>
              ))}
            </View>

            {state === 'error' && (
              <View style={{ backgroundColor: VectaColors.errorBg, borderRadius: VectaRadius.md, padding: VectaSpacing['3'], marginBottom: VectaSpacing['4'] }}>
                <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.error }}>
                  Provisioning failed. Please ensure your identity verification is complete and try again.
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleProvision}
              disabled={state === 'provisioning'}
              style={[{ backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], alignItems: 'center', marginBottom: VectaSpacing['3'] }, state === 'provisioning' && { opacity: 0.7 }]}
            >
              {state === 'provisioning' ? (
                <ActivityIndicator color={VectaColors.banking} />
              ) : (
                <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.banking }}>
                  Open Bank Account
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/onboarding/esim')} style={{ paddingVertical: VectaSpacing['2'], alignItems: 'center' }}>
              <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.55)' }}>
                I already have a US account
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
