// apps/student-app/src/app/mobility/enroll.tsx
// ─── The "Ironclad F-1" Vehicle Enrollment Disclaimer Screen ─────────────────
// All 4 checkboxes must be individually toggled before enrollment proceeds.
// The exact wording below is the legally approved copy — do not change without counsel.

import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useStudentStore } from "@/store/student.store";
import { VectaColors, VectaFonts } from "@/constants/design";
import { API_V1_BASE } from "@/config/api";
import { useTheme } from "@/context/ThemeContext";

interface ConsentClauses {
  strictlyPassive: boolean;
  taxClassification: boolean;
  flightRecorder: boolean;
  independentCounsel: boolean;
}

const DISCLAIMER_CLAUSES = [
  {
    key: "strictlyPassive" as keyof ConsentClauses,
    title: 'The "Strictly Passive" Acknowledgment',
    body: `By enrolling my vehicle in the Vecta Fleet, I am acting solely as a passive lessor of a capital asset (my vehicle). I am strictly prohibited from driving my own vehicle for Vecta Rides customers, maintaining the vehicle between rides on Vecta's behalf, or engaging in any active management of the fleet. I understand that active participation constitutes unauthorized employment under F-1 visa regulations.`,
  },
  {
    key: "taxClassification" as keyof ConsentClauses,
    title: "Tax Classification (Schedule E) Clause",
    body: `I acknowledge that any funds generated from this lease-back agreement will be reported to the IRS as Passive Rental Income on Schedule E of Form 1040-NR. Vecta will issue a Form 1099-MISC (Box 1: Rents), not a 1099-NEC (Nonemployee Compensation). I understand this structure is designed to comply with F-1 visa restrictions prohibiting active business income (Schedule C).`,
  },
  {
    key: "flightRecorder" as keyof ConsentClauses,
    title: 'The "Flight Recorder" Audit Consent',
    body: `To protect my F-1 visa status in the event of a USCIS or IRS audit, I authorize Vecta to log the GPS telemetry, driver assignments, and financial ledger of my vehicle. This "Flight Recorder" data will serve as legal proof that I was physically separate from the vehicle's operation while it was generating rental income.`,
  },
  {
    key: "independentCounsel" as keyof ConsentClauses,
    title: "Independent Counsel Waiver",
    body: `While Vecta's architecture is built to align with US tax and immigration guidelines, Vecta does not provide legal or tax advice. I am solely responsible for maintaining my F-1 visa status and am encouraged to consult my university's Designated School Official (DSO) or an immigration attorney before proceeding.`,
  },
];

