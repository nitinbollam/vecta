import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { API_V1_BASE, getAuthHeaders, getWsBase } from '../config/api';
import { useDriverStore } from '../stores/driver-store';

type Ride = {
  id: string;
  status: string;
  pickup_lat: string;
  pickup_lng: string;
  dropoff_lat: string;
  dropoff_lng: string;
  pickup_address: string;
  dropoff_address: string;
  rider_name?: string | null;
  price_per_mile_cents?: number;
};

export default function RideActiveScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const driver = useDriverStore((s) => s.driver);
  const driverId = driver?.id as string | undefined;

  const [ride, setRide] = useState<Ride | null>(null);
  const [phase, setPhase] = useState<'pickup' | 'wait' | 'trip'>('pickup');
  const [milesInput, setMilesInput] = useState('');
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    if (!rideId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/rides/${rideId}`, { headers });
      if (res.ok) {
        const r = (await res.json()) as Ride;
        setRide(r);
        if (r.status === 'IN_PROGRESS') setPhase('trip');
      }
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!rideId || !driverId) return;
    const base = getWsBase().replace(/\/$/, '');
    const ws = new WebSocket(`${base}/ws/ride/${rideId}?role=driver&driverId=${driverId}`);
    wsRef.current = ws;
    const iv = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        ws.send(
          JSON.stringify({
            type: 'DRIVER_LOCATION_UPDATE',
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            heading: p.coords.heading ?? undefined,
          }),
        );
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => {
      clearInterval(iv);
      ws.close();
    };
  }, [rideId, driverId]);

  const openNav = (lat: number, lng: number, label: string) => {
    const q = encodeURIComponent(label);
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${q}`
        : `google.navigation:q=${lat},${lng}`;
    void Linking.openURL(url);
  };

  const startRide = useCallback(async () => {
    if (!rideId) return;
    const headers = await getAuthHeaders();
    await fetch(`${API_V1_BASE}/mobility/driver/start/${rideId}`, { method: 'POST', headers });
    setPhase('trip');
    void load();
  }, [rideId, load]);

  const completeRide = useCallback(async () => {
    if (!rideId) return;
    const m = parseFloat(milesInput);
    if (!Number.isFinite(m) || m <= 0) return;
    const headers = await getAuthHeaders();
    await fetch(`${API_V1_BASE}/mobility/driver/complete/${rideId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actualMiles: m }),
    });
    router.replace('/(tabs)');
  }, [rideId, milesInput]);

  if (loading || !ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#00E6CC" size="large" />
      </View>
    );
  }

  const plat = Number(ride.pickup_lat);
  const plng = Number(ride.pickup_lng);
  const dlat = Number(ride.dropoff_lat);
  const dlng = Number(ride.dropoff_lng);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Active ride</Text>
      <Text style={styles.meta}>{ride.rider_name ?? 'Rider'}</Text>

      {phase === 'pickup' && (
        <>
          <Text style={styles.label}>Head to pickup</Text>
          <Text style={styles.addr}>{ride.pickup_address}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openNav(plat, plng, ride.pickup_address)}>
            <Text style={styles.btnText}>NAVIGATE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setPhase('wait')}>
            <Text style={styles.secondaryText}>I&apos;ve arrived</Text>
          </TouchableOpacity>
        </>
      )}

      {phase === 'wait' && (
        <>
          <Text style={styles.label}>Waiting for rider</Text>
          <TouchableOpacity style={styles.btn} onPress={() => void startRide()}>
            <Text style={styles.btnText}>START RIDE</Text>
          </TouchableOpacity>
        </>
      )}

      {phase === 'trip' && (
        <>
          <Text style={styles.label}>Ride in progress</Text>
          <Text style={styles.addr}>{ride.dropoff_address}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openNav(dlat, dlng, ride.dropoff_address)}>
            <Text style={styles.btnText}>NAVIGATE TO DROPOFF</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Actual miles"
            placeholderTextColor="#7A9BAD"
            keyboardType="decimal-pad"
            value={milesInput}
            onChangeText={setMilesInput}
          />
          <TouchableOpacity style={styles.btn} onPress={() => void completeRide()}>
            <Text style={styles.btnText}>COMPLETE RIDE</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#001F3F', justifyContent: 'center', alignItems: 'center' },
  root: { flex: 1, backgroundColor: '#001F3F', padding: 24, paddingTop: 56 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  meta: { color: '#9CB4C8', marginTop: 6, marginBottom: 20 },
  label: { color: '#00E6CC', fontWeight: '700', marginTop: 12 },
  addr: { color: '#E2E8F0', marginTop: 8, lineHeight: 22 },
  btn: {
    marginTop: 20,
    backgroundColor: '#00E6CC',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { fontWeight: '900', color: '#001F3F', fontSize: 16 },
  secondary: { marginTop: 16, alignItems: 'center' },
  secondaryText: { color: '#94A3B8' },
  input: {
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
  },
});
