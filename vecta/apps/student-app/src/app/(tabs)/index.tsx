// apps/student-app/src/app/(tabs)/index.tsx
// ─── Vecta Student App — "Day 0" Mobile Dashboard ─────────────────────────────
// Displays: Vecta ID status, US Bank Balance, eSIM, Housing Guarantee
// Runs on iOS, Android, and Web via Expo

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions,
  Alert,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useStudentStore } from "@/store/student.store";
import { useBalanceStore } from "@/store/balance.store";
import { VectaIDStatusBadge } from "@/components/VectaIDStatusBadge";
import { ModuleCard } from "@/components/ModuleCard";
import { VectaColors, VectaFonts } from "@/constants/design";
import type { VectaIDStatus, StudentRole } from "@vecta/types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  student: {
    id: string;
    legalName: string;
    facePhotoUrl: string;
    vectaIdStatus: VectaIDStatus;
    roles: StudentRole[];
    visaType: string;
    universityName: string;
  };
  banking: {
    availableBalance: number;
    currency: "USD";
    accountLast4: string;
    kycStatus: string;
  } | null;
  esim: {
    usPhoneNumber: string;
    plan: string;
    activatedAt: string;
  } | null;
  housing: {
    trustScore: number;
    trustScoreTier: string;
    letterOfCreditId: string | null;
    solvencyGuaranteeMonths: number;
  } | null;
  mobility: {
    isLessor: boolean;
    vehicleEnrolled: boolean;
    ytdRentalIncomeCents: number;
    activeLeaseId: string | null;
  } | null;
}

