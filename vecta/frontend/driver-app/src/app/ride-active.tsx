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
  ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import MapboxMap from '../components/MapboxMap';
import { API_V1_BASE, getAuthHeaders, getWsBase } from '../config/api';
import { useDriverStore } from '../stores/driver-store';
import { startDriverBackgroundLocation, stopDriverBackgroundLocation } from '../tasks/driver-location-task';

type Ride = {
  id: string;
  status: string;
  ride_type?: string;
  carpool_session_id?: string | null;
  pickup_lat: string;
  pickup_lng: string;
  dropoff_lat: string;
  dropoff_lng: string;
  pickup_address: string;
  dropoff_address: string;
  rider_name?: string | null;
};

type CarpoolStopRow = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  rider_fare_cents?: number | null;
  rider_miles?: string | number | null;
};

async function fetchDrivingRoute(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
): Promise<[number, number][]> {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  if (!token) return [];
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&access_token=${token}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      routes?: { geometry: { coordinates: [number, number][] } }[];
    };
    return (data.routes?.[0]?.geometry.coordinates as [number, number][]) ?? [];
  } catch {
    return [];
  }
}

export default function RideActiveScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const driver = useDriverStore((s) => s.driver);
  const driverId = driver?.id as string | undefined;

  const [ride, setRide] = useState<Ride | null>(null);
  const [phase, setPhase] = useState<'pickup' | 'wait' | 'trip'>('pickup');
  const [milesInput, setMilesInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [carpoolStops, setCarpoolStops] = useState<CarpoolStopRow[]>([]);
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
        if (r.ride_type === 'CARPOOL' && r.carpool_session_id) {
          const sRes = await fetch(
            `${API_V1_BASE}/mobility/carpool/${r.carpool_session_id}/stops`,
            { headers },
          );
          if (sRes.ok) {
            const data = (await sRes.json()) as { stops?: CarpoolStopRow[] };
            setCarpoolStops(data.stops ?? []);
          }
        } else {
          setCarpoolStops([]);
        }
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
    let sub: Location.LocationSubscription | undefined;
    void (async () => {
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          setMyLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        },
      );
    })();
    return () => {
      void sub?.remove();
    };
  }, []);

  useEffect(() => {
    if (!rideId || !driverId) return;
    const wsUrl = `${getWsBase().replace(/\/$/, '')}/ws/ride/${rideId}?role=driver&driverId=${driverId}`;
    const ws = new WebSocket(wsUrl);
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

  const plat = ride ? Number(ride.pickup_lat) : NaN;
  const plng = ride ? Number(ride.pickup_lng) : NaN;
  const dlat = ride ? Number(ride.dropoff_lat) : NaN;
  const dlng = ride ? Number(ride.dropoff_lng) : NaN;

  useEffect(() => {
    if (!ride || !myLoc) return;
    void (async () => {
      if (phase === 'trip' && Number.isFinite(dlat) && Number.isFinite(dlng)) {
        const coords = await fetchDrivingRoute(myLoc.lng, myLoc.lat, dlng, dlat);
        setRouteCoords(coords);
        return;
      }
      if ((phase === 'pickup' || phase === 'wait') && Number.isFinite(plat) && Number.isFinite(plng)) {
        const coords = await fetchDrivingRoute(myLoc.lng, myLoc.lat, plng, plat);
        setRouteCoords(coords);
      }
    })();
  }, [ride, myLoc, phase, plat, plng, dlat, dlng]);

  useEffect(() => {
    if (ride?.status !== 'IN_PROGRESS') return;
    void startDriverBackgroundLocation();
    return () => {
      void stopDriverBackgroundLocation();
    };
  }, [ride?.status]);

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
    await stopDriverBackgroundLocation();
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_V1_BASE}/mobility/driver/complete/${rideId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actualMiles: m }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      /* still navigate home; driver can retry from history if needed */
      console.warn('complete ride', body);
    }
    router.replace('/(tabs)');
  }, [rideId, milesInput]);

  if (loading || !ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#00E6CC" size="large" />
      </View>
    );
  }

  const showCarpoolStops = ride.ride_type === 'CARPOOL' && carpoolStops.length > 0;
  const showPickupPin = !showCarpoolStops && phase !== 'trip';
  const showDropoffPin =
    !showCarpoolStops && (phase === 'trip' || ride.status === 'IN_PROGRESS');

  const pins = [
    ...(showPickupPin && Number.isFinite(plat) && Number.isFinite(plng)
      ? [{ id: 'pickup', lat: plat, lng: plng, color: '#00C896' as const }]
      : []),
    ...(showDropoffPin && Number.isFinite(dlat) && Number.isFinite(dlng)
      ? [{ id: 'dropoff', lat: dlat, lng: dlng, color: '#EF4444' as const }]
      : []),
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.mapBox}>
        <MapboxMap
          style={{ flex: 1, minHeight: 220, borderRadius: 0 }}
          centerLat={myLoc?.lat ?? plat}
          centerLng={myLoc?.lng ?? plng}
          zoom={15}
          pins={pins}
          route={routeCoords.length > 1 ? { coordinates: routeCoords, color: '#00E6CC' } : undefined}
        />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.title}>Active ride</Text>
        <Text style={styles.meta}>{ride.rider_name ?? 'Rider'}</Text>

        {showCarpoolStops ? (
          <View style={styles.stopsCard}>
            <Text style={styles.stopsTitle}>
              Carpool Stops ({carpoolStops.filter((s) => s.status === 'DROPPED_OFF').length}/
              {carpoolStops.length} complete)
            </Text>
            {carpoolStops.map((stop, index) => (
              <View key={stop.id} style={styles.stopRow}>
                <View
                  style={[
                    styles.stopDot,
                    stop.status === 'DROPPED_OFF' && styles.stopDotDone,
                    stop.status === 'PICKED_UP' && styles.stopDotActive,
                  ]}
                />
                <View style={styles.stopInfo}>
                  <Text style={styles.stopRider}>Rider {index + 1}</Text>
                  <Text style={styles.stopAddress} numberOfLines={1}>
                    ↑ {stop.pickup_address}
                  </Text>
                  <Text style={styles.stopAddress} numberOfLines={1}>
                    ↓ {stop.dropoff_address}
                  </Text>
                  <Text style={styles.stopFare}>
                    +${((Number(stop.rider_fare_cents) || 0) / 100).toFixed(2)} for you
                  </Text>
                </View>
                {stop.status === 'WAITING' ? (
                  <TouchableOpacity
                    style={styles.stopActionBtn}
                    onPress={async () => {
                      const headers = await getAuthHeaders();
                      await fetch(`${API_V1_BASE}/mobility/carpool/stop/${stop.id}/pickup`, {
                        method: 'POST',
                        headers,
                      });
                      setCarpoolStops((prev) =>
                        prev.map((s) => (s.id === stop.id ? { ...s, status: 'PICKED_UP' } : s)),
                      );
                      void load();
                    }}
                  >
                    <Text style={styles.stopActionText}>Picked Up</Text>
                  </TouchableOpacity>
                ) : null}
                {stop.status === 'PICKED_UP' ? (
                  <TouchableOpacity
                    style={[styles.stopActionBtn, styles.stopDropoffBtn]}
                    onPress={async () => {
                      const miles =
                        stop.rider_miles != null && stop.rider_miles !== ''
                          ? Number(stop.rider_miles)
                          : 2;
                      const headers = await getAuthHeaders();
                      await fetch(`${API_V1_BASE}/mobility/carpool/stop/${stop.id}/dropoff`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ actualMiles: Number.isFinite(miles) ? miles : 2 }),
                      });
                      setCarpoolStops((prev) =>
                        prev.map((s) => (s.id === stop.id ? { ...s, status: 'DROPPED_OFF' } : s)),
                      );
                      void load();
                    }}
                  >
                    <Text style={styles.stopActionText}>Dropped Off</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {carpoolStops.every((s) => s.status === 'DROPPED_OFF') ? (
              <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)')}>
                <Text style={styles.btnText}>DONE — BACK TO HOME</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {!showCarpoolStops && phase === 'pickup' && (
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

        {!showCarpoolStops && phase === 'wait' && (
          <>
            <Text style={styles.label}>Waiting for rider</Text>
            <TouchableOpacity style={styles.btn} onPress={() => void startRide()}>
              <Text style={styles.btnText}>START RIDE</Text>
            </TouchableOpacity>
          </>
        )}

        {!showCarpoolStops && phase === 'trip' && (
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#001F3F' },
  center: { flex: 1, backgroundColor: '#001F3F', justifyContent: 'center', alignItems: 'center' },
  mapBox: { flex: 1, minHeight: 220 },
  panel: { maxHeight: '46%' },
  panelContent: { padding: 24, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  meta: { color: '#9CB4C8', marginTop: 6, marginBottom: 12 },
  label: { color: '#00E6CC', fontWeight: '700', marginTop: 8 },
  addr: { color: '#E2E8F0', marginTop: 8, lineHeight: 22 },
  btn: {
    marginTop: 16,
    backgroundColor: '#00E6CC',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { fontWeight: '900', color: '#001F3F', fontSize: 16 },
  secondary: { marginTop: 12, alignItems: 'center' },
  secondaryText: { color: '#94A3B8' },
  input: {
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
  },
  stopsCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
  },
  stopsTitle: { color: '#00E6CC', fontWeight: '800', fontSize: 15, marginBottom: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 10 },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#64748B',
    marginTop: 6,
  },
  stopDotDone: { backgroundColor: '#22C55E' },
  stopDotActive: { backgroundColor: '#00E6CC' },
  stopInfo: { flex: 1, minWidth: 0 },
  stopRider: { color: '#E2E8F0', fontWeight: '700', fontSize: 14 },
  stopAddress: { color: '#94A3B8', fontSize: 12, marginTop: 4 },
  stopFare: { color: '#00E6CC', fontSize: 12, fontWeight: '600', marginTop: 6 },
  stopActionBtn: {
    backgroundColor: '#00E6CC',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  stopDropoffBtn: { backgroundColor: '#0EA5E9' },
  stopActionText: { color: '#001F3F', fontWeight: '800', fontSize: 12 },
});
