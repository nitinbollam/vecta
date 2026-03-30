import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { DriverColors, DriverSpacing, DriverFonts } from '../../constants/theme';

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState<{
    total_earnings_cents?: number;
    total_rides?: number;
    total_miles?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchEarnings();
  }, []);

  async function fetchEarnings() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/earnings`, { headers });
      const data = (await res.json()) as typeof earnings;
      setEarnings(data);
    } catch {
      setEarnings({});
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={DriverColors.teal} size="large" />
      </View>
    );
  }

  const total = (earnings?.total_earnings_cents ?? 0) / 100;
  const rides = earnings?.total_rides ?? 0;
  const miles = Number.parseFloat(earnings?.total_miles ?? '0');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Earnings</Text>

        <View style={styles.row}>
          <View style={styles.card}>
            <Text style={styles.cardValue}>${total.toFixed(2)}</Text>
            <Text style={styles.cardLabel}>This Year</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{rides}</Text>
            <Text style={styles.cardLabel}>Total Rides</Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{Number.isFinite(miles) ? miles.toFixed(0) : '0'}</Text>
            <Text style={styles.cardLabel}>Total Miles</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardValue}>${rides > 0 ? (total / rides).toFixed(2) : '0.00'}</Text>
            <Text style={styles.cardLabel}>Avg Per Ride</Text>
          </View>
        </View>

        <View style={styles.taxCard}>
          <Text style={styles.taxTitle}>📋 Tax Information</Text>
          <Text style={styles.taxBody}>
            Your earnings are reportable income. Vecta will issue tax documents by January 31st. Keep track of your
            mileage for deductions.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0F1E' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0F1E' },
  scroll: { padding: DriverSpacing['5'] },
  header: { fontSize: DriverFonts['2xl'], fontWeight: '700', color: '#FFFFFF', marginBottom: DriverSpacing['6'] },
  row: { flexDirection: 'row', gap: DriverSpacing['3'], marginBottom: DriverSpacing['3'] },
  card: { flex: 1, backgroundColor: '#0F1628', borderRadius: 16, padding: DriverSpacing['5'], alignItems: 'center' },
  cardValue: { fontSize: DriverFonts['2xl'], fontWeight: '800', color: DriverColors.teal, marginBottom: 4 },
  cardLabel: { fontSize: DriverFonts.sm, color: '#A8B8C8' },
  taxCard: { backgroundColor: '#0F1628', borderRadius: 16, padding: DriverSpacing['5'], marginTop: DriverSpacing['3'] },
  taxTitle: { fontSize: DriverFonts.base, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  taxBody: { fontSize: DriverFonts.sm, color: '#A8B8C8', lineHeight: 20 },
});
