/**
 * onboarding/plaid-link.tsx — Plaid Bank Connection Screen
 *
 * Connects home-country or US bank account via Plaid to generate
 * the solvency proof needed for the Letter of Credit.
 *
 * Privacy guarantee always visible:
 *   - Exact balance NEVER shown to landlords
 *   - Only a guarantee statement is generated
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore, useHousingStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius,
  VectaGradients,
} from '../../constants/theme';
import { API_V1_BASE } from '../../config/api';

const SUPPORTED_BANKS = [
  'Chase', 'Bank of America', 'Wells Fargo', 'Citibank',
  'HDFC Bank', 'ICICI Bank', 'SBI', 'Barclays', 'HSBC',
  'Deutsche Bank', 'BNP Paribas', '+12,000 more worldwide',
];

const PRIVACY_POINTS = [
  'Your exact balance is NEVER shown to landlords',
  'Landlords only see a signed guarantee statement',
  'Bank account numbers are encrypted and never stored in plain text',
  'You can revoke access at any time',
] as const;

export default function PlaidLinkScreen() {
  const { authToken } = useStudentStore();
  const { fetchTrustScore } = useHousingStore();
  const [state, setState] = useState<'idle' | 'loading' | 'linking' | 'success' | 'error'>('idle');

  const handleConnectBank = useCallback(async () => {
    if (!authToken) return;
    setState('loading');

    try {
      // 1. Get Plaid link token
      const tokenRes = await fetch(`${API_V1_BASE}/housing/plaid/link-token`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const { linkToken } = await tokenRes.json() as { linkToken: string };

      setState('linking');

      // In production: open Plaid Link SDK with linkToken
      // PlaidLink.open({ token: linkToken, onSuccess: handlePlaidSuccess })
      // For demo: simulate success after 2 seconds
      setTimeout(async () => {
        // Simulate exchange
        await fetch(`${API_V1_BASE}/housing/plaid/exchange`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken: 'demo_public_token' }),
        });

        await fetchTrustScore();
        setState('success');
        setTimeout(() => router.replace('/onboarding'), 2000);
      }, 2000);
    } catch {
      setState('error');
      Alert.alert('Connection Failed', 'Could not connect to Plaid. Please try again.');
    }
  }, [authToken, fetchTrustScore]);

  const gradient = VectaGradients.housing;

  return (
    <LinearGradient colors={gradient} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: VectaSpacing['6'], paddingTop: 72 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['6'] }}
        >
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {state === 'success' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: VectaSpacing['4'] }}>
            <View style={{ width: 100, height: 100, borderRadius: VectaRadius.full, backgroundColor: VectaColors.successBg, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="home" size={48} color={VectaColors.success} />
            </View>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', textAlign: 'center' }}>
              Bank Connected!
            </Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
              Your solvency has been verified. You can now generate a Letter of Credit for any landlord.
            </Text>
            <ActivityIndicator color="#FFF" />
          </View>
        ) : (
          <>
            <View style={{ width: 88, height: 88, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['5'] }}>
              <Ionicons name="link" size={44} color="#FFF" />
            </View>

            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', letterSpacing: 2, marginBottom: VectaSpacing['2'] }}>
              STEP 4 OF 5 · HOUSING GUARANTEE
            </Text>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF', marginBottom: VectaSpacing['3'], lineHeight: 38 }}>
              Connect Your Bank
            </Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: 'rgba(255,255,255,0.8)', lineHeight: 24, marginBottom: VectaSpacing['4'] }}>
              Link your bank account to generate a verified Letter of Credit. Landlords accept this instead of a co-signer.
            </Text>

            {/* Privacy guarantee */}
            <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['5'], borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: VectaSpacing['3'] }}>
                <Ionicons name="lock-closed" size={16} color={VectaColors.accent} />
                <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' }}>
                  Privacy Guarantee
                </Text>
              </View>
              {PRIVACY_POINTS.map((point) => (
                <View key={point} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <Ionicons name="checkmark-circle" size={14} color={VectaColors.success} style={{ marginTop: 1 }} />
                  <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.8)', flex: 1, lineHeight: 18 }}>{point}</Text>
                </View>
              ))}
            </View>

            {/* Supported banks */}
            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginBottom: VectaSpacing['3'] }}>
              SUPPORTED WORLDWIDE
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: VectaSpacing['2'], marginBottom: VectaSpacing['6'] }}>
              {SUPPORTED_BANKS.map((bank) => (
                <View key={bank} style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: VectaRadius.full, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.8)' }}>{bank}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <TouchableOpacity
              onPress={handleConnectBank}
              disabled={state === 'loading' || state === 'linking'}
              style={[{ backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], alignItems: 'center', marginBottom: VectaSpacing['3'] }, (state === 'loading' || state === 'linking') && { opacity: 0.7 }]}
            >
              {state === 'loading' || state === 'linking' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={VectaColors.housing} size="small" />
                  <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.housing }}>
                    {state === 'loading' ? 'Preparing…' : 'Opening Plaid…'}
                  </Text>
                </View>
              ) : (
                <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.housing }}>
                  Connect Bank with Plaid
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.replace('/(tabs)')}
              style={{ paddingVertical: VectaSpacing['2'], alignItems: 'center' }}
            >
              <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.55)' }}>
                I'll do this later
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
