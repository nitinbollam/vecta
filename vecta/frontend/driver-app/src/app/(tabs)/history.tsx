import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { DriverColors, DriverSpacing, DriverFonts } from '../../constants/theme';

type RideRow = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  actual_miles: string | number | null;
  driver_payout_cents: number | null;
  dropoff_at: string | null;
  requested_at: string | null;
  status: string;
};

export default function HistoryScreen() {
  const [rides, setRides] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchHistory();
  }, []);

  async function fetchHistory() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/rides/history`, { headers });
      const data = (await res.json()) as { rides?: RideRow[] };
      setRides((data.rides ?? []).filter((r) => r.status === 'COMPLETED'));
    } catch {
      setRides([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={DriverColors.teal} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Ride History</Text>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: DriverSpacing['5'] }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No rides yet. Go online to start earning!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const mi = item.actual_miles != null ? Number(item.actual_miles) : NaN;
          const milesLabel = Number.isFinite(mi) ? `${mi.toFixed(1)} miles` : '– miles';
          return (
            <View style={styles.rideCard}>
              <View style={styles.rideRow}>
                <Text style={styles.rideDate}>
                  {new Date(item.dropoff_at ?? item.requested_at ?? Date.now()).toLocaleDateString()}
                </Text>
                <Text style={styles.ridePayout}>+${((item.driver_payout_cents ?? 0) / 100).toFixed(2)}</Text>
              </View>
              <Text style={styles.rideRoute} numberOfLines={1}>
                {item.pickup_address} → {item.dropoff_address}
              </Text>
              <Text style={styles.rideMiles}>{milesLabel}</Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0F1E' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0F1E' },
  header: { fontSize: DriverFonts['2xl'], fontWeight: '700', color: '#FFFFFF', padding: DriverSpacing['5'], paddingBottom: 0 },
  empty: { alignItems: 'center', marginTop: 64 },
  emptyText: { color: '#5A7080', fontSize: DriverFonts.base },
  rideCard: { backgroundColor: '#0F1628', borderRadius: 12, padding: DriverSpacing['4'], marginBottom: DriverSpacing['3'] },
  rideRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rideDate: { fontSize: DriverFonts.sm, color: '#A8B8C8' },
  ridePayout: { fontSize: DriverFonts.base, fontWeight: '700', color: DriverColors.teal },
  rideRoute: { fontSize: DriverFonts.sm, color: '#FFFFFF', marginBottom: 4 },
  rideMiles: { fontSize: DriverFonts.xs, color: '#5A7080' },
});
