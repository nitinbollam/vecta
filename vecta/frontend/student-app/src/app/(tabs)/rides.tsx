/**
 * Rides tab — book peer rides or jump to active trip tracking.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const ACTIVE = new Set([
  'REQUESTED',
  'MATCHED',
  'DRIVER_ACCEPTED',
  'DRIVER_ARRIVING',
  'IN_PROGRESS',
]);

type RideRow = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  requested_at: string;
  actual_fare_cents: number | null;
  estimated_fare_cents: number | null;
};

type ScheduledRideRow = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_for: string;
  status: string;
  ride_type: string;
  estimated_fare_cents: number | null;
  driver_id: string | null;
};

export default function RidesScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [activeRide, setActiveRide] = useState<RideRow | null>(null);
  const [scheduledRides, setScheduledRides] = useState<ScheduledRideRow[]>([]);
  const [locError, setLocError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLocError(null);
    try {
      const headers = await getAuthHeaders();
      const mine = await fetch(`${API_V1_BASE}/mobility/rides/mine`, { headers });
      if (mine.ok) {
        const data = (await mine.json()) as { rides: RideRow[] };
        const list = data.rides ?? [];
        setRides(list);
        setActiveRide(list.find((r) => ACTIVE.has(r.status)) ?? null);
      }

      const scheduledRes = await fetch(`${API_V1_BASE}/mobility/rides/scheduled`, { headers });
      if (scheduledRes.ok) {
        const d = (await scheduledRes.json()) as { scheduled: ScheduledRideRow[] };
        setScheduledRides(d.scheduled ?? []);
      } else {
        setScheduledRides([]);
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission is needed to count nearby drivers.');
        setNearbyCount(null);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nd = await fetch(
        `${API_V1_BASE}/mobility/rides/nearby-drivers?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`,
        { headers },
      );
      if (nd.ok) {
        const d = (await nd.json()) as { drivers: unknown[] };
        setNearbyCount((d.drivers ?? []).length);
      }
    } catch {
      setNearbyCount(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const surface = isDark ? VectaColors.primaryMid : VectaColors.surfaceBase;
  const sub = isDark ? VectaDarkSubtext : VectaColors.textSecondary;

  return (
    <View style={[styles.root, { paddingTop: insets.top + VectaSpacing.md, backgroundColor: surface }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.text }]}>Get a Ride</Text>
        <Text style={[styles.sub, { color: sub }]}>Peer rides from $0.75/mile</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={VectaColors.accent} />
        ) : activeRide ? (
          <View style={[styles.card, { backgroundColor: isDark ? '#152238' : VectaColors.surface1, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Ride in progress</Text>
            <Text style={[styles.cardMeta, { color: sub }]} numberOfLines={2}>
              {activeRide.pickup_address} → {activeRide.dropoff_address}
            </Text>
            <Text style={[styles.statusPill, { color: VectaColors.accent }]}>{activeRide.status.replace(/_/g, ' ')}</Text>
            <TouchableOpacity
              style={styles.cta}
              onPress={() => router.push(`/mobility/ride-tracking?rideId=${activeRide.id}`)}
              activeOpacity={0.9}
            >
              <Text style={styles.ctaText}>Track Ride</Text>
              <Ionicons name="navigate" size={20} color={VectaColors.primary} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={[styles.compare, { backgroundColor: isDark ? '#152238' : VectaColors.successBg, borderColor: colors.border }]}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Up to 60% cheaper</Text>
              </View>
              <Text style={[styles.compareLine, { color: colors.text }]}>
                Vecta Rides: $0.75–$1.50/mile
              </Text>
              <Text style={[styles.compareMuted, { color: sub }]}>Peer drivers keep 90% of the fare.</Text>
            </View>

            <TouchableOpacity
              style={styles.bookBtn}
              onPress={() => router.push('/mobility/book-ride')}
              activeOpacity={0.92}
            >
              <Text style={styles.bookBtnText}>Book a Ride</Text>
            </TouchableOpacity>

            {scheduledRides.length > 0 ? (
              <View style={styles.scheduledSection}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>📅 Scheduled rides</Text>
                {scheduledRides.map((r) => (
                  <View
                    key={r.id}
                    style={[
                      styles.scheduledCard,
                      { borderColor: colors.border, backgroundColor: isDark ? '#152238' : VectaColors.surface1 },
                    ]}
                  >
                    <View style={styles.scheduledLeft}>
                      <Text style={[styles.scheduledTime, { color: VectaColors.accent }]}>
                        {new Date(r.scheduled_for).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      <Text style={[styles.scheduledDate, { color: sub }]}>
                        {new Date(r.scheduled_for).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={styles.scheduledMiddle}>
                      <Text style={[styles.scheduledRoute, { color: colors.text }]} numberOfLines={1}>
                        → {r.dropoff_address}
                      </Text>
                      <Text
                        style={[
                          styles.scheduledStatus,
                          { color: r.driver_id ? VectaColors.success : sub },
                        ]}
                      >
                        {r.driver_id ? '✓ Driver confirmed' : '⏳ Finding driver...'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert('Cancel scheduled ride?', '', [
                          { text: 'Keep', style: 'cancel' },
                          {
                            text: 'Cancel Ride',
                            style: 'destructive',
                            onPress: async () => {
                              const h = await getAuthHeaders();
                              await fetch(`${API_V1_BASE}/mobility/rides/${r.id}/cancel`, {
                                method: 'POST',
                                headers: h,
                                body: JSON.stringify({ reason: 'Cancelled by student' }),
                              });
                              void load();
                            },
                          },
                        ]);
                      }}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={sub} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={[styles.nearby, { color: sub }]}>
              {nearbyCount === null
                ? locError ?? 'Turn on location to see drivers near you.'
                : `${nearbyCount} driver${nearbyCount === 1 ? '' : 's'} available near you`}
            </Text>

            <Text style={[styles.sectionLabel, { color: colors.text }]}>Recent rides</Text>
            {(rides.filter((r) => !ACTIVE.has(r.status)).slice(0, 3)).length === 0 ? (
              <Text style={[styles.empty, { color: sub }]}>No recent rides yet.</Text>
            ) : (
              rides
                .filter((r) => !ACTIVE.has(r.status))
                .slice(0, 3)
                .map((r) => (
                  <View
                    key={r.id}
                    style={[styles.row, { borderColor: colors.border, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
                  >
                    <Ionicons name="car-outline" size={20} color={VectaColors.accent} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                        {r.dropoff_address}
                      </Text>
                      <Text style={[styles.rowMeta, { color: sub }]} numberOfLines={1}>
                        {new Date(r.requested_at).toLocaleDateString()} · {r.status}
                      </Text>
                    </View>
                  </View>
                ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const VectaDarkSubtext = '#7A9BAD';

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: VectaSpacing.lg, paddingBottom: 32 },
  title: { fontFamily: VectaFonts.bold, fontSize: 26 },
  sub: { fontFamily: VectaFonts.regular, fontSize: 15, marginTop: 6 },
  card: {
    marginTop: 20,
    padding: VectaSpacing.lg,
    borderRadius: VectaRadius.lg,
    borderWidth: 1,
  },
  cardTitle: { fontFamily: VectaFonts.semiBold, fontSize: 18 },
  cardMeta: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 8 },
  statusPill: { fontFamily: VectaFonts.medium, fontSize: 13, marginTop: 10 },
  cta: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: VectaColors.accent,
    paddingVertical: 14,
    borderRadius: VectaRadius.md,
  },
  ctaText: { fontFamily: VectaFonts.semiBold, fontSize: 16, color: VectaColors.primary },
  compare: {
    marginTop: 22,
    padding: VectaSpacing.lg,
    borderRadius: VectaRadius.lg,
    borderWidth: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: VectaColors.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: VectaRadius.sm,
    marginBottom: 10,
  },
  badgeText: { fontFamily: VectaFonts.semiBold, fontSize: 12, color: '#fff' },
  compareLine: { fontFamily: VectaFonts.semiBold, fontSize: 16 },
  compareMuted: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 4 },
  bookBtn: {
    marginTop: 20,
    backgroundColor: VectaColors.accent,
    paddingVertical: 16,
    borderRadius: VectaRadius.md,
    alignItems: 'center',
  },
  bookBtnText: { fontFamily: VectaFonts.bold, fontSize: 17, color: VectaColors.primary },
  scheduledSection: { marginTop: 20 },
  scheduledCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: VectaRadius.md,
    borderWidth: 1,
    marginTop: 10,
    gap: 8,
  },
  scheduledLeft: { width: 72 },
  scheduledTime: { fontFamily: VectaFonts.semiBold, fontSize: 15 },
  scheduledDate: { fontFamily: VectaFonts.regular, fontSize: 11, marginTop: 2 },
  scheduledMiddle: { flex: 1 },
  scheduledRoute: { fontFamily: VectaFonts.medium, fontSize: 14 },
  scheduledStatus: { fontFamily: VectaFonts.regular, fontSize: 12, marginTop: 4 },
  nearby: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 14, textAlign: 'center' },
  sectionLabel: { fontFamily: VectaFonts.semiBold, fontSize: 16, marginTop: 28 },
  empty: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: VectaRadius.md,
    borderWidth: 1,
    marginTop: 10,
  },
  rowTitle: { fontFamily: VectaFonts.medium, fontSize: 15 },
  rowMeta: { fontFamily: VectaFonts.regular, fontSize: 12, marginTop: 2 },
});
