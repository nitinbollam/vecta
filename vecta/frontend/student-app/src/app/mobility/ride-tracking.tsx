/**
 * Live ride tracking — REST poll + WebSocket + Mapbox GL.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapboxMap from '../../components/MapboxMap';
import { API_V1_BASE, getAuthHeaders, getWsBase, MAPBOX_TOKEN } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type RideRow = Record<string, unknown> & {
  id: string;
  status: string;
  pickup_lat: string | number;
  pickup_lng: string | number;
  dropoff_lat: string | number;
  dropoff_lng: string | number;
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
  const [driverPin, setDriverPin] = useState<{ lat: number; lng: number } | null>(null);
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
            setDriverPin({ lat: msg.lat, lng: msg.lng });
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
      case 'PAYMENT_FAILED':
        return 'Payment issue — please add funds to your Vecta account';
      default:
        return String(ride.status).replace(/_/g, ' ');
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

  const plat = ride ? Number(ride.pickup_lat) : NaN;
  const plng = ride ? Number(ride.pickup_lng) : NaN;
  const dlat = ride ? Number(ride.dropoff_lat) : NaN;
  const dlng = ride ? Number(ride.dropoff_lng) : NaN;

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

      <View style={styles.mapWrap}>
        {MAPBOX_TOKEN ? (
          <MapboxMap
            style={{ flex: 1, height: undefined, minHeight: 280 }}
            centerLat={driverPin?.lat ?? (Number.isFinite(plat) ? plat : undefined)}
            centerLng={driverPin?.lng ?? (Number.isFinite(plng) ? plng : undefined)}
            zoom={15}
            pins={[
              ...(Number.isFinite(plat) && Number.isFinite(plng)
                ? [
                    {
                      id: 'pickup',
                      lat: plat,
                      lng: plng,
                      color: '#00E6CC',
                      label: 'Your pickup',
                    },
                  ]
                : []),
              ...(Number.isFinite(dlat) && Number.isFinite(dlng)
                ? [
                    {
                      id: 'dropoff',
                      lat: dlat,
                      lng: dlng,
                      color: '#EF4444',
                      label: 'Destination',
                    },
                  ]
                : []),
              ...(driverPin
                ? [
                    {
                      id: 'driver',
                      lat: driverPin.lat,
                      lng: driverPin.lng,
                      color: '#001F3F',
                      icon: 'car' as const,
                      label: 'Your driver',
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <View style={[styles.mapFallback, { backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}>
            <Text style={{ color: sub, fontFamily: VectaFonts.regular }}>Add EXPO_PUBLIC_MAPBOX_TOKEN for live map</Text>
          </View>
        )}
      </View>

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
  mapWrap: { flex: 1, minHeight: 280 },
  mapFallback: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sheet: {
    borderTopLeftRadius: VectaRadius.lg,
    borderTopRightRadius: VectaRadius.lg,
    marginTop: -16,
    padding: VectaSpacing.lg,
    borderWidth: 1,
    maxHeight: '42%',
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
