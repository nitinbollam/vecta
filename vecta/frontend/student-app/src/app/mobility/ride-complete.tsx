/**
 * Post-ride summary and driver rating.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function RideCompleteScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [miles, setMiles] = useState<string>('—');
  const [fare, setFare] = useState<string>('—');
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!rideId) {
        setLoading(false);
        return;
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_V1_BASE}/mobility/rides/${rideId}`, { headers });
        if (!res.ok) throw new Error('load');
        const r = (await res.json()) as {
          driver_name?: string | null;
          actual_miles?: string | null;
          actual_fare_cents?: number | null;
        };
        setDriverName(r.driver_name ?? 'your driver');
        if (r.actual_miles != null) setMiles(Number(r.actual_miles).toFixed(1));
        if (r.actual_fare_cents != null) setFare(`$${(r.actual_fare_cents / 100).toFixed(2)}`);
      } catch {
        setErr('Could not load trip summary.');
      } finally {
        setLoading(false);
      }
    })();
  }, [rideId]);

  const submit = useCallback(async () => {
    if (!rideId || rating < 1) {
      setErr('Pick a star rating.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/rides/${rideId}/rate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rating, review: review.trim() || undefined }),
      });
      if (!res.ok) throw new Error('rate');
      router.replace('/(tabs)/rides');
    } catch {
      setErr('Could not submit rating.');
    } finally {
      setSubmitting(false);
    }
  }, [rideId, rating, review]);

  const surface = isDark ? VectaColors.primaryMid : VectaColors.surfaceBase;
  const sub = isDark ? '#7A9BAD' : VectaColors.textSecondary;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: surface, paddingTop: insets.top }]}>
        <ActivityIndicator color={VectaColors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: surface, paddingTop: insets.top, paddingHorizontal: VectaSpacing.lg }}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Ionicons name="checkmark-circle" size={56} color={VectaColors.success} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Ride complete!</Text>
      </View>

      <View style={[styles.card, { backgroundColor: isDark ? '#152238' : VectaColors.surface1, borderColor: colors.border }]}>
        <Text style={[styles.row, { color: colors.text }]}>Distance: {miles} mi</Text>
        <Text style={[styles.row, { color: colors.text }]}>Fare: {fare}</Text>
        <Text style={[styles.note, { color: sub }]}>Charged to your Vecta account</Text>
      </View>

      <Text style={[styles.q, { color: colors.text }]}>How was your ride with {driverName}?</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)} hitSlop={8}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={36} color={VectaColors.accent} />
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#152238' : VectaColors.surface1 }]}
        placeholder="Optional review"
        placeholderTextColor={sub}
        value={review}
        onChangeText={setReview}
        multiline
      />

      {err ? <Text style={styles.error}>{err}</Text> : null}

      <TouchableOpacity
        style={[styles.cta, { opacity: submitting ? 0.7 : 1 }]}
        onPress={() => void submit()}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={VectaColors.primary} />
        ) : (
          <Text style={styles.ctaText}>Submit Rating</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={() => router.replace('/(tabs)/rides')}>
        <Text style={{ color: sub, fontFamily: VectaFonts.regular }}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hero: { alignItems: 'center', marginTop: 24 },
  check: { marginBottom: 8 },
  title: { fontFamily: VectaFonts.bold, fontSize: 26 },
  card: {
    marginTop: 24,
    padding: VectaSpacing.lg,
    borderRadius: VectaRadius.lg,
    borderWidth: 1,
  },
  row: { fontFamily: VectaFonts.medium, fontSize: 16, marginBottom: 6 },
  note: { fontFamily: VectaFonts.regular, fontSize: 13, marginTop: 4 },
  q: { fontFamily: VectaFonts.semiBold, fontSize: 17, marginTop: 28 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 },
  input: {
    marginTop: 16,
    minHeight: 80,
    borderWidth: 1,
    borderRadius: VectaRadius.md,
    padding: 12,
    fontFamily: VectaFonts.regular,
    textAlignVertical: 'top',
  },
  error: { color: VectaColors.error, marginTop: 12, textAlign: 'center', fontFamily: VectaFonts.regular },
  cta: {
    marginTop: 20,
    backgroundColor: VectaColors.accent,
    paddingVertical: 16,
    borderRadius: VectaRadius.md,
    alignItems: 'center',
  },
  ctaText: { fontFamily: VectaFonts.bold, fontSize: 17, color: VectaColors.primary },
});
