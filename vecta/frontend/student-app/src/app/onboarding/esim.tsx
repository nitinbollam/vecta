/**
 * onboarding/esim.tsx — eSIM Go Activation Screen
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius } from '../../constants/theme';
import { API_V1_BASE } from '../../config/api';

const PLANS = [
  { id: '5g_unlimited', label: '5G Unlimited',  price: '$45/mo', data: 'Unlimited data',   badge: 'BEST VALUE', badgeColor: VectaColors.success },
  { id: '5g_15gb',      label: '5G 15 GB',      price: '$29/mo', data: '15 GB 5G data',   badge: null },
  { id: '4g_5gb',       label: '4G 5 GB',       price: '$15/mo', data: '5 GB LTE data',   badge: 'BUDGET' , badgeColor: VectaColors.info },
] as const;

export default function EsimScreen() {
  const { authToken } = useStudentStore();
  const [selectedPlan, setSelectedPlan] = useState<string>('5g_unlimited');
  const [state, setState] = useState<'idle' | 'activating' | 'success' | 'error'>('idle');
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);

  const handleActivate = useCallback(async () => {
    if (!authToken) return;
    setState('activating');
    try {
      const res = await fetch(`${API_V1_BASE}/housing/esim/provision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = await res.json() as { phoneNumber?: string };
      setPhoneNumber(data.phoneNumber ?? '+1 (555) 000-0000');
      setState('success');
      setTimeout(() => router.replace('/onboarding/plaid-link'), 2000);
    } catch {
      setState('error');
      Alert.alert('Activation Failed', 'Please try again or contact support@vecta.io');
    }
  }, [authToken, selectedPlan]);

  const gradient: [string, string] = ['#06B6D4', '#0284C7'];

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
              <Ionicons name="cellular" size={48} color={VectaColors.success} />
            </View>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', textAlign: 'center' }}>eSIM Activated!</Text>
            <Text style={{ fontFamily: VectaFonts.mono, fontSize: VectaFonts.xl, color: VectaColors.accent, textAlign: 'center' }}>{phoneNumber}</Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
              Your US number is live. Install via Settings → Cellular.
            </Text>
            <ActivityIndicator color="#FFF" />
          </View>
        ) : (
          <>
            <View style={{ width: 88, height: 88, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['5'] }}>
              <Ionicons name="cellular" size={44} color="#FFF" />
            </View>

            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', letterSpacing: 2, marginBottom: VectaSpacing['2'] }}>
              STEP 3 OF 5 · CONNECTIVITY
            </Text>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF', marginBottom: VectaSpacing['3'], lineHeight: 38 }}>
              Activate Your US eSIM
            </Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: 'rgba(255,255,255,0.8)', lineHeight: 24, marginBottom: VectaSpacing['6'] }}>
              Get a US phone number instantly. No store visit, no credit check. Compatible with iPhone XS+ and most modern Android devices.
            </Text>

            {/* Plan selector */}
            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)', marginBottom: VectaSpacing['3'] }}>
              SELECT A PLAN
            </Text>
            <View style={{ gap: VectaSpacing['3'], marginBottom: VectaSpacing['6'] }}>
              {PLANS.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  onPress={() => setSelectedPlan(plan.id)}
                  activeOpacity={0.85}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    padding: VectaSpacing['4'], borderRadius: VectaRadius.xl,
                    backgroundColor: selectedPlan === plan.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                    borderWidth: selectedPlan === plan.id ? 2 : 1,
                    borderColor: selectedPlan === plan.id ? '#FFF' : 'rgba(255,255,255,0.2)',
                  }}
                >
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: '#FFF' }}>{plan.label}</Text>
                      {plan.badge && (
                        <View style={{ backgroundColor: plan.badgeColor + '30', borderRadius: VectaRadius.full, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: VectaFonts.bold, fontSize: 9, color: plan.badgeColor, letterSpacing: 1 }}>{plan.badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{plan.data}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.lg, color: '#FFF' }}>{plan.price}</Text>
                    {selectedPlan === plan.id && <Ionicons name="checkmark-circle" size={20} color={VectaColors.accent} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleActivate}
              disabled={state === 'activating'}
              style={[{ backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], alignItems: 'center', marginBottom: VectaSpacing['3'] }, state === 'activating' && { opacity: 0.7 }]}
            >
              {state === 'activating' ? (
                <ActivityIndicator color="#0284C7" />
              ) : (
                <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: '#0284C7' }}>Activate eSIM</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/onboarding/plaid-link')} style={{ paddingVertical: VectaSpacing['2'], alignItems: 'center' }}>
              <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.55)' }}>
                I have a US carrier
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
