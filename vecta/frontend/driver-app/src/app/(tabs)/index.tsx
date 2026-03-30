import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import MapboxMap from '../../components/MapboxMap';
import { API_V1_BASE, getAuthHeaders, getWsBase } from '../../config/api';
import { useDriverStore } from '../../stores/driver-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type IncomingRide = {
  type?: string;
  rideId?: string;
  fare?: { driverPayoutCents?: number; estimatedFareCents?: number };
  pickupAddress?: string;
  dropoffAddress?: string;
  estimatedMiles?: number;
};

export default function DriverHome() {
  const driver = useDriverStore((s) => s.driver);
  const refreshDriver = useDriverStore((s) => s.refreshDriver);
  const driverId = driver?.id as string | undefined;

  const [online, setOnline] = useState(Boolean(driver?.is_online));
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRide | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const token = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const headers = await getAuthHeaders();
      await fetch(`${API_V1_BASE}/mobility/driver/push-token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: token.data }),
      }).catch(() => undefined);
    })();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as {
        type?: string;
        ride?: {
          id: string;
          pickupAddress: string;
          dropoffAddress: string;
          estimatedMiles: number;
          fareCents: number;
          driverPayout: number;
        };
      };
      if (data?.type === 'RIDE_REQUEST' && data.ride) {
        const r = data.ride;
        setIncoming({
          type: 'RIDE_REQUEST',
          rideId: r.id,
          pickupAddress: r.pickupAddress,
          dropoffAddress: r.dropoffAddress,
          estimatedMiles: r.estimatedMiles,
          fare: {
            estimatedFareCents: r.fareCents,
            driverPayoutCents: r.driverPayout,
          },
        });
        setSecondsLeft(30);
      }
    });
    return () => sub.remove();
  }, []);

  const startLocationTracking = useCallback(async () => {
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      async (loc) => {
        const { latitude: lat, longitude: lng, heading } = loc.coords;
        setCurrentLocation({ lat, lng });
        try {
          const headers = await getAuthHeaders();
          await fetch(`${API_V1_BASE}/mobility/driver/location`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ lat, lng, heading: heading ?? 0 }),
          });
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'DRIVER_LOCATION_UPDATE',
                lat,
                lng,
                heading: heading ?? 0,
              }),
            );
          }
        } catch {
          /* ignore */
        }
      },
    );
    locationSubscriptionRef.current = subscription;
  }, []);

  const proceedOnline = useCallback(async () => {
    if (!driverId) return;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_V1_BASE}/mobility/driver/online`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      Alert.alert('Error', data.message ?? 'Could not go online. Check your account status.');
      return;
    }
    setOnline(true);
    setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    await refreshDriver();
    await startLocationTracking();
  }, [driverId, refreshDriver, startLocationTracking]);

  const handleGoOnline = useCallback(async () => {
    if (!driverId) return;
    setBusy(true);
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert(
          'Location Required',
          'Vecta Driver needs your location to match you with riders. Please enable location access.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }

      if (Platform.OS === 'android') {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          Alert.alert(
            'Background Location Required',
            'To receive ride requests while the app is in the background, please select "Allow all the time" in your location settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => void Linking.openSettings() },
            ],
          );
          Alert.alert(
            'Limited Mode',
            'You can still receive rides but must keep the app open. For full background support, enable "Allow all the time" in settings.',
            [{ text: 'Continue Anyway', onPress: () => void proceedOnline() }],
          );
          return;
        }
      }

      await proceedOnline();
    } catch {
      Alert.alert('Error', 'Could not enable location. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [driverId, proceedOnline]);

  const goOffline = useCallback(async () => {
    if (!driverId) return;
    setBusy(true);
    try {
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      const headers = await getAuthHeaders();
      await fetch(`${API_V1_BASE}/mobility/driver/offline`, { method: 'POST', headers });
      setOnline(false);
      wsRef.current?.close();
      wsRef.current = null;
      await refreshDriver();
    } finally {
      setBusy(false);
    }
  }, [driverId, refreshDriver]);

  useEffect(() => {
    if (!online || !driverId) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }
    const wsUrl = `${getWsBase().replace(/\/$/, '')}/ws/driver?driverId=${driverId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as IncomingRide;
        if (msg.type === 'RIDE_REQUEST' && msg.rideId) {
          setIncoming(msg);
          setSecondsLeft(30);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [online, driverId]);

  useEffect(() => {
    if (!incoming?.rideId) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          setIncoming(null);
          return 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [incoming?.rideId]);

  useEffect(() => {
    if (!online) {
      setCurrentLocation(null);
      return;
    }
    void (async () => {
      try {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCurrentLocation({ lat: p.coords.latitude, lng: p.coords.longitude });
      } catch {
        setCurrentLocation(null);
      }
    })();
  }, [online]);

  useEffect(() => {
    return () => {
      locationSubscriptionRef.current?.remove();
      wsRef.current?.close();
    };
  }, []);

  const acceptRide = useCallback(async () => {
    if (!incoming?.rideId) return;
    setBusy(true);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_V1_BASE}/mobility/driver/accept/${incoming.rideId}`, {
        method: 'POST',
        headers,
      });
      setIncoming(null);
      router.push(`/ride-active?rideId=${incoming.rideId}`);
    } finally {
      setBusy(false);
    }
  }, [incoming?.rideId]);

  const declineRide = useCallback(() => setIncoming(null), []);

  const mapReady = Boolean(process.env.EXPO_PUBLIC_MAPBOX_TOKEN);

  return (
    <View style={styles.root}>
      {online && mapReady && currentLocation ? (
        <MapboxMap
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.35,
            minHeight: undefined,
            borderRadius: 0,
          }}
          centerLat={currentLocation.lat}
          centerLng={currentLocation.lng}
          zoom={13}
          pins={[]}
        />
      ) : null}
      {online ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>YOU ARE ONLINE</Text>
        </View>
      ) : null}

      <Text style={styles.headline}>{online ? 'Waiting for ride requests…' : 'You are offline'}</Text>

      {!online ? (
        <TouchableOpacity style={styles.goBtn} onPress={() => void handleGoOnline()} disabled={busy}>
          {busy ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.goBtnText}>GO ONLINE</Text>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.offBtn} onPress={() => void goOffline()} disabled={busy}>
          <Text style={styles.offBtnText}>GO OFFLINE</Text>
        </TouchableOpacity>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your vehicle</Text>
        <Text style={styles.cardBody}>
          {[driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ') || '—'}
        </Text>
        <Text style={styles.cardBody}>{driver?.vehicle_plate ? `Plate ${driver.vehicle_plate}` : ''}</Text>
      </View>

      <Modal visible={Boolean(incoming?.rideId)} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New ride request</Text>
            <Text style={styles.modalLine}>{incoming?.pickupAddress}</Text>
            <Text style={styles.modalLine}>→ {incoming?.dropoffAddress}</Text>
            <Text style={styles.modalMeta}>
              Est. miles: {incoming?.estimatedMiles?.toFixed?.(1) ?? '—'} · Est. fare: $
              {((incoming?.fare?.estimatedFareCents ?? 0) / 100).toFixed(2)}
            </Text>
            <Text style={styles.timer}>{secondsLeft}s</Text>
            <TouchableOpacity style={styles.accept} onPress={() => void acceptRide()} disabled={busy}>
              <Text style={styles.acceptText}>ACCEPT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.decline} onPress={declineRide}>
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F', paddingTop: 56, paddingHorizontal: 24, position: 'relative' },
  banner: {
    zIndex: 1,
    backgroundColor: '#00C896',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  bannerText: { fontWeight: '800', color: '#001F3F' },
  headline: { zIndex: 1, color: '#9CB4C8', fontSize: 16, textAlign: 'center', marginBottom: 32 },
  goBtn: {
    zIndex: 1,
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#00E6CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  goBtnText: { fontSize: 22, fontWeight: '900', color: '#001F3F' },
  offBtn: {
    zIndex: 1,
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginBottom: 24,
  },
  offBtnText: { color: '#FCA5A5', fontWeight: '700' },
  card: {
    zIndex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
  },
  cardTitle: { color: '#fff', fontWeight: '700', marginBottom: 8 },
  cardBody: { color: '#9CB4C8', fontSize: 15 },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0F1628',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  modalLine: { color: '#E2E8F0', marginBottom: 6 },
  modalMeta: { color: '#94A3B8', marginTop: 8 },
  timer: { color: '#F59E0B', fontWeight: '800', marginTop: 12, fontSize: 18 },
  accept: {
    marginTop: 20,
    backgroundColor: '#00C896',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptText: { fontWeight: '900', color: '#001F3F', fontSize: 18 },
  decline: { marginTop: 12, alignItems: 'center', padding: 8 },
  declineText: { color: '#94A3B8' },
});
