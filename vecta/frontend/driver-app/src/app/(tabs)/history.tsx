import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';

type Row = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  actual_miles: string | null;
  driver_payout_cents: number | null;
  dropoff_at: string | null;
  status: string;
};

export default function HistoryScreen() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_V1_BASE}/mobility/driver/rides/history`, { headers });
        if (res.ok) {
          const d = (await res.json()) as { rides: Row[] };
          setRows(d.rides ?? []);
        }
      } catch {
        setRows([]);
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Trip history</Text>
      <FlatList
        data={rows.filter((r) => r.status === 'COMPLETED')}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.empty}>No completed rides yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.line} numberOfLines={1}>
              {item.pickup_address}
            </Text>
            <Text style={styles.line} numberOfLines={1}>
              → {item.dropoff_address}
            </Text>
            <Text style={styles.meta}>
              {item.actual_miles != null ? `${Number(item.actual_miles).toFixed(1)} mi` : '—'} · $
              {((item.driver_payout_cents ?? 0) / 100).toFixed(2)}
            </Text>
            <Text style={styles.meta}>{item.dropoff_at ? new Date(item.dropoff_at).toLocaleString() : ''}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F', paddingTop: 56, paddingHorizontal: 20 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 16 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  line: { color: '#E2E8F0', fontSize: 15 },
  meta: { color: '#94A3B8', marginTop: 6, fontSize: 13 },
  empty: { color: '#64748B', marginTop: 24 },
});
