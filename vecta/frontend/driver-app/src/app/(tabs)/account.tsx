import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { DriverColors, DriverSpacing, DriverFonts } from '../../constants/theme';
import { useDriverStore } from '../../stores/driver-store';

export default function AccountScreen() {
  const [driver, setDriver] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/status`, { headers });
      const data = (await res.json()) as Record<string, unknown>;
      setDriver(data);
    } catch {
      setDriver(null);
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await useDriverStore.getState().setAuthToken(null);
          useDriverStore.getState().setDriver(null);
          await AsyncStorage.multiRemove(['driver_auth_token', 'driver_student_id', 'driver_id']);
          router.replace('/auth/login');
        },
      },
    ]);
  }

  const workAuthExpiry = driver?.work_auth_expiry ? new Date(String(driver.work_auth_expiry)) : null;
  const daysUntilExpiry = workAuthExpiry
    ? Math.floor((workAuthExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const status = String(driver?.status ?? '');
  const rating = driver?.rating != null ? String(driver.rating) : '5.0';
  const totalRides = typeof driver?.total_rides === 'number' ? driver.total_rides : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Account</Text>

        <View style={styles.statusCard}>
          <View style={[styles.badge, { backgroundColor: status === 'APPROVED' ? '#00C896' : '#F59E0B' }]}>
            <Text style={styles.badgeText}>
              {status === 'APPROVED' ? '✓ APPROVED DRIVER' : '⏳ PENDING REVIEW'}
            </Text>
          </View>
          <Text style={styles.rating}>⭐ {rating} rating</Text>
          <Text style={styles.rideCount}>{totalRides} total rides</Text>
        </View>

        {daysUntilExpiry !== null && daysUntilExpiry <= 30 ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              ⚠️ Work authorization expires in {daysUntilExpiry} days. Update your documents to continue driving.
            </Text>
          </View>
        ) : null}

        {status === 'APPROVED' && driver?.tnc_policy_status === 'ACTIVE' ? (
          <View style={[styles.infoCard, { borderColor: '#00C896', borderWidth: 1 }]}>
            <Text style={styles.infoTitle}>🛡️ Vecta Commercial Coverage — ACTIVE</Text>
            <Text style={styles.infoValue}>
              Policy: {String(driver.tnc_policy_number ?? '—')} · $1,000,000 liability
            </Text>
            <Text style={styles.infoSub}>Coverage activates when you accept a ride</Text>
          </View>
        ) : status === 'APPROVED' ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>🛡️ TNC coverage</Text>
            <Text style={styles.infoSub}>
              {String(driver?.tnc_policy_status ?? 'PENDING')} — Vecta MGA commercial policy for rides
            </Text>
          </View>
        ) : null}

        {driver?.vehicle_make ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Your Vehicle</Text>
            <Text style={styles.infoValue}>
              {String(driver.vehicle_year ?? '')} {String(driver.vehicle_make)} {String(driver.vehicle_model ?? '')}
            </Text>
            <Text style={styles.infoSub}>
              {String(driver.vehicle_color ?? '')} · {String(driver.vehicle_plate ?? '')}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.linkRow} onPress={() => void Linking.openURL('mailto:drivers@vecta.io')}>
          <Text style={styles.linkText}>Contact Driver Support →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkRow} onPress={() => void Linking.openURL('https://vecta.io/drivers/faq')}>
          <Text style={styles.linkText}>Driver FAQ →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0F1E' },
  scroll: { padding: DriverSpacing['5'] },
  header: { fontSize: DriverFonts['2xl'], fontWeight: '700', color: '#FFFFFF', marginBottom: DriverSpacing['6'] },
  statusCard: { backgroundColor: '#0F1628', borderRadius: 16, padding: DriverSpacing['5'], alignItems: 'center', marginBottom: DriverSpacing['4'] },
  badge: { borderRadius: 20, paddingVertical: 6, paddingHorizontal: 16, marginBottom: DriverSpacing['3'] },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: DriverFonts.sm },
  rating: { fontSize: DriverFonts.xl, color: '#FFFFFF', fontWeight: '700' },
  rideCount: { fontSize: DriverFonts.sm, color: '#A8B8C8', marginTop: 4 },
  warningCard: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: DriverSpacing['4'], marginBottom: DriverSpacing['4'] },
  warningText: { color: '#92400E', fontSize: DriverFonts.sm, lineHeight: 20 },
  infoCard: { backgroundColor: '#0F1628', borderRadius: 12, padding: DriverSpacing['4'], marginBottom: DriverSpacing['4'] },
  infoTitle: { fontSize: DriverFonts.sm, color: '#5A7080', marginBottom: 4 },
  infoValue: { fontSize: DriverFonts.base, color: '#FFFFFF', fontWeight: '600' },
  infoSub: { fontSize: DriverFonts.sm, color: '#A8B8C8', marginTop: 2 },
  linkRow: { paddingVertical: DriverSpacing['4'], borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  linkText: { fontSize: DriverFonts.base, color: DriverColors.teal },
  signOutButton: {
    marginTop: DriverSpacing['8'],
    backgroundColor: '#1E2D45',
    borderRadius: 12,
    padding: DriverSpacing['4'],
    alignItems: 'center',
  },
  signOutText: { color: '#EF4444', fontWeight: '600', fontSize: DriverFonts.base },
});
