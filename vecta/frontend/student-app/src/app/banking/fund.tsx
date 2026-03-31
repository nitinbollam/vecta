/**
 * Vecta Connect — fund ledger balance by region.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const USD_INR = 83.5;

export default function FundAccountScreen() {
  const { method } = useLocalSearchParams<{ method: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');
  const [bic, setBic] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (method === 'us') {
      router.replace('/onboarding/plaid-link');
    }
  }, [method]);

  const usd = Number.parseFloat(amount) || 0;
  const cents = Math.round(usd * 100);
  const inrHint = useMemo(() => (usd > 0 ? (usd * USD_INR).toFixed(0) : '—'), [usd]);

  const sub = isDark ? '#7A9BAD' : VectaColors.textSecondary;
  const surface = isDark ? VectaColors.primaryMid : VectaColors.surfaceBase;

  async function postIndia() {
    if (!upiId.trim() || cents < 100) {
      Alert.alert('Check inputs', 'Enter a valid UPI ID and amount (min $1).');
      return;
    }
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/banking/fund/india`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountCents: cents, upiId: upiId.trim(), vpaName: 'Vecta' }),
      });
      const data = (await res.json()) as { deeplink?: string; transactionId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      Alert.alert('Payment request sent', 'Funds appear in ~2 minutes after you approve in your UPI app.', [
        {
          text: 'Open UPI App',
          onPress: () => {
            if (data.deeplink) void Linking.openURL(data.deeplink);
          },
        },
        { text: 'OK' },
      ]);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function postUk() {
    if (cents < 100 || !sortCode.trim() || !accountNumber.trim()) {
      Alert.alert('Check inputs', 'Amount (min $1), sort code, and account number are required.');
      return;
    }
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/banking/fund/uk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountCents: cents, sortCode: sortCode.trim(), accountNumber: accountNumber.trim() }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (data.redirectUrl) void Linking.openURL(data.redirectUrl);
      Alert.alert('UK transfer', 'Complete approval at your bank. Funds arrive via Faster Payments in under 2 hours.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function postEu() {
    if (cents < 100 || !iban.trim() || !bic.trim()) {
      Alert.alert('Check inputs', 'Amount (min $1), IBAN, and BIC are required.');
      return;
    }
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/banking/fund/eu`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountCents: cents, iban: iban.trim(), bic: bic.trim() }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (data.redirectUrl) void Linking.openURL(data.redirectUrl);
      Alert.alert('SEPA', 'Complete approval at your bank. Funds arrive within 1 business day.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (method === 'us') {
    return (
      <View style={[styles.center, { backgroundColor: surface, paddingTop: insets.top }]}>
        <ActivityIndicator color={VectaColors.accent} />
        <Text style={{ color: sub, marginTop: 12 }}>Opening Vecta Connect (US)…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: surface, paddingTop: insets.top }}
      contentContainerStyle={{ padding: VectaSpacing.lg, paddingBottom: 40 }}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        {method === 'india' && '🇮🇳 Fund via UPI'}
        {method === 'uk' && '🇬🇧 UK Faster Payments'}
        {method === 'eu' && '🇪🇺 SEPA transfer'}
      </Text>
      <Text style={[styles.note, { color: sub }]}>
        Money moves through Vecta Connect; your Vecta Ledger is credited when the transfer settles.
      </Text>

      <Text style={[styles.label, { color: sub }]}>Amount (USD)</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
        placeholder="25.00"
        placeholderTextColor={sub}
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
      />
      {method === 'india' ? (
        <Text style={[styles.hint, { color: sub }]}>≈ ₹{inrHint} (indicative)</Text>
      ) : null}

      {method === 'india' ? (
        <>
          <Text style={[styles.label, { color: sub }]}>Your UPI ID</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
            placeholder="name@upi"
            placeholderTextColor={sub}
            autoCapitalize="none"
            value={upiId}
            onChangeText={setUpiId}
          />
          <TouchableOpacity style={styles.btn} onPress={() => void postIndia()} disabled={loading}>
            {loading ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.btnText}>Request payment</Text>}
          </TouchableOpacity>
        </>
      ) : null}

      {method === 'uk' ? (
        <>
          <Text style={[styles.label, { color: sub }]}>Sort code</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
            placeholder="12-34-56"
            placeholderTextColor={sub}
            value={sortCode}
            onChangeText={setSortCode}
          />
          <Text style={[styles.label, { color: sub }]}>Account number</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
            placeholder="Account number"
            placeholderTextColor={sub}
            keyboardType="number-pad"
            value={accountNumber}
            onChangeText={setAccountNumber}
          />
          <TouchableOpacity style={styles.btn} onPress={() => void postUk()} disabled={loading}>
            {loading ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.btnText}>Initiate transfer</Text>}
          </TouchableOpacity>
        </>
      ) : null}

      {method === 'eu' ? (
        <>
          <Text style={[styles.label, { color: sub }]}>IBAN</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
            placeholder="IBAN"
            placeholderTextColor={sub}
            autoCapitalize="characters"
            value={iban}
            onChangeText={setIban}
          />
          <Text style={[styles.label, { color: sub }]}>BIC</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
            placeholder="BIC"
            placeholderTextColor={sub}
            autoCapitalize="characters"
            value={bic}
            onChangeText={setBic}
          />
          <TouchableOpacity style={styles.btn} onPress={() => void postEu()} disabled={loading}>
            {loading ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.btnText}>Initiate transfer</Text>}
          </TouchableOpacity>
        </>
      ) : null}

      <TouchableOpacity style={{ marginTop: 24 }} onPress={() => router.back()}>
        <Text style={{ color: VectaColors.accent, fontFamily: VectaFonts.semiBold }}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: VectaFonts.bold, fontSize: 22, marginBottom: 8 },
  note: { fontFamily: VectaFonts.regular, fontSize: 13, marginBottom: 20, lineHeight: 20 },
  label: { fontFamily: VectaFonts.medium, fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: VectaRadius.md,
    padding: 14,
    fontSize: 16,
  },
  hint: { fontSize: 12, marginTop: 4 },
  btn: {
    marginTop: 24,
    backgroundColor: '#00E6CC',
    borderRadius: VectaRadius.lg,
    padding: 16,
    alignItems: 'center',
  },
  btnText: { color: '#001F3F', fontFamily: VectaFonts.bold, fontSize: 16 },
});
