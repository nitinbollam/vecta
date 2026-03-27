// apps/student-app/src/app/(tabs)/index.tsx
// ─── Vecta Student App — "Day 0" Mobile Dashboard ─────────────────────────────

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useStudentStore } from '@/store/student.store';
import { useBalanceStore } from '@/store/balance.store';
import { useHousingStore, useMobilityStore } from '@/stores';
import { VectaIDStatusBadge } from '@/components/VectaIDStatusBadge';
import { ModuleCard } from '@/components/ModuleCard';
import { VectaColors, VectaFonts } from '@/constants/design';

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  // Selectors: component only re-renders when these specific values change,
  // not on every isLoading flip from any store.
  const profile        = useStudentStore((s) => s.profile);
  const authToken      = useStudentStore((s) => s.authToken);
  const profileLoading = useStudentStore((s) => s.isLoading);
  const fetchProfile   = useStudentStore((s) => s.fetchProfile);

  const balance        = useBalanceStore((s) => s.balance);
  const balanceLoading = useBalanceStore((s) => s.isLoading);
  const fetchBalance   = useBalanceStore((s) => s.fetchBalance);

  const trustScore     = useHousingStore((s) => s.trustScore);
  const activeLoC      = useHousingStore((s) => s.activeLoC);
  const housingLoading = useHousingStore((s) => s.isLoading);
  const fetchTrustScore = useHousingStore((s) => s.fetchTrustScore);

  const vehicles       = useMobilityStore((s) => s.vehicles);
  const earnings       = useMobilityStore((s) => s.earnings);
  const mobilityLoading = useMobilityStore((s) => s.isLoading);
  const fetchVehicles  = useMobilityStore((s) => s.fetchVehicles);
  const fetchEarnings  = useMobilityStore((s) => s.fetchEarnings);

  const isLoading = profileLoading || balanceLoading;
  const [refreshing, setRefreshing] = React.useState(false);

  const loadAll = React.useCallback(async () => {
    await Promise.all([fetchProfile(), fetchBalance(), fetchTrustScore(), fetchVehicles(), fetchEarnings()]);
  }, [fetchProfile, fetchBalance, fetchTrustScore, fetchVehicles, fetchEarnings]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleShareVectaID = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/profile/tokens');
  };

  const handleEnrollVehicle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (profile?.kycStatus !== 'APPROVED') {
      Alert.alert(
        'Banking Required',
        'Complete your Vecta banking setup before enrolling a vehicle.',
        [{ text: 'Got it' }],
      );
      return;
    }
    router.push('/mobility/enroll');
  };

  if (isLoading && !profile) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={VectaColors.primary} />
        <Text style={styles.loadingText}>Loading your Vecta dashboard…</Text>
      </SafeAreaView>
    );
  }

  if (!profile || !authToken) {
    return (
      <SafeAreaView style={styles.center}>
        <Pressable style={styles.retryButton} onPress={() => router.replace('/auth/login')}>
          <Text style={styles.retryText}>Sign In</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const hasVehicle = vehicles.length > 0;
  const ytdIncomeUSD = ((earnings?.ytdRentalIncome ?? 0)).toFixed(2);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={VectaColors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Hero Header ─────────────────────────────────────────────── */}
        <LinearGradient
          colors={['#001F3F', '#001A33']}
          style={styles.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.heroContent}>
            <View style={styles.heroLeft}>
              <Text style={styles.greetingText}>
                Welcome back,{'\n'}
                <Text style={styles.nameText}>{profile.fullName.split(' ')[0]}</Text>
              </Text>
              <Text style={styles.universityText}>{profile.universityName}</Text>
              <VectaIDStatusBadge status={profile.vectaIdStatus} />
            </View>
            {profile.selfieUrl ? (
              <Image
                source={{ uri: profile.selfieUrl }}
                style={styles.profilePhoto}
                contentFit="cover"
                accessibilityLabel="Your verified profile photo"
              />
            ) : (
              <View style={styles.profilePhotoPlaceholder}>
                <Text style={styles.profileInitial}>{profile.fullName[0] ?? '?'}</Text>
              </View>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [styles.shareIdButton, pressed && styles.pressed]}
            onPress={handleShareVectaID}
            accessibilityRole="button"
            accessibilityLabel="Share your Vecta ID with a landlord"
          >
            <Text style={styles.shareIdButtonText}>🔐 Share Vecta ID with Landlord</Text>
          </Pressable>
        </LinearGradient>

        {/* ─── Module Cards ─────────────────────────────────────────────── */}
        <View style={styles.modulesContainer}>

          {/* US Banking */}
          <ModuleCard
            testID="banking-card"
            icon="🏦"
            title="US Bank Account"
            status={profile.kycStatus === 'APPROVED' ? 'active' : 'pending'}
            onPress={() => router.push('/(tabs)/banking')}
            isLoading={balanceLoading}
          >
            {balance ? (
              <View>
                <Text style={styles.balanceLabel}>Masked Balance Range</Text>
                <Text style={styles.balanceAmount}>{balance.rangeLabel}</Text>
                <Text style={styles.accountSubtext}>
                  Vecta Checking •••• {balance.unitAccountLast4 ?? '——'}
                </Text>
              </View>
            ) : (
              <Text style={styles.moduleSubtext}>
                {profile.kycStatus === 'APPROVED'
                  ? 'Tap to view your Vecta banking details'
                  : 'Complete identity verification to open your account'}
              </Text>
            )}
          </ModuleCard>

          {/* Housing Guarantee */}
          <ModuleCard
            testID="housing-card"
            icon="🏠"
            title="Housing Guarantee"
            status={activeLoC ? 'active' : 'pending'}
            onPress={() => router.push('/(tabs)/housing')}
            isLoading={housingLoading}
          >
            {trustScore ? (
              <View>
                <View style={styles.trustScoreRow}>
                  <Text style={styles.trustScoreValue}>{trustScore.score}</Text>
                  <Text style={styles.trustScoreTier}>{trustScore.tier}</Text>
                </View>
                {activeLoC && (
                  <Text style={styles.solvencyBadge}>
                    ✅ SOLVENT: {activeLoC.guaranteeMonths} Months Guaranteed
                  </Text>
                )}
                {activeLoC && (
                  <Text style={styles.locReady}>Letter of Credit: Ready to Share</Text>
                )}
              </View>
            ) : (
              <Text style={styles.moduleSubtext}>
                Connect your bank account to generate a Letter of Credit
              </Text>
            )}
          </ModuleCard>

          {/* AI Roommate Finder */}
          <ModuleCard
            testID="roommates-card"
            icon="🤝"
            title="AI Roommate Finder"
            status="pending"
            onPress={() => router.push('/housing/roommate')}
          >
            <Text style={styles.moduleSubtext}>
              Find compatible roommates at {profile.universityName}
            </Text>
          </ModuleCard>

          {/* Mobility / Fleet */}
          <ModuleCard
            testID="mobility-card"
            icon="🚗"
            title={profile.role === 'LESSOR' ? 'Fleet Earnings' : 'Passive Vehicle Income'}
            status={hasVehicle ? 'active' : 'idle'}
            onPress={hasVehicle ? () => router.push('/(tabs)/mobility') : handleEnrollVehicle}
            isLoading={mobilityLoading}
          >
            {hasVehicle ? (
              <View>
                <Text style={styles.earningsLabel}>YTD Rental Income</Text>
                <Text style={styles.earningsAmount}>${ytdIncomeUSD}</Text>
                <Text style={styles.taxBadge}>📋 Schedule E — Passive Rental Income</Text>
                <Text style={styles.flightRecorderBadge}>🔒 Flight Recorder: Active</Text>
              </View>
            ) : (
              <View>
                <Text style={styles.moduleSubtext}>
                  Enroll your vehicle to earn passive rental income.
                </Text>
                <Text style={styles.complianceNote}>F-1 Visa Compliant · 1099-MISC · Schedule E</Text>
                <Pressable style={styles.enrollButton} onPress={handleEnrollVehicle}>
                  <Text style={styles.enrollButtonText}>Enroll Vehicle →</Text>
                </Pressable>
              </View>
            )}
          </ModuleCard>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F4F4F4' },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  scrollContent: { paddingBottom: 40 },

  heroGradient:           { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroContent:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  heroLeft:               { flex: 1, gap: 8 },
  greetingText:           { fontSize: 16, color: 'rgba(255,255,255,0.85)', fontFamily: VectaFonts.regular },
  nameText:               { fontSize: 26, color: '#FFFFFF', fontFamily: VectaFonts.bold },
  universityText:         { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: VectaFonts.regular },
  profilePhoto:           { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  profilePhotoPlaceholder:{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  profileInitial:         { fontSize: 24, color: '#FFF', fontFamily: VectaFonts.bold },
  shareIdButton:          { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  shareIdButtonText:      { color: '#FFFFFF', fontSize: 15, fontFamily: VectaFonts.semiBold },
  pressed:                { opacity: 0.75 },

  modulesContainer: { paddingHorizontal: 16, paddingTop: 20, gap: 14 },

  balanceLabel:   { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginBottom: 2 },
  balanceAmount:  { fontSize: 22, color: VectaColors.text, fontFamily: VectaFonts.bold },
  accountSubtext: { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginTop: 4 },

  trustScoreRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  trustScoreValue:{ fontSize: 32, color: VectaColors.text, fontFamily: VectaFonts.bold },
  trustScoreTier: { fontSize: 14, color: VectaColors.success, fontFamily: VectaFonts.semiBold },
  solvencyBadge:  { fontSize: 13, color: VectaColors.success, fontFamily: VectaFonts.semiBold, marginBottom: 4 },
  locReady:       { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },

  earningsLabel:        { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },
  earningsAmount:       { fontSize: 28, color: VectaColors.text, fontFamily: VectaFonts.bold, marginBottom: 6 },
  taxBadge:             { fontSize: 12, color: VectaColors.info, fontFamily: VectaFonts.regular, marginBottom: 2 },
  flightRecorderBadge:  { fontSize: 12, color: VectaColors.success, fontFamily: VectaFonts.regular },
  complianceNote:       { fontSize: 11, color: VectaColors.success, fontFamily: VectaFonts.regular, marginTop: 4, marginBottom: 10 },
  enrollButton:         { backgroundColor: '#001F3F', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  enrollButtonText:     { color: '#FFF', fontSize: 14, fontFamily: VectaFonts.semiBold },

  moduleSubtext: { fontSize: 13, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },
  loadingText:   { color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginTop: 12 },
  retryButton:   { marginTop: 12, backgroundColor: '#001F3F', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  retryText:     { color: '#FFF', fontFamily: VectaFonts.semiBold },
});
