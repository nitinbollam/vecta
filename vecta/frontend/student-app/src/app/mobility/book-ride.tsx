/**
 * Book a ride — pickup (GPS), dropoff (Mapbox geocode), native map, Directions API route.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapboxMap from '../../components/MapboxMap';
import { API_V1_BASE, getAuthHeaders, MAPBOX_TOKEN } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { haversineMiles } from '../../lib/ride-pricing';
import { searchAddress, reverseGeocode, type GeocodingResult } from '../../services/geocoding';

export default function BookRideScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState('Current location');
  const [dropoffInput, setDropoffInput] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffPlaceName, setDropoffPlaceName] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [directionsMiles, setDirectionsMiles] = useState<number | null>(null);
  const [estimatedDurationMin, setEstimatedDurationMin] = useState<number | null>(null);

  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loadingLoc, setLoadingLoc] = useState(true);
  const [loadingGeo, setLoadingGeo] = useState(false);
  const [nearbyDrivers, setNearbyDrivers] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rideType, setRideType] = useState<'PRIORITY' | 'CARPOOL' | null>(null);
  const [estimate, setEstimate] = useState<{
    miles: number;
    priority: {
      fareCents: number;
      pricePerMile: number;
      etaMinutes: number;
    };
    carpool: {
      fareCents: number;
      pricePerMile: number;
      etaMinutes: number;
      savingsCents: number;
      savingsPct: number;
    };
  } | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchRoute = useCallback(
    async (fromLng: number, fromLat: number, toLng: number, toLat: number) => {
      const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&access_token=${token}`;
        const res = await fetch(url);
        const data = (await res.json()) as {
          routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[];
        };
        if (data.routes?.[0]) {
          const coords = data.routes[0].geometry.coordinates as [number, number][];
          setRouteCoords(coords);
          setDirectionsMiles(data.routes[0].distance / 1609.34);
          setEstimatedDurationMin(Math.round(data.routes[0].duration / 60));
        }
      } catch {
        setRouteCoords([]);
        setDirectionsMiles(null);
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErr('Location permission is required to set pickup.');
          setLoadingLoc(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        setUserLocation({ lat, lng });
        setPickupCoords({ lat, lng });
        const address = await reverseGeocode(lat, lng);
        setPickupAddress(address);
      } catch {
        setErr('Could not read your location.');
      } finally {
        setLoadingLoc(false);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        if (dropoffInput.trim().length < 3) {
          setSearchResults([]);
          return;
        }
        setLoadingGeo(true);
        try {
          const results = await searchAddress(dropoffInput.trim());
          setSearchResults(results);
          setShowResults(true);
        } finally {
          setLoadingGeo(false);
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [dropoffInput]);

  const haversineEst = useMemo(() => {
    if (!pickupCoords || !dropoffCoords) return 0;
    return haversineMiles(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
  }, [pickupCoords, dropoffCoords]);

  const estimatedMiles = directionsMiles ?? haversineEst;

  const loadNearby = useCallback(async () => {
    if (!pickupCoords) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_BASE}/mobility/rides/nearby-drivers?lat=${pickupCoords.lat}&lng=${pickupCoords.lng}`,
        { headers },
      );
      if (res.ok) {
        const d = (await res.json()) as { drivers: unknown[] };
        setNearbyDrivers((d.drivers ?? []).length);
      }
    } catch {
      setNearbyDrivers(null);
    }
  }, [pickupCoords]);

  useEffect(() => {
    if (pickupCoords) void loadNearby();
  }, [pickupCoords, loadNearby]);

  const fetchEstimate = useCallback(async () => {
    const m = estimatedMiles;
    if (!m || m <= 0) {
      setEstimate(null);
      return;
    }
    setLoadingEstimate(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/rides/estimate?miles=${m}`, { headers });
      if (!res.ok) {
        setEstimate(null);
        return;
      }
      const data = (await res.json()) as NonNullable<typeof estimate>;
      setEstimate(data);
    } catch {
      setEstimate(null);
    } finally {
      setLoadingEstimate(false);
    }
  }, [estimatedMiles]);

  useEffect(() => {
    if (estimatedMiles > 0) void fetchEstimate();
    else setEstimate(null);
  }, [estimatedMiles, fetchEstimate]);

  useEffect(() => {
    setRideType(null);
  }, [pickupCoords, dropoffCoords, estimatedMiles]);

  const pickupEtaHint =
    nearbyDrivers != null && nearbyDrivers > 0 ? '~5–12 min pickup' : null;

  const handleRequestRide = useCallback(async () => {
    setErr(null);
    if (!rideType || !pickupCoords || !dropoffCoords || !dropoffPlaceName) {
      setErr('Set pickup, dropoff, and ride type.');
      return;
    }
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const endpoint =
        rideType === 'PRIORITY' ? '/mobility/rides/request/priority' : '/mobility/rides/request/carpool';
      const res = await fetch(`${API_V1_BASE}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pickupLat: pickupCoords.lat,
          pickupLng: pickupCoords.lng,
          pickupAddress,
          dropoffLat: dropoffCoords.lat,
          dropoffLng: dropoffCoords.lng,
          dropoffAddress: dropoffPlaceName,
          estimatedMiles: Math.round(estimatedMiles * 100) / 100,
        }),
      });
      const data = (await res.json()) as {
        rideId?: string;
        error?: string;
        matched?: boolean;
        fareCents?: number;
        waitMinutes?: number;
        driverInfo?: { vehicleMake?: string; vehicleModel?: string };
      };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (!data.rideId) throw new Error('No ride id');

      if (rideType === 'CARPOOL' && data.matched) {
        Alert.alert(
          '🚌 Carpool Found!',
          `You have been matched with a ride!\n\nDriver: ${data.driverInfo?.vehicleMake ?? ''} ${data.driverInfo?.vehicleModel ?? ''}\nETA: ~${data.waitMinutes ?? 5} min\nYour fare: $${((data.fareCents ?? 0) / 100).toFixed(2)}`,
          [
            {
              text: 'Track Ride',
              onPress: () => router.replace(`/mobility/ride-tracking?rideId=${data.rideId}&type=carpool`),
            },
          ],
        );
      } else if (rideType === 'CARPOOL' && !data.matched) {
        Alert.alert(
          '🔍 Finding Your Carpool',
          `We are matching you with a carpool. Estimated wait: ~${data.waitMinutes ?? 5} minutes.\n\nWe will notify you when a driver is found.`,
          [
            {
              text: 'OK',
              onPress: () => router.replace(`/mobility/ride-tracking?rideId=${data.rideId}&type=carpool`),
            },
          ],
        );
      } else {
        router.replace(`/mobility/ride-tracking?rideId=${data.rideId}&type=priority`);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not request ride. Please try again.');
      setErr(e instanceof Error ? e.message : 'Could not request ride');
    } finally {
      setLoading(false);
    }
  }, [rideType, pickupCoords, pickupAddress, dropoffCoords, dropoffPlaceName, estimatedMiles]);

  const surface = isDark ? VectaColors.primaryMid : VectaColors.surfaceBase;
  const sub = isDark ? '#7A9BAD' : VectaColors.textSecondary;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: surface, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Book a Ride</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: sub }]}>Pickup</Text>
        <TouchableOpacity
          style={[styles.field, { borderColor: colors.border, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
          disabled={loadingLoc}
        >
          <Ionicons name="location" size={20} color={VectaColors.accent} />
          <Text style={[styles.fieldText, { color: colors.text }]} numberOfLines={2}>
            {loadingLoc ? 'Getting location…' : pickupAddress}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.label, { color: sub, marginTop: 16 }]}>Where to?</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
          placeholder="Search address"
          placeholderTextColor={sub}
          value={dropoffInput}
          onChangeText={(t) => {
            setDropoffInput(t);
            setDropoffCoords(null);
            setDropoffPlaceName(null);
            setRouteCoords([]);
            setDirectionsMiles(null);
          }}
          onFocus={() => {
            if (searchResults.length > 0) setShowResults(true);
          }}
        />
        {loadingGeo ? <ActivityIndicator color={VectaColors.accent} style={{ marginTop: 8 }} /> : null}

        {showResults && searchResults.length > 0 ? (
          <View
            style={[
              styles.resultsContainer,
              { backgroundColor: isDark ? '#152238' : VectaColors.surface1, borderColor: colors.border },
            ]}
          >
            {searchResults.map((result) => (
              <TouchableOpacity
                key={result.id}
                style={[styles.resultRow, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setDropoffPlaceName(result.placeName);
                  setDropoffInput(result.placeName);
                  setDropoffCoords({ lat: result.lat, lng: result.lng });
                  setShowResults(false);
                  if (pickupCoords) {
                    void fetchRoute(pickupCoords.lng, pickupCoords.lat, result.lng, result.lat);
                  }
                }}
              >
                <Ionicons name="location-outline" size={16} color="#5A7080" />
                <Text style={[styles.resultText, { color: colors.text }]} numberOfLines={2}>
                  {result.placeName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {!MAPBOX_TOKEN ? (
          <Text style={[styles.warn, { color: VectaColors.warning }]}>
            Add EXPO_PUBLIC_MAPBOX_TOKEN for maps, search, and routing.
          </Text>
        ) : null}

        {MAPBOX_TOKEN && pickupCoords ? (
          <MapboxMap
            style={{ height: 250, marginTop: 16, marginHorizontal: 0, marginBottom: 16 }}
            centerLat={pickupCoords.lat ?? userLocation?.lat}
            centerLng={pickupCoords.lng ?? userLocation?.lng}
            pins={[
              ...(pickupCoords
                ? [
                    {
                      id: 'pickup',
                      lat: pickupCoords.lat,
                      lng: pickupCoords.lng,
                      color: '#00E6CC',
                      icon: 'pickup' as const,
                      label: 'Pickup',
                    },
                  ]
                : []),
              ...(dropoffCoords
                ? [
                    {
                      id: 'dropoff',
                      lat: dropoffCoords.lat,
                      lng: dropoffCoords.lng,
                      color: '#EF4444',
                      icon: 'dropoff' as const,
                      label: 'Dropoff',
                    },
                  ]
                : []),
            ]}
            route={
              routeCoords.length > 0
                ? {
                    coordinates: routeCoords,
                    color: '#00E6CC',
                  }
                : undefined
            }
          />
        ) : null}

        {pickupCoords && dropoffCoords && dropoffPlaceName ? (
          <View style={[styles.fareCard, { backgroundColor: isDark ? '#152238' : VectaColors.infoBg, borderColor: colors.border }]}>
            <Text style={[styles.fareTitle, { color: colors.text }]}>Trip</Text>
            <Text style={[styles.fareMeta, { color: sub }]}>
              Distance ~{(estimatedMiles || 0).toFixed(1)} mi
              {estimatedDurationMin != null ? ` · ~${estimatedDurationMin} min drive` : ''}
            </Text>
            {loadingEstimate ? <ActivityIndicator color={VectaColors.accent} style={{ marginTop: 12 }} /> : null}
          </View>
        ) : null}

        {estimate && pickupCoords && dropoffCoords && dropoffPlaceName ? (
          <View style={styles.rideTypeSection}>
            <Text style={[styles.rideTypeHeader, { color: colors.text }]}>Choose your ride</Text>

            <TouchableOpacity
              style={[
                styles.rideTypeCard,
                { borderColor: rideType === 'PRIORITY' ? VectaColors.accent : colors.border },
                rideType === 'PRIORITY' && { backgroundColor: isDark ? '#0F1F2E' : '#F0FFFE' },
              ]}
              onPress={() => setRideType('PRIORITY')}
              activeOpacity={0.8}
            >
              <View style={styles.rideTypeLeft}>
                <View style={[styles.rideTypeIconWrap, { backgroundColor: isDark ? '#1a2838' : '#F3F4F6' }]}>
                  <Text style={styles.rideTypeIcon}>🚗</Text>
                </View>
                <View style={styles.rideTypeTextCol}>
                  <Text style={[styles.rideTypeName, { color: colors.text }]}>Priority</Text>
                  <Text style={[styles.rideTypeDesc, { color: sub }]}>Private ride · Just you</Text>
                  <Text style={styles.rideTypeEta}>~{estimate.priority.etaMinutes} min away</Text>
                </View>
              </View>
              <View style={styles.rideTypeRight}>
                <Text style={[styles.rideTypePrice, { color: colors.text }]}>
                  ${(estimate.priority.fareCents / 100).toFixed(2)}
                </Text>
                <Text style={[styles.rideTypePpm, { color: sub }]}>
                  ${estimate.priority.pricePerMile.toFixed(2)}/mi
                </Text>
              </View>
              {rideType === 'PRIORITY' ? (
                <View style={styles.selectedBadge}>
                  <Text style={styles.selectedBadgeText}>✓</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.rideTypeCard,
                styles.carpoolCard,
                { borderColor: rideType === 'CARPOOL' ? VectaColors.accent : colors.border },
                rideType === 'CARPOOL' && { backgroundColor: isDark ? '#0F1F2E' : '#F0FFFE' },
              ]}
              onPress={() => setRideType('CARPOOL')}
              activeOpacity={0.8}
            >
              <View style={styles.savingsBadge}>
                <Text style={styles.savingsBadgeText}>Save {estimate.carpool.savingsPct}%</Text>
              </View>
              <View style={styles.rideTypeLeft}>
                <View style={[styles.rideTypeIconWrap, { backgroundColor: isDark ? '#1a2838' : '#F3F4F6' }]}>
                  <Text style={styles.rideTypeIcon}>🚌</Text>
                </View>
                <View style={styles.rideTypeTextCol}>
                  <Text style={[styles.rideTypeName, { color: colors.text }]}>Carpool</Text>
                  <Text style={[styles.rideTypeDesc, { color: sub }]}>Share with peers going your way</Text>
                  <Text style={styles.rideTypeEta}>
                    ~{estimate.carpool.etaMinutes} min · up to 3 others
                  </Text>
                </View>
              </View>
              <View style={styles.rideTypeRight}>
                <Text style={[styles.rideTypePrice, { color: colors.text }]}>
                  ${(estimate.carpool.fareCents / 100).toFixed(2)}
                </Text>
                <Text style={[styles.rideTypePpm, { color: sub }]}>
                  ${estimate.carpool.pricePerMile.toFixed(2)}/mi
                </Text>
                <Text style={styles.savingsAmount}>
                  Save ${(estimate.carpool.savingsCents / 100).toFixed(2)}
                </Text>
              </View>
              {rideType === 'CARPOOL' ? (
                <View style={styles.selectedBadge}>
                  <Text style={styles.selectedBadgeText}>✓</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <View style={styles.comparisonBar}>
              <Text style={styles.comparisonText}>
                🆚 Uber would charge ~${(estimatedMiles * 2.2).toFixed(2)} for this trip
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={[styles.nearbyLine, { color: sub }]}>
          {nearbyDrivers === null
            ? '…'
            : `${nearbyDrivers} driver${nearbyDrivers === 1 ? '' : 's'} within 5 miles`}
          {pickupEtaHint ? ` · ${pickupEtaHint}` : ''}
        </Text>

        {err ? <Text style={styles.error}>{err}</Text> : null}

        {rideType && estimate ? (
          <TouchableOpacity
            style={[styles.confirmButton, { opacity: loading ? 0.7 : 1 }]}
            onPress={() => void handleRequestRide()}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color={VectaColors.primary} />
            ) : (
              <Text style={styles.confirmButtonText}>
                Request {rideType === 'PRIORITY' ? '🚗 Priority' : '🚌 Carpool'} — $
                {(
                  (rideType === 'PRIORITY' ? estimate.priority.fareCents : estimate.carpool.fareCents) / 100
                ).toFixed(2)}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: VectaSpacing.md,
    paddingVertical: VectaSpacing.sm,
  },
  headerTitle: { fontFamily: VectaFonts.semiBold, fontSize: 18 },
  scroll: { padding: VectaSpacing.lg, paddingBottom: 40 },
  label: { fontFamily: VectaFonts.medium, fontSize: 13, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: VectaRadius.md,
    borderWidth: 1,
  },
  fieldText: { flex: 1, fontFamily: VectaFonts.regular, fontSize: 15 },
  input: {
    borderWidth: 1,
    borderRadius: VectaRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: VectaFonts.regular,
    fontSize: 16,
  },
  resultsContainer: {
    marginTop: 4,
    borderRadius: VectaRadius.md,
    borderWidth: 1,
    maxHeight: 220,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultText: { flex: 1, fontFamily: VectaFonts.regular, fontSize: 14 },
  fareCard: { marginTop: 18, padding: VectaSpacing.lg, borderRadius: VectaRadius.lg, borderWidth: 1 },
  fareTitle: { fontFamily: VectaFonts.medium, fontSize: 14 },
  fareAmt: { fontFamily: VectaFonts.bold, fontSize: 28, marginTop: 6 },
  fareMeta: { fontFamily: VectaFonts.regular, fontSize: 13, marginTop: 4 },
  nearbyLine: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 14, textAlign: 'center' },
  warn: { fontFamily: VectaFonts.regular, fontSize: 13, marginTop: 12 },
  error: { color: VectaColors.error, fontFamily: VectaFonts.regular, marginTop: 12, textAlign: 'center' },
  rideTypeSection: { marginTop: 16, marginBottom: 8 },
  rideTypeHeader: { fontSize: 18, fontFamily: VectaFonts.bold, marginBottom: 12 },
  rideTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  carpoolCard: { position: 'relative', overflow: 'hidden' },
  rideTypeLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  rideTypeTextCol: { flex: 1 },
  rideTypeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rideTypeIcon: { fontSize: 24 },
  rideTypeName: { fontSize: 16, fontFamily: VectaFonts.bold, marginBottom: 2 },
  rideTypeDesc: { fontSize: 12, marginBottom: 2 },
  rideTypeEta: { fontSize: 12, color: '#00B8A4', fontFamily: VectaFonts.medium },
  rideTypeRight: { alignItems: 'flex-end' },
  rideTypePrice: { fontSize: 20, fontFamily: VectaFonts.bold },
  rideTypePpm: { fontSize: 11, color: '#5A7080' },
  savingsAmount: { fontSize: 11, color: '#00C896', fontFamily: VectaFonts.semiBold },
  savingsBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#00E6CC',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 14,
    zIndex: 1,
  },
  savingsBadgeText: { fontSize: 11, fontFamily: VectaFonts.bold, color: '#001F3F' },
  selectedBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#00E6CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: { color: '#001F3F', fontSize: 12, fontFamily: VectaFonts.bold },
  comparisonBar: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    alignItems: 'center',
  },
  comparisonText: { fontSize: 12, color: '#92400E', fontFamily: VectaFonts.medium },
  confirmButton: {
    backgroundColor: '#00E6CC',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    shadowColor: '#00E6CC',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  confirmButtonText: { color: '#001F3F', fontFamily: VectaFonts.bold, fontSize: 16 },
});
