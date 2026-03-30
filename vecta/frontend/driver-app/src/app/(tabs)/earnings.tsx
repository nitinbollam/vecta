import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';

export default function EarningsScreen() {
  const [data, setData] = useState<{
    total_earnings_cents?: number;
    total_rides?: number;
    avg_miles?: string;
    total_miles?: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_V1_BASE}/mobility/driver/earnings`, { headers });
        if (res.ok) setData(await res.json());
      } catch {
        setData({});
      }
    })();
  }, []);

  const ytd = (data?.total_earnings_cents ?? 0) / 100;
  const rides = data?.total_rides ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Earnings</Text>
      <Text style={styles.big}>${ytd.toFixed(2)}</Text>
      <Text style={styles.sub}>This year · {rides} completed rides</Text>
      <View style={styles.card}>
        <Text style={styles.row}>Avg miles / ride: {data?.avg_miles ?? '0'}</Text>
        <Text style={styles.row}>Total miles: {data?.total_miles ?? '0'}</Text>
      </View>
      <Text style={styles.note}>
        Your earnings are taxable. Vecta will issue tax documents by January 31st. Transfer to bank uses the Vecta
        ledger (ACH) from the student banking product when linked.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 56, backgroundColor: '#001F3F', flexGrow: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  big: { color: '#00E6CC', fontSize: 40, fontWeight: '900', marginTop: 16 },
  sub: { color: '#9CB4C8', marginTop: 8 },
  card: {
    marginTop: 28,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 20,
  },
  row: { color: '#E2E8F0', marginBottom: 8, fontSize: 15 },
  note: { color: '#64748B', marginTop: 24, lineHeight: 20, fontSize: 13 },
});