// ─── Dashboard Screen ─────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { studentId, accessToken } = useStudentStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (!studentId || !accessToken) return;

    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/v1/students/${studentId}/dashboard`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/auth/login");
          return;
        }
        throw new Error(`Dashboard fetch failed: ${res.status}`);
      }

      const json = await res.json() as DashboardData;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentId, accessToken]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleShareVectaID = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/identity/share-token");
  };

  const handleEnrollVehicle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Check all prerequisites are met before navigating to enrollment
    if (!data?.banking || data.banking.kycStatus !== "APPROVED") {
      Alert.alert(
        "Banking Required",
        "Please complete your Vecta banking setup before enrolling a vehicle.",
        [{ text: "Set Up Banking", onPress: () => router.push("/banking/setup") }]
      );
      return;
    }
    router.push("/mobility/enroll");
  };

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={VectaColors.primary} />
        <Text style={styles.loadingText}>Loading your Vecta dashboard…</Text>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>⚠️ {error ?? "Unable to load dashboard"}</Text>
        <Pressable style={styles.retryButton} onPress={() => fetchDashboard()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const ytdIncomeUSD = ((data.mobility?.ytdRentalIncomeCents ?? 0) / 100).toFixed(2);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchDashboard(true)}
            tintColor={'#001F3F'}
          />
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
                Welcome back,{"\n"}
                <Text style={styles.nameText}>
                  {data.student.legalName.split(" ")[0]}
                </Text>
              </Text>
              <Text style={styles.universityText}>{data.student.universityName}</Text>
              <VectaIDStatusBadge status={data.student.vectaIdStatus} />
            </View>
            {data.student.facePhotoUrl ? (
              <Image
                source={{ uri: data.student.facePhotoUrl }}
                style={styles.profilePhoto}
                contentFit="cover"
                accessibilityLabel="Your verified profile photo"
              />
            ) : (
              <View style={styles.profilePhotoPlaceholder}>
                <Text style={styles.profileInitial}>
                  {data.student.legalName[0] ?? "?"}
                </Text>
              </View>
            )}
          </View>

          {/* Share Vecta ID CTA */}
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

          {/* US Banking Card */}
          <ModuleCard
            testID="banking-card"
            icon="🏦"
            title="US Bank Account"
            status={data.banking?.kycStatus === "APPROVED" ? "active" : "pending"}
            onPress={() => router.push("/banking/account")}
          >
            {data.banking ? (
              <View>
                <Text style={styles.balanceLabel}>Available Balance</Text>
                <Text style={styles.balanceAmount}>
                  ${(data.banking.availableBalance / 100).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text style={styles.accountSubtext}>
                  Vecta Checking •••• {data.banking.accountLast4}
                </Text>
              </View>
            ) : (
              <Text style={styles.moduleSubtext}>
                Tap to set up your Vecta US bank account
              </Text>
            )}
          </ModuleCard>

          {/* eSIM Card */}
          <ModuleCard
            testID="esim-card"
            icon="📱"
            title="US Phone Number"
            status={data.esim ? "active" : "pending"}
            onPress={() => router.push("/esim/manage")}
          >
            {data.esim ? (
              <View>
                <Text style={styles.phoneNumber}>{data.esim.usPhoneNumber}</Text>
                <Text style={styles.moduleSubtext}>{data.esim.plan} • Active</Text>
              </View>
            ) : (
              <Text style={styles.moduleSubtext}>Activate your US eSIM</Text>
            )}
          </ModuleCard>

          {/* Housing Guarantee Card */}
          <ModuleCard
            testID="housing-card"
            icon="🏠"
            title="Housing Guarantee"
            status={data.housing?.letterOfCreditId ? "active" : "pending"}
            onPress={() => router.push("/housing/guarantee")}
          >
            {data.housing ? (
              <View>
                <View style={styles.trustScoreRow}>
                  <Text style={styles.trustScoreValue}>{data.housing.trustScore}</Text>
                  <Text style={styles.trustScoreTier}>{data.housing.trustScoreTier}</Text>
                </View>
                <Text style={styles.solvencyBadge}>
                  ✅ SOLVENT: {data.housing.solvencyGuaranteeMonths} Months Guaranteed
                </Text>
                {data.housing.letterOfCreditId && (
                  <Text style={styles.locReady}>Letter of Credit: Ready to Share</Text>
                )}
              </View>
            ) : (
              <Text style={styles.moduleSubtext}>
                Connect bank account to generate Letter of Credit
              </Text>
            )}
          </ModuleCard>

          {/* Roommate Finder Card */}
          <ModuleCard
            testID="roommates-card"
            icon="🤝"
            title="AI Roommate Finder"
            status="pending"
            onPress={() => router.push("/housing/roommates")}
          >
            <Text style={styles.moduleSubtext}>
              Find compatible roommates at {data.student.universityName}
            </Text>
          </ModuleCard>

          {/* Mobility / Fleet Earnings Card */}
          <ModuleCard
            testID="mobility-card"
            icon="🚗"
            title={data.mobility?.isLessor ? "Fleet Earnings" : "Passive Vehicle Income"}
            status={data.mobility?.vehicleEnrolled ? "active" : "idle"}
            onPress={
              data.mobility?.vehicleEnrolled
                ? () => router.push("/mobility/earnings")
                : handleEnrollVehicle
            }
          >
            {data.mobility?.vehicleEnrolled ? (
              <View>
                <Text style={styles.earningsLabel}>YTD Rental Income</Text>
                <Text style={styles.earningsAmount}>${ytdIncomeUSD}</Text>
                <Text style={styles.taxBadge}>
                  📋 Schedule E — Passive Rental Income
                </Text>
                <Text style={styles.flightRecorderBadge}>
                  🔒 Flight Recorder: Active
                </Text>
              </View>
            ) : (
              <View>
                <Text style={styles.moduleSubtext}>
                  Enroll your vehicle to earn passive rental income.
                </Text>
                <Text style={styles.complianceNote}>
                  F-1 Visa Compliant · 1099-MISC · Schedule E
                </Text>
                <Pressable
                  style={styles.enrollButton}
                  onPress={handleEnrollVehicle}
                  accessibilityRole="button"
                >
                  <Text style={styles.enrollButtonText}>Enroll Vehicle →</Text>
                </Pressable>
              </View>
            )}
          </ModuleCard>

          {/* DSO Memo (only for Lessors) */}
          {data.mobility?.isLessor && (
            <ModuleCard
              testID="dso-memo-card"
              icon="📄"
              title="DSO Compliance Memo"
              status="active"
              onPress={() => router.push("/mobility/dso-memo")}
            >
              <Text style={styles.moduleSubtext}>
                Auto-generated memo for your Designated School Official.
              </Text>
              <Text style={styles.dsoSubtext}>
                Proves your income is 100% passive — protects your F-1 status.
              </Text>
            </ModuleCard>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F4' },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  scrollContent: { paddingBottom: 40 },

  // Hero
  heroGradient: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heroLeft: { flex: 1, gap: 8 },
  greetingText: { fontSize: 16, color: "rgba(255,255,255,0.85)", fontFamily: VectaFonts.regular },
  nameText: { fontSize: 26, color: "#FFFFFF", fontFamily: VectaFonts.bold },
  universityText: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: VectaFonts.regular },
  profilePhoto: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  profilePhotoPlaceholder: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.2)", justifyContent: "center", alignItems: "center" },
  profileInitial: { fontSize: 24, color: "#FFF", fontFamily: VectaFonts.bold },
  shareIdButton: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  shareIdButtonText: { color: "#FFFFFF", fontSize: 15, fontFamily: VectaFonts.semibold },
  pressed: { opacity: 0.75 },

  // Modules
  modulesContainer: { paddingHorizontal: 16, paddingTop: 20, gap: 14 },

  // Banking
  balanceLabel: { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginBottom: 2 },
  balanceAmount: { fontSize: 28, color: VectaColors.textPrimary, fontFamily: VectaFonts.bold },
  accountSubtext: { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginTop: 4 },

  // eSIM
  phoneNumber: { fontSize: 20, color: VectaColors.textPrimary, fontFamily: VectaFonts.bold, letterSpacing: 0.5 },

  // Trust Score
  trustScoreRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  trustScoreValue: { fontSize: 32, color: VectaColors.textPrimary, fontFamily: VectaFonts.bold },
  trustScoreTier: { fontSize: 14, color: VectaColors.success, fontFamily: VectaFonts.semibold },
  solvencyBadge: { fontSize: 13, color: VectaColors.success, fontFamily: VectaFonts.semibold, marginBottom: 4 },
  locReady: { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },

  // Mobility
  earningsLabel: { fontSize: 12, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },
  earningsAmount: { fontSize: 28, color: VectaColors.textPrimary, fontFamily: VectaFonts.bold, marginBottom: 6 },
  taxBadge: { fontSize: 12, color: VectaColors.info, fontFamily: VectaFonts.regular, marginBottom: 2 },
  flightRecorderBadge: { fontSize: 12, color: VectaColors.success, fontFamily: VectaFonts.regular },
  complianceNote: { fontSize: 11, color: VectaColors.success, fontFamily: VectaFonts.regular, marginTop: 4, marginBottom: 10 },
  enrollButton: { backgroundColor: '#001F3F', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: "flex-start" },
  enrollButtonText: { color: "#FFF", fontSize: 14, fontFamily: VectaFonts.semibold },

  // DSO
  dsoSubtext: { fontSize: 11, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginTop: 4 },

  // Common
  moduleSubtext: { fontSize: 13, color: VectaColors.textSecondary, fontFamily: VectaFonts.regular },
  loadingText: { color: VectaColors.textSecondary, fontFamily: VectaFonts.regular, marginTop: 12 },
  errorText: { color: VectaColors.danger, fontFamily: VectaFonts.regular, textAlign: "center", paddingHorizontal: 24 },
  retryButton: { marginTop: 12, backgroundColor: '#001F3F', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  retryText: { color: "#FFF", fontFamily: VectaFonts.semibold },
});
