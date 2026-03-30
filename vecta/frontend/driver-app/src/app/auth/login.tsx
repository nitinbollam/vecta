import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { API_V1_BASE } from '../../config/api';
import { DriverFonts, DriverSpacing } from '../../constants/theme';
import { useDriverStore } from '../../stores/driver-store';

export default function DriverLoginScreen() {
  const setAuthToken = useDriverStore((s) => s.setAuthToken);
  const refreshDriver = useDriverStore((s) => s.refreshDriver);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'entry' | 'check_email'>('entry');
  const [loading, setLoading] = useState(false);

  const handleSendLink = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_V1_BASE}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error('Failed to send link');
      setStep('check_email');
    } catch {
      Alert.alert('Error', 'Could not send sign-in link. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleDevBypass = useCallback(async () => {
    if (process.env.NODE_ENV === 'production') return;
    await setAuthToken('dev-token-bypass');
    await refreshDriver();
    router.replace('/(tabs)');
  }, [setAuthToken, refreshDriver]);

  return (
    <LinearGradient colors={['#001F3F', '#001A33']} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.appName}>VECTA DRIVER</Text>
            <Text style={styles.subtitle}>Earn money driving your peers</Text>
          </View>

          {step === 'entry' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardSubtitle}>
                Enter your email to receive a sign-in link. OPT, CPT, EAD, and US citizens only.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="you@university.edu"
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={() => void handleSendLink()}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#001F3F" />
                ) : (
                  <Text style={styles.buttonText}>Send Sign-In Link</Text>
                )}
              </TouchableOpacity>

              {process.env.NODE_ENV !== 'production' ? (
                <TouchableOpacity onPress={() => void handleDevBypass()} style={styles.devButton}>
                  <Text style={styles.devText}>⚡ Dev: Skip Auth</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.compliance}>
                Only students with valid work authorization (OPT/CPT/EAD) or US citizens may drive on Vecta.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Check Your Email</Text>
              <Text style={styles.cardSubtitle}>We sent a sign-in link to {email}. Tap the link to continue.</Text>
              <TouchableOpacity onPress={() => setStep('entry')}>
                <Text style={styles.backText}>← Use a different email</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: DriverSpacing['6'] },
  header: { alignItems: 'center', marginBottom: DriverSpacing['8'] },
  appName: { fontSize: DriverFonts['3xl'], fontWeight: '900', color: '#FFFFFF', letterSpacing: 6 },
  subtitle: { fontSize: DriverFonts.sm, color: '#00E6CC', marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: DriverSpacing['6'] },
  cardTitle: { fontSize: DriverFonts.xl, fontWeight: '700', color: '#001F3F', marginBottom: 8 },
  cardSubtitle: { fontSize: DriverFonts.sm, color: '#5A7080', marginBottom: DriverSpacing['5'], lineHeight: 20 },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 14,
    fontSize: DriverFonts.base,
    color: '#001F3F',
    marginBottom: DriverSpacing['4'],
  },
  button: { backgroundColor: '#00E6CC', borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#001F3F', fontWeight: '700', fontSize: DriverFonts.base },
  devButton: { alignItems: 'center', marginTop: DriverSpacing['3'] },
  devText: { color: '#5A7080', fontSize: DriverFonts.sm },
  backText: { color: '#00E6CC', textAlign: 'center', marginTop: DriverSpacing['4'] },
  compliance: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: DriverSpacing['4'], lineHeight: 16 },
});
