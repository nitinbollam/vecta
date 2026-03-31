import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { VectaColors, VectaFonts, VectaRadius, VectaSpacing } from '../constants/theme';
import { API_V1_BASE, getAuthHeaders } from '../config/api';

interface NoDriverFallbackProps {
  rideId?: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  estimatedMiles: number;
  waitMinutes?: number;
  onScheduleChosen?: () => void;
}

export default function NoDriverFallback({
  rideId: _rideId,
  pickupLat,
  pickupLng,
  pickupAddress,
  dropoffLat,
  dropoffLng,
  dropoffAddress,
  estimatedMiles,
  waitMinutes = 0,
  onScheduleChosen,
}: NoDriverFallbackProps) {
  const { colors, isDark } = useTheme();
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const handleSchedule = () => {
    router.push(
      `/mobility/book-ride?` +
        `scheduleMode=true` +
        `&pickupLat=${pickupLat}&pickupLng=${pickupLng}` +
        `&pickupAddress=${encodeURIComponent(pickupAddress)}` +
        `&dropoffLat=${dropoffLat}&dropoffLng=${dropoffLng}` +
        `&dropoffAddress=${encodeURIComponent(dropoffAddress)}` +
        `&miles=${estimatedMiles}`,
    );
    onScheduleChosen?.();
  };

  const handleInviteDriver = async () => {
    try {
      setLoadingInvite(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/referral/driver`, {
        method: 'POST',
        headers,
      });
      const data = (await res.json()) as {
        inviteCode: string;
        shareUrl: string;
        shareMessage: string;
      };

      if (!res.ok) throw new Error('bad response');

      setInviteCode(data.inviteCode);

      await Share.share({
        message: data.shareMessage,
        url: data.shareUrl,
        title: 'Drive with Vecta — earn money on campus',
      });
    } catch {
      Alert.alert('Error', 'Could not generate invite link. Please try again.');
    } finally {
      setLoadingInvite(false);
    }
  };

  const bg = isDark ? '#0F1628' : '#FFFFFF';
  const sub = isDark ? '#A8B8C8' : '#5A7080';
  const warn = isDark ? '#1A2A1A' : '#F0FFF4';

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.heroSection}>
        <Text style={styles.heroEmoji}>🔍</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>No drivers near you right now</Text>
        <Text style={[styles.heroSub, { color: sub }]}>
          {waitMinutes > 0
            ? `Searched for ${waitMinutes} min · you have not been charged`
            : 'No active drivers in your area'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.optionCard, { borderColor: VectaColors.accent }]}
        onPress={handleSchedule}
        activeOpacity={0.85}
      >
        <View style={[styles.optionIconWrap, { backgroundColor: '#001F3F' }]}>
          <Ionicons name="calendar-outline" size={24} color={VectaColors.accent} />
        </View>
        <View style={styles.optionBody}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>Schedule for later</Text>
          <Text style={[styles.optionDesc, { color: sub }]}>
            Pick a time — we will have a driver ready. Most active 8–9am and 5–7pm.
          </Text>
          <Text style={[styles.optionNote, { color: VectaColors.accent }]}>
            Same price · Confirmed 15 min before pickup
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={VectaColors.accent} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.optionCard, { borderColor: colors.border }]}
        onPress={() => void handleInviteDriver()}
        activeOpacity={0.85}
        disabled={loadingInvite}
      >
        <View style={[styles.optionIconWrap, { backgroundColor: '#001F3F' }]}>
          {loadingInvite ? (
            <ActivityIndicator size="small" color={VectaColors.accent} />
          ) : (
            <Ionicons name="person-add-outline" size={24} color={VectaColors.accent} />
          )}
        </View>
        <View style={styles.optionBody}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>Invite a friend to drive</Text>
          <Text style={[styles.optionDesc, { color: sub }]}>
            Know someone with a car and work authorization? They earn 90% per ride on Vecta.
          </Text>
          <Text style={[styles.optionNote, { color: VectaColors.accent }]}>
            You both get Vecta credit when they complete their first ride (amount in your share link)
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={sub} />
      </TouchableOpacity>

      {inviteCode ? (
        <View style={[styles.inviteConfirm, { backgroundColor: warn }]}>
          <Text style={[styles.inviteConfirmText, { color: isDark ? '#00C896' : '#065F46' }]}>
            ✓ Invite ready! Code: {inviteCode}
          </Text>
          <Text style={[styles.inviteConfirmSub, { color: sub }]}>
            You earn referral credit when they finish their first ride.
          </Text>
        </View>
      ) : null}

      <View style={[styles.peakCard, { backgroundColor: isDark ? '#1A2838' : '#EFF6FF' }]}>
        <Text style={[styles.peakTitle, { color: colors.text }]}>📅 When drivers are most active</Text>
        {[
          { time: 'Morning', hours: '7:30 – 9:30 am', note: 'Campus commute' },
          { time: 'Midday', hours: '11 am – 1 pm', note: 'Lunch runs' },
          { time: 'Evening', hours: '4:30 – 7 pm', note: 'End of day' },
          { time: 'Late night', hours: '10 pm – midnight', note: 'Weekends especially' },
        ].map((row) => (
          <View key={row.time} style={styles.peakRow}>
            <Text style={[styles.peakTime, { color: VectaColors.accent }]}>{row.hours}</Text>
            <Text style={[styles.peakNote, { color: sub }]}>{row.note}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: VectaSpacing.lg,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  heroEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  heroTitle: {
    fontFamily: VectaFonts.bold,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSub: {
    fontFamily: VectaFonts.regular,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: VectaSpacing.md,
    borderRadius: VectaRadius.lg,
    borderWidth: 1.5,
    marginBottom: 12,
    gap: 12,
  },
  optionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBody: { flex: 1 },
  optionTitle: {
    fontFamily: VectaFonts.semiBold,
    fontSize: 16,
    marginBottom: 4,
  },
  optionDesc: {
    fontFamily: VectaFonts.regular,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  optionNote: {
    fontFamily: VectaFonts.medium,
    fontSize: 12,
  },
  inviteConfirm: {
    padding: 12,
    borderRadius: VectaRadius.md,
    marginBottom: 12,
  },
  inviteConfirmText: {
    fontFamily: VectaFonts.semiBold,
    fontSize: 14,
    marginBottom: 2,
  },
  inviteConfirmSub: {
    fontFamily: VectaFonts.regular,
    fontSize: 12,
  },
  peakCard: {
    padding: VectaSpacing.md,
    borderRadius: VectaRadius.lg,
    marginTop: 4,
  },
  peakTitle: {
    fontFamily: VectaFonts.semiBold,
    fontSize: 14,
    marginBottom: 10,
  },
  peakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  peakTime: {
    fontFamily: VectaFonts.medium,
    fontSize: 13,
  },
  peakNote: {
    fontFamily: VectaFonts.regular,
    fontSize: 12,
  },
});
