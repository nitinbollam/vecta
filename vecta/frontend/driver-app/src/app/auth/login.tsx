import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { API_V1_BASE } from '../../config/api';
import { useDriverStore } from '../../stores/driver-store';

const NAVY = ['#001F3F', '#001A33'] as const;
const TEAL = '#00E6CC';

export default function DriverLogin() {
  const setAuthToken = useDriverStore((s) => s.setAuthToken);
  const refreshDriver = useDriverStore((s) => s.refreshDriver);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendLink = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_V1_BASE}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? 'Failed');
      }
      setError('Check your email for the sign-in link.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [email]);

  /** Dev-only: paste a JWT from the student flow if magic link completes in browser. */
  const useToken = useCallback(async () => {
    if (process.env.NODE_ENV === 'production') return;
    const token = email.startsWith('eyJ') ? email.trim() : '';
    if (!token) {
      setError('Paste JWT as email field for dev bypass.');
      return;
    }
    await setAuthToken(token);
    await refreshDriver();
    router.replace('/(tabs)');
  }, [email, setAuthToken, refreshDriver]);

  return (
    <LinearGradient colors={NAVY} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.box}
      >
        <Text style={styles.title}>Vecta Driver</Text>
        <Text style={styles.sub}>Authorized drivers (OPT / CPT / EAD / US)</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#7A9BAD"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <TouchableOpacity style={styles.btn} onPress={() => void sendLink()} disabled={loading}>
          {loading ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.btnText}>Send magic link</Text>}
        </TouchableOpacity>
        {process.env.NODE_ENV !== 'production' ? (
          <TouchableOpacity style={[styles.btn, { marginTop: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: TEAL }]} onPress={() => void useToken()}>
            <Text style={[styles.btnText, { color: TEAL }]}>Dev: use pasted JWT</Text>
          </TouchableOpacity>
        ) : null}
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', marginBottom: 8 },
  sub: { fontSize: 15, color: '#9CB4C8', marginBottom: 28 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  err: { color: '#FCA5A5', marginBottom: 8, fontSize: 14 },
  btn: {
    backgroundColor: TEAL,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { fontSize: 17, fontWeight: '700', color: '#001F3F' },
});
