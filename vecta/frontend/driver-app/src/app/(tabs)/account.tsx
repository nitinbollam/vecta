import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useDriverStore } from '../../stores/driver-store';

export default function AccountScreen() {
  const driver = useDriverStore((s) => s.driver);
  const setAuthToken = useDriverStore((s) => s.setAuthToken);
  const setDriver = useDriverStore((s) => s.setDriver);

  const signOut = async () => {
    await setAuthToken(null);
    setDriver(null);
    router.replace('/auth/login');
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.badge}>Status: {String(driver?.status ?? '—')}</Text>
        <Text style={styles.row}>Vehicle: {[driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ')}</Text>
        <Text style={styles.row}>Plate: {String(driver?.vehicle_plate ?? '—')}</Text>
        <Text style={styles.row}>Rating: ★ {String(driver?.rating ?? '5.0')}</Text>
      </View>
      <Text style={styles.warn}>
        Renew work authorization, license, and insurance before expiry. Updates can be added via support until in-app
        document refresh ships.
      </Text>
      <TouchableOpacity style={styles.out} onPress={() => void signOut()}>
        <Text style={styles.outText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F', paddingTop: 56, paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 20 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 20,
  },
  badge: { color: '#00C896', fontWeight: '700', marginBottom: 12 },
  row: { color: '#E2E8F0', marginBottom: 8 },
  warn: { color: '#94A3B8', marginTop: 20, lineHeight: 20 },
  out: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  outText: { color: '#FCA5A5', fontWeight: '700' },
});
