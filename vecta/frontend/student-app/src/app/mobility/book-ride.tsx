/**
 * Book a ride — pickup (GPS), dropoff (Mapbox geocode), fare preview, request.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_V1_BASE, getAuthHeaders, MAPBOX_TOKEN } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { estimateFareCents, haversineMiles } from '../../lib/ride-pricing';

type GeocodeFeature = {
  id: string;
  place_name: string;
  center: [number, number];
};

export default function BookRideScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [pickupLabel, setPickupLabel] = useState('Your current location');
  const [dropQuery, setDropQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeFeature[]>([]);
  const [dropoff, setDropoff] = useState<GeocodeFeature | null>(null);
  const [loadingLoc, setLoadingLoc] = useState(true);
  const [loadingGeo, setLoadingGeo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nearbyDrivers, setNearbyDrivers] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErr('Location permission is required to set pickup.');
          setLoadingLoc(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPickupLat(pos.coords.latitude);
        setPickupLng(pos.coords.longitude);
      } catch {
        setErr('Could not read your location.');
      } finally {
        setLoadingLoc(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!MAPBOX_TOKEN || dropQuery.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setLoadingGeo(true);
        try {
          const q = encodeURIComponent(dropQuery.trim());
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${MAPBOX_TOKEN}&limit=5`,
          );
          const data = (await res.json()) as { features?: GeocodeFeature[] };
          setSuggestions(data.features ?? []);
        } catch {
          setSuggestions([]);
        } finally {
          setLoadingGeo(false);
        }
      })();
    }, 350);
    return () => clearTimeout(t);
  }, [dropQuery]);

  const estimatedMiles = useMemo(() => {
    if (pickupLat == null || pickupLng == null || !dropoff) return 0;
    return haversineMiles(pickupLat, pickupLng, dropoff.center[1], dropoff.center[0]);
  }, [pickupLat, pickupLng, dropoff]);

  const fare = useMemo(() => estimateFareCents(Math.max(estimatedMiles, 0.1)), [estimatedMiles]);

  const staticMapUrl = useMemo(() => {
    if (!MAPBOX_TOKEN || pickupLat == null || pickupLng == null || !dropoff) return null;
    const a = `${pickupLng},${pickupLat}`;
    const b = `${dropoff.center[0]},${dropoff.center[1]}`;
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+00e6cc(${a}),pin-s+ef4444(${b})/auto/600x360@2x?access_token=${MAPBOX_TOKEN}`;
  }, [pickupLat, pickupLng, dropoff]);

  const loadNearby = useCallback(async () => {
    if (pickupLat == null || pickupLng == null) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_BASE}/mobility/rides/nearby-drivers?lat=${pickupLat}&lng=${pickupLng}`,
        { headers },
      );
      if (res.ok) {
        const d = (await res.json()) as { drivers: { distance_meters?: number }[] };
        setNearbyDrivers((d.drivers ?? []).length);
      }
    } catch {
      setNearbyDrivers(null);
    }
  }, [pickupLat, pickupLng]);

  useEffect(() => {
    if (pickupLat != null && pickupLng != null) void loadNearby();
  }, [pickupLat, pickupLng, loadNearby]);

  const pickupEtaHint =
    nearbyDrivers != null && nearbyDrivers > 0 ? '~5–12 min pickup' : null;

  const requestRide = useCallback(async () => {
    setErr(null);
    if (pickupLat == null || pickupLng == null || !dropoff) {
      setErr('Set pickup and dropoff first.');
      return;
    }
    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/rides/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pickupLat,
          pickupLng,
          pickupAddress: pickupLabel,
          dropoffLat: dropoff.center[1],
          dropoffLng: dropoff.center[0],
          dropoffAddress: dropoff.place_name,
          estimatedMiles: Math.round(estimatedMiles * 100) / 100,
        }),
      });
      const data = (await res.json()) as { rideId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (!data.rideId) throw new Error('No ride id');
      router.replace(`/mobility/ride-tracking?rideId=${data.rideId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not request ride');
    } finally {
      setSubmitting(false);
    }
  }, [pickupLat, pickupLng, pickupLabel, dropoff, estimatedMiles]);

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
            {loadingLoc ? 'Getting location…' : pickupLabel}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.label, { color: sub, marginTop: 16 }]}>Where to?</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
          placeholder="Search address"
          placeholderTextColor={sub}
          value={dropQuery}
          onChangeText={(t) => {
            setDropQuery(t);
            setDropoff(null);
          }}
        />
        {loadingGeo ? <ActivityIndicator color={VectaColors.accent} style={{ marginTop: 8 }} /> : null}
        {suggestions.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.suggest, { borderBottomColor: colors.border }]}
            onPress={() => {
              setDropoff(s);
              setDropQuery(s.place_name);
              setSuggestions([]);
            }}
          >
            <Text style={{ color: colors.text, fontFamily: VectaFonts.regular }} numberOfLines={2}>
              {s.place_name}
            </Text>
          </TouchableOpacity>
        ))}

        {!MAPBOX_TOKEN ? (
          <Text style={[styles.warn, { color: VectaColors.warning }]}>
            Add EXPO_PUBLIC_MAPBOX_TOKEN for address search and map preview.
          </Text>
        ) : null}

        {staticMapUrl ? (
          <Image source={{ uri: staticMapUrl }} style={styles.map} resizeMode="cover" />
        ) : null}

        <View style={[styles.fareCard, { backgroundColor: isDark ? '#152238' : VectaColors.infoBg, borderColor: colors.border }]}>
          <Text style={[styles.fareTitle, { color: colors.text }]}>Estimated fare</Text>
          <Text style={[styles.fareAmt, { color: VectaColors.accent }]}>
            ${(fare.estimatedFareCents / 100).toFixed(2)}
          </Text>
          <Text style={[styles.fareMeta, { color: sub }]}>
            Distance ~{estimatedMiles.toFixed(1)} mi · ${(fare.pricePerMileCents / 100).toFixed(2)}/mile · 10% platform fee
          </Text>
          <Text style={[styles.fareMeta, { color: sub }]}>Your driver keeps 90%</Text>
        </View>

        <Text style={[styles.nearbyLine, { color: sub }]}>
          {nearbyDrivers === null
            ? '…'
            : `${nearbyDrivers} driver${nearbyDrivers === 1 ? '' : 's'} within 5 miles`}
          {pickupEtaHint ? ` · ${pickupEtaHint}` : ''}
        </Text>

        {err ? <Text style={styles.error}>{err}</Text> : null}

        <TouchableOpacity
          style={[styles.cta, { opacity: submitting ? 0.7 : 1 }]}
          onPress={() => void requestRide()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={VectaColors.primary} />
          ) : (
            <Text style={styles.ctaText}>Request Ride</Text>
          )}
        </TouchableOpacity>
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
  suggest: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  map: { width: '100%', height: 200, borderRadius: VectaRadius.lg, marginTop: 16 },
  fareCard: { marginTop: 18, padding: VectaSpacing.lg, borderRadius: VectaRadius.lg, borderWidth: 1 },
  fareTitle: { fontFamily: VectaFonts.medium, fontSize: 14 },
  fareAmt: { fontFamily: VectaFonts.bold, fontSize: 28, marginTop: 6 },
  fareMeta: { fontFamily: VectaFonts.regular, fontSize: 13, marginTop: 4 },
  nearbyLine: { fontFamily: VectaFonts.regular, fontSize: 14, marginTop: 14, textAlign: 'center' },
  warn: { fontFamily: VectaFonts.regular, fontSize: 13, marginTop: 12 },
  error: { color: VectaColors.error, fontFamily: VectaFonts.regular, marginTop: 12, textAlign: 'center' },
  cta: {
    marginTop: 20,
    backgroundColor: VectaColors.accent,
    paddingVertical: 16,
    borderRadius: VectaRadius.md,
    alignItems: 'center',
  },
  ctaText: { fontFamily: VectaFonts.bold, fontSize: 17, color: VectaColors.primary },
});