export default function VehicleEnrollmentScreen() {
  const { colors }  = useTheme();
  const authToken   = useStudentStore((s) => s.authToken);
  const profile     = useStudentStore((s) => s.profile);
  const [clauses, setClauses] = useState<ConsentClauses>({
    strictlyPassive: false,
    taxClassification: false,
    flightRecorder: false,
    independentCounsel: false,
  });
  const [submitting, setSubmitting] = useState(false);

  // All 4 must be true to enable the enroll button
  const allAcknowledged = Object.values(clauses).every(Boolean);

  const toggleClause = async (key: keyof ConsentClauses, value: boolean) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setClauses((prev) => ({ ...prev, [key]: value }));
  };

  const handleEnroll = async () => {
    if (!allAcknowledged) return;

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Alert.alert(
      "Confirm Vehicle Enrollment",
      "By confirming, you are signing the Vecta Asset Lease Agreement. " +
      "Your signed consent (including timestamp, IP address, and this TOS version) " +
      "will be permanently recorded for compliance purposes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm & Enroll",
          style: "default",
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await fetch(
                `${API_V1_BASE}/mobility/enroll-vehicle`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    studentId: profile?.id,
                    consentClauses: {
                      strictlyPassiveAcknowledged: clauses.strictlyPassive,
                      taxClassificationAcknowledged: clauses.taxClassification,
                      flightRecorderConsentAcknowledged: clauses.flightRecorder,
                      independentCounselWaiverAcknowledged: clauses.independentCounsel,
                    },
                    // Vehicle details collected on the previous screen (via route params)
                    tosVersion: "2.1.0",
                  }),
                }
              );

              if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message ?? "Enrollment failed");
              }

              router.replace("/mobility/enrolled-success");
            } catch (err) {
              Alert.alert("Enrollment Failed", (err as Error).message);
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface1 }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Vehicle Enrollment Agreement</Text>
            <Text style={styles.headerSubtitle}>
              Please read each clause carefully and toggle to acknowledge.{"\n"}
              All four acknowledgments are required.
            </Text>
            <View style={styles.complianceBadge}>
              <Text style={styles.complianceBadgeText}>
                🛡️ F-1 Visa Compliance Framework · TOS v2.1.0
              </Text>
            </View>
          </View>

          {/* Disclaimer Clauses */}
          {DISCLAIMER_CLAUSES.map((clause, index) => (
            <View key={clause.key} style={styles.clauseCard}>
              <View style={styles.clauseHeader}>
                <View style={styles.clauseNumberBadge}>
                  <Text style={styles.clauseNumber}>{index + 1}</Text>
                </View>
                <Text style={styles.clauseTitle}>{clause.title}</Text>
              </View>

              <Text style={styles.clauseBody}>{clause.body}</Text>

              <View style={styles.acknowledgmentRow}>
                <View style={styles.acknowledgmentLeft}>
                  <Text style={styles.acknowledgmentLabel}>
                    {clauses[clause.key]
                      ? "✅ Acknowledged"
                      : "⬜ Tap to acknowledge"}
                  </Text>
                </View>
                <Switch
                  value={clauses[clause.key]}
                  onValueChange={(val) => toggleClause(clause.key, val)}
                  trackColor={{
                    false: VectaColors.borderLight,
                    true: VectaColors.success,
                  }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel={`Acknowledge: ${clause.title}`}
                  accessibilityRole="switch"
                />
              </View>
            </View>
          ))}

          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              {Object.values(clauses).filter(Boolean).length} of 4 clauses acknowledged
            </Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${(Object.values(clauses).filter(Boolean).length / 4) * 100}%`,
                  },
                ]}
              />
            </View>
          </View>

          {/* Legal Footnote */}
          <Text style={styles.legalNote}>
            Your enrollment will be recorded with your full name, timestamp, IP address,
            and user agent per Vecta's compliance requirements. This constitutes a legally
            binding electronic signature under the ESIGN Act (15 U.S.C. § 7001).
          </Text>

          {/* Enroll Button */}
          <Pressable
            style={[
              styles.enrollButton,
              !allAcknowledged && styles.enrollButtonDisabled,
              submitting && styles.enrollButtonSubmitting,
            ]}
            onPress={handleEnroll}
            disabled={!allAcknowledged || submitting}
            accessibilityRole="button"
            accessibilityLabel="Enroll vehicle"
            accessibilityState={{ disabled: !allAcknowledged }}
          >
            <Text style={styles.enrollButtonText}>
              {submitting
                ? "Processing…"
                : allAcknowledged
                ? "✓ Sign & Enroll Vehicle"
                : `Acknowledge all 4 clauses to continue`}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: VectaColors.background },
  scrollContent: { padding: 20, paddingBottom: 40 },

  header: { marginBottom: 24 },
  headerTitle: { fontSize: 22, fontFamily: VectaFonts.bold, color: VectaColors.textPrimary, marginBottom: 8 },
  headerSubtitle: { fontSize: 14, fontFamily: VectaFonts.regular, color: VectaColors.textSecondary, lineHeight: 20 },
  complianceBadge: { marginTop: 12, backgroundColor: VectaColors.infoBg, borderRadius: 8, padding: 10 },
  complianceBadgeText: { fontSize: 12, fontFamily: VectaFonts.semibold, color: VectaColors.info },

  clauseCard: {
    backgroundColor: VectaColors.cardBackground,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: VectaColors.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  clauseHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  clauseNumberBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: VectaColors.primary,
    justifyContent: "center", alignItems: "center",
  },
  clauseNumber: { fontSize: 13, fontFamily: VectaFonts.bold, color: "#FFF" },
  clauseTitle: { flex: 1, fontSize: 15, fontFamily: VectaFonts.semibold, color: VectaColors.textPrimary },
  clauseBody: { fontSize: 13, fontFamily: VectaFonts.regular, color: VectaColors.textSecondary, lineHeight: 20, marginBottom: 16 },
  acknowledgmentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  acknowledgmentLeft: { flex: 1 },
  acknowledgmentLabel: { fontSize: 13, fontFamily: VectaFonts.semibold, color: VectaColors.textPrimary },

  progressContainer: { marginTop: 8, marginBottom: 16 },
  progressText: { fontSize: 13, fontFamily: VectaFonts.regular, color: VectaColors.textSecondary, marginBottom: 8 },
  progressBar: { height: 4, backgroundColor: VectaColors.borderLight, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: VectaColors.success, borderRadius: 2 },

  legalNote: { fontSize: 11, fontFamily: VectaFonts.regular, color: VectaColors.textTertiary, lineHeight: 16, marginBottom: 24, textAlign: "center" },

  enrollButton: { backgroundColor: VectaColors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  enrollButtonDisabled: { backgroundColor: VectaColors.borderLight },
  enrollButtonSubmitting: { backgroundColor: VectaColors.primaryMuted },
  enrollButtonText: { fontSize: 16, fontFamily: VectaFonts.bold, color: "#FFFFFF" },
});
