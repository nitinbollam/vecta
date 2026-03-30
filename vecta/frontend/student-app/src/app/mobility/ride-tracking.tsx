/**
 * Live ride tracking — REST poll + WebSocket for driver location and status.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_V1_BASE, getAuthHeaders, getWsBase, MAPBOX_TOKEN } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type RideRow = Record<string, unknown> & {
  id: string;
  status: string;
  pickup_lat: string;
  pickup_lng: string;
  dropoff_lat: string;
  dropoff_lng: string;
  pickup_address: string;
  dropoff_address: string;
  driver_name: string | null;
  driver_profile_rating: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
};

export default function RideTrackingScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [ride, setRide] = useState<RideRow | null>(null);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchRide = useCallback(async () => {
    if (!rideId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/rides/${rideId}`, { headers });
      if (!res.ok) throw new Error('Ride not found');
      const data = (await res.json()) as RideRow;
      setRide(data);
      if (data.status === 'COMPLETED') {
        router.replace(`/mobility/ride-complete?rideId=${rideId}`);
      }
    } catch {
      setErr('Could not load ride.');
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    void fetchRide();
    const id = setInterval(() => void fetchRide(), 8000);
    return () => clearInterval(id);
  }, [fetchRide]);

  useEffect(() => {
    if (!rideId) return;
    const base = getWsBase().replace(/\/$/, '');
    const url = `${base}/ws/ride/${rideId}?role=rider`;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; lat?: number; lng?: number; status?: string };
          if (msg.type === 'DRIVER_LOCATION' && msg.lat != null && msg.lng != null) {
            setDriverLoc({ lat: msg.lat, lng: msg.lng });
          }
          if (msg.type === 'RIDE_STATUS' && msg.status) {
            void fetchRide();
          }
        } catch {
          /* ignore */
        }
      };
      return () => {
        ws.close();
        wsRef.current = null;
      };
    } catch {
      return undefined;
    }
  }, [rideId, fetchRide]);

  const staticMapUrl = useMemo(() => {
    if (!MAPBOX_TOKEN || !ride) return null;
    const plng = Number(ride.pickup_lng);
    const plat = Number(ride.pickup_lat);
    const dlng = Number(ride.dropoff_lng);
    const dlat = Number(ride.dropoff_lat);
    const pins = [`pin-s+00e6cc(${plng},${plat})`, `pin-s+ef4444(${dlng},${dlat})`];
    if (driverLoc) {
      pins.push(`pin-s+10b981(${driverLoc.lng},${driverLoc.lat})`);
    }
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins.join(',')}/auto/600x420@2x?access_token=${MAPBOX_TOKEN}`;
  }, [ride, driverLoc]);

  const statusLine = useMemo(() => {
    if (!ride) return '';
    switch (ride.status) {
      case 'REQUESTED':
        return 'Finding a driver…';
      case 'MATCHED':
      case 'DRIVER_ACCEPTED':
        return 'Driver is on the way';
      case 'DRIVER_ARRIVING':
        return 'Driver has arrived · Head outside';
      case 'IN_PROGRESS':
        return 'Ride in progress';
      default:
        return ride.status.replace(/_/g, ' ');
    }
  }, [ride]);

  const cancelRide = useCallback(async () => {
    if (!rideId) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_V1_BASE}/mobility/rides/${rideId}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Cancelled by rider' }),
      });
      router.replace('/(tabs)/rides');
    } catch {
      setErr('Cancel failed');
    }
  }, [rideId]);

  const surface = isDark ? VectaColors.primaryMid : VectaColors.surfaceBase;
  const sub = isDark ? '#7A9BAD' : VectaColors.textSecondary;

  if (loading && !ride) {
    return (
      <View style={[styles.center, { backgroundColor: surface, paddingTop: insets.top }]}>
        <ActivityIndicator color={VectaColors.accent} size="large" />
      </View>
    );
  }

  if (err || !ride) {
    return (
      <View style={[styles.center, { backgroundColor: surface, paddingTop: insets.top }]}>
        <Text style={{ color: VectaColors.error, fontFamily: VectaFonts.regular }}>{err ?? 'Missing ride'}</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: VectaColors.accent }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const canCancel = ride.status === 'MATCHED' || ride.status === 'DRIVER_ACCEPTED';

  return (
    <View style={{ flex: 1, backgroundColor: surface, paddingTop: insets.top }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.text }]}>Track ride</Text>
        <View style={{ width: 28 }} />
      </View>

      {staticMapUrl ? (
        <Image source={{ uri: staticMapUrl }} style={styles.map} resizeMode="cover" />
      ) : (
        <View style={[styles.mapFallback, { backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}>
          <Text style={{ color: sub, fontFamily: VectaFonts.regular }}>Add Mapbox token for map preview</Text>
        </View>
      )}

      <View style={[styles.sheet, { backgroundColor: isDark ? '#0F1628' : VectaColors.surfaceBase, borderColor: colors.border }]}>
        <Text style={[styles.status, { color: VectaColors.accent }]}>{statusLine}</Text>
        {ride.driver_name ? (
          <>
            <Text style={[styles.driver, { color: colors.text }]}>
              {ride.driver_name}
              {ride.driver_profile_rating ? ` · ★ ${Number(ride.driver_profile_rating).toFixed(1)}` : ''}
            </Text>
            <Text style={[styles.vehicle, { color: sub }]}>
              {[ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(' ')}
              {ride.vehicle_plate ? ` · ${ride.vehicle_plate}` : ''}
            </Text>
          </>
        ) : (
          <Text style={[styles.vehicle, { color: sub }]}>Matching you with a nearby driver…</Text>
        )}

        {canCancel ? (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => void cancelRide()}>
            <Text style={styles.cancelText}>Cancel Ride</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: VectaSpacing.md,
    paddingVertical: VectaSpacing.sm,
  },
  topTitle: { fontFamily: VectaFonts.semiBold, fontSize: 18 },
  map: { width: '100%', height: '52%' },
  mapFallback: { width: '100%', height: '52%', justifyContent: 'center', alignItems: 'center' },
  sheet: {
    flex: 1,
    borderTopLeftRadius: VectaRadius.lg,
    borderTopRightRadius: VectaRadius.lg,
    marginTop: -16,
    padding: VectaSpacing.lg,
    borderWidth: 1,
  },
  status: { fontFamily: VectaFonts.semiBold, fontSize: 16 },
  driver: { fontFamily: VectaFonts.medium, fontSize: 18, marginTop: 12 },
  vehicle: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 6 },
  cancelBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: VectaRadius.md,
    borderWidth: 1,
    borderColor: VectaColors.error,
    alignItems: 'center',
  },
  cancelText: { fontFamily: VectaFonts.semiBold, color: VectaColors.error, fontSize: 16 },
});
