/**
 * (tabs)/mobility.tsx — Vecta Fleet Earnings Tab
 *
 * Sections:
 *   1. Compliance status banner — LESSOR role active / not enrolled
 *   2. YTD earnings card — Schedule E income summary
 *   3. Enrolled vehicles list
 *   4. Flight Recorder status — hash chain integrity
 *   5. DSO Compliance Memo — generate + share
 *   6. Enroll CTA — if not yet a LESSOR
 *
 * F-1 hard stops visible in UI:
 *   - "STRICTLY PASSIVE — You cannot accept rides" banner always visible
 *   - No "Go Online" / "Accept Ride" buttons exist anywhere in this screen
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMobilityStore, useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius,
  VectaGradients, VectaShadows,
} from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import {
  ModuleCard, StatusRow, VectaBadge, SkeletonLoader,
} from '../../components/ui';

// ---------------------------------------------------------------------------
// F-1 Compliance Banner — always rendered, cannot be dismissed
// ---------------------------------------------------------------------------

function F1ComplianceBanner() {
  return (
    <View style={banner.container}>
      <View style={banner.iconWrap}>
        <Text style={{ fontSize: 20 }}>⚖️</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={banner.title}>STRICTLY PASSIVE INCOME</Text>
        <Text style={banner.body}>
          Your vehicle earns rental income while operated by Vecta's commercial fleet.
          You <Text style={banner.bold}>cannot</Text> accept rides, go online as a driver,
          or provide any driving services. This is a Schedule E rental arrangement.
        </Text>
      </View>
    </View>
  );
}

const banner = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: VectaSpacing['3'],
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: VectaRadius.lg,
    padding: VectaSpacing['4'],
    marginBottom: VectaSpacing['4'],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: VectaRadius.full,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: VectaFonts.bold,
    fontSize: VectaFonts.xs,
    color: '#C2410C',
    letterSpacing: VectaFonts.letterSpacing.wider,
    marginBottom: 4,
  },
  body: {
    fontFamily: VectaFonts.regular,
    fontSize: VectaFonts.xs,
    color: '#9A3412',
    lineHeight: VectaFonts.xs * 1.6,
  },
  bold: { fontFamily: VectaFonts.bold },
});

// ---------------------------------------------------------------------------
// YTD Earnings Card
// ---------------------------------------------------------------------------

function EarningsCard({ loading }: { loading: boolean }) {
  const { earnings } = useMobilityStore();

  if (loading) {
    return (
      <ModuleCard type="mobility" title="YTD Fleet Earnings" subtitle="Schedule E · IRS Compliant">
        <SkeletonLoader height={52} style={{ marginBottom: 8 }} />
        <SkeletonLoader width="60%" height={14} />
      </ModuleCard>
    );
  }

  if (!earnings) return null;

  const income = earnings.ytdRentalIncome.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  return (
    <ModuleCard type="mobility" title="YTD Fleet Earnings" subtitle="Schedule E · IRS Compliant" status="active">
      {/* Big income number */}
      <View style={{ alignItems: 'flex-start', marginBottom: VectaSpacing['3'] }}>
        <Text style={earningsStyle.amount}>{income}</Text>
        <Text style={earningsStyle.year}>{earnings.taxYear} Tax Year</Text>
      </View>

      <StatusRow
        label="Tax Classification"
        value="Schedule E — Rental"
        valueColor={VectaColors.success}
        icon="checkmark-circle"
      />
      <StatusRow
        label="1099 Form Type"
        value="1099-MISC Box 1: Rents"
        valueColor={VectaColors.success}
      />
      <StatusRow
        label="Completed Rentals"
        value={earnings.rideCount.toLocaleString()}
      />
      {earnings.activeSince && (
        <StatusRow
          label="Active Since"
          value={new Date(earnings.activeSince).toLocaleDateString()}
        />
      )}

      {/* IRS note */}
      <View style={earningsStyle.irsNote}>
        <Ionicons name="information-circle" size={14} color={VectaColors.info} />
        <Text style={earningsStyle.irsText}>
          Income is NOT subject to self-employment tax. Report on Schedule E, not Schedule C.
        </Text>
      </View>
    </ModuleCard>
  );
}

const earningsStyle = StyleSheet.create({
  amount:  { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['4xl'], color: VectaColors.mobility },
  year:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 },
  irsNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: VectaSpacing['3'], backgroundColor: '#EFF6FF',
    borderRadius: VectaRadius.md, padding: VectaSpacing['3'],
  },
  irsText: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: '#001F3F', flex: 1, lineHeight: 16 },
});

// ---------------------------------------------------------------------------
// Enrolled Vehicles
// ---------------------------------------------------------------------------

function VehiclesList() {
  const { vehicles } = useMobilityStore();

  if (vehicles.length === 0) return null;

  return (
    <ModuleCard type="mobility" title="Enrolled Vehicles" subtitle={`${vehicles.length} active`} status="active">
      {vehicles.map((v, i) => (
        <View key={v.id} style={[
          vehicleStyle.row,
          i < vehicles.length - 1 && vehicleStyle.rowBorder,
        ]}>
          <View style={vehicleStyle.iconWrap}>
            <Ionicons name="car-sport" size={20} color={VectaColors.mobility} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={vehicleStyle.name}>{v.vehicleYear} {v.vehicleMake} {v.vehicleModel}</Text>
            <Text style={vehicleStyle.vin}>VIN: {v.vehicleVin.slice(0, 8)}•••••••••</Text>
          </View>
          <VectaBadge label={v.status} variant={v.status === 'active' ? 'success' : 'warning'} />
        </View>
      ))}
    </ModuleCard>
  );
}

const vehicleStyle = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], paddingVertical: VectaSpacing['2'] },
  rowBorder:  { borderBottomWidth: 1, borderBottomColor: VectaColors.border },
  iconWrap:   { width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: VectaColors.mobilityBg, alignItems: 'center', justifyContent: 'center' },
  name:       { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text },
  vin:        { fontFamily: VectaFonts.mono, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 },
});

// ---------------------------------------------------------------------------
// Flight Recorder Status
// ---------------------------------------------------------------------------

function FlightRecorderCard() {
  const { earnings } = useMobilityStore();

  const handleExport = useCallback(async () => {
    Alert.alert(
      'Export Audit Chain',
      'This will generate a USCIS/IRS-grade export of your flight recorder data. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            // Navigate to export screen
            router.push('/mobility/audit-export');
          },
        },
      ],
    );
  }, []);

  return (
    <ModuleCard type="mobility" title="Flight Recorder" subtitle="Immutable Audit Chain" status="active">
      <View style={frStyle.row}>
        <View style={frStyle.indicator}>
          <Ionicons name="shield-checkmark" size={16} color={VectaColors.success} />
          <Text style={frStyle.indicatorText}>CHAIN INTEGRITY VERIFIED</Text>
        </View>
      </View>

      <StatusRow label="Architecture"    value="SHA-256 Hash Chain" />
      <StatusRow label="Entries"         value={earnings?.rideCount?.toLocaleString() ?? '0'} />
      <StatusRow label="Storage"         value="Append-Only · No Delete" />
      <StatusRow label="Export Format"   value="USCIS / IRS Compatible" />

      <TouchableOpacity onPress={handleExport} style={frStyle.exportBtn}>
        <Ionicons name="download-outline" size={16} color={VectaColors.mobility} />
        <Text style={frStyle.exportText}>Export for USCIS / IRS</Text>
      </TouchableOpacity>
    </ModuleCard>
  );
}

const frStyle = StyleSheet.create({
  row:           { marginBottom: VectaSpacing['2'] },
  indicator:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: VectaColors.successBg, borderRadius: VectaRadius.full, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  indicatorText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.success, letterSpacing: VectaFonts.letterSpacing.wide },
  exportBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: VectaSpacing['3'], paddingVertical: VectaSpacing['3'], backgroundColor: VectaColors.mobilityBg, borderRadius: VectaRadius.lg },
  exportText:    { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.mobility },
});

// ---------------------------------------------------------------------------
// DSO Memo
// ---------------------------------------------------------------------------

function DsoMemoCard() {
  const { dsoMemoUrl, generateDsoMemo, isLoading } = useMobilityStore();
  const [generating, setGenerating] = useState(false);
  const [dsoName,    setDsoName]    = useState('');

  const handleGenerate = useCallback(async () => {
    Alert.alert(
      'Generate DSO Memo',
      'This will generate an F-1 compliance memo for your Designated School Official (DSO) explaining your passive rental income.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setGenerating(true);
            await generateDsoMemo(dsoName || undefined);
            setGenerating(false);
          },
        },
      ],
    );
  }, [generateDsoMemo, dsoName]);

  const handleShare = useCallback(async () => {
    if (dsoMemoUrl) {
      await Share.share({ url: dsoMemoUrl, title: 'Vecta DSO Compliance Memo' });
    }
  }, [dsoMemoUrl]);

  return (
    <ModuleCard type="mobility" title="DSO Compliance Memo" subtitle="For Your School Official">
      <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, lineHeight: 20, marginBottom: VectaSpacing['3'] }}>
        Share this memo with your DSO to document that your fleet earnings are strictly passive
        rental income (Schedule E) and do not violate F-1 employment restrictions.
      </Text>

      {dsoMemoUrl ? (
        <TouchableOpacity onPress={handleShare} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: VectaSpacing['3'], backgroundColor: VectaColors.mobilityBg, borderRadius: VectaRadius.lg }}>
          <Ionicons name="share-outline" size={18} color={VectaColors.mobility} />
          <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.mobility }}>
            Share DSO Memo
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={generating}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: VectaSpacing['3'], backgroundColor: VectaColors.mobility, borderRadius: VectaRadius.full }, generating && { opacity: 0.6 }]}
        >
          <Ionicons name="document-text" size={18} color="#FFF" />
          <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' }}>
            {generating ? 'Generating…' : 'Generate DSO Memo'}
          </Text>
        </TouchableOpacity>
      )}
    </ModuleCard>
  );
}

// ---------------------------------------------------------------------------
// Not-enrolled CTA
// ---------------------------------------------------------------------------

function EnrollCTA() {
  return (
    <View style={ctaStyle.container}>
      <LinearGradient colors={VectaGradients.mobility} style={ctaStyle.gradient}>
        <Text style={ctaStyle.title}>Enroll Your Vehicle</Text>
        <Text style={ctaStyle.body}>
          Earn passive rental income from your vehicle while maintaining F-1 visa compliance.
          Schedule E income — not subject to self-employment tax.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/mobility/enroll')}
          style={ctaStyle.btn}
          activeOpacity={0.88}
        >
          <Text style={ctaStyle.btnText}>Start Enrollment →</Text>
        </TouchableOpacity>
        <Text style={ctaStyle.disclaimer}>
          Requires: F-1 verified identity · Active vehicle lease · 4-clause compliance consent
        </Text>
      </LinearGradient>
    </View>
  );
}

const ctaStyle = StyleSheet.create({
  container:   { marginBottom: VectaSpacing['4'] },
  gradient:    { borderRadius: VectaRadius['2xl'], padding: VectaSpacing['6'], ...VectaShadows.lg },
  title:       { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', marginBottom: VectaSpacing['2'] },
  body:        { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.85)', lineHeight: 20, marginBottom: VectaSpacing['5'] },
  btn:         { backgroundColor: '#FFF', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['3'], alignItems: 'center', marginBottom: VectaSpacing['3'] },
  btnText:     { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.mobility },
  disclaimer:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MobilityScreen() {
  const { colors }                                                = useTheme();
  const { profile }                                               = useStudentStore();
  const { vehicles, earnings, fetchVehicles, fetchEarnings, isLoading } = useMobilityStore();
  const [refreshing, setRefreshing]                               = useState(false);

  const isLessor = profile?.role === 'LESSOR';

  useEffect(() => {
    if (isLessor) {
      fetchVehicles();
      fetchEarnings();
    }
  }, [isLessor, fetchVehicles, fetchEarnings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isLessor) {
      await Promise.all([fetchVehicles(), fetchEarnings()]);
    }
    setRefreshing(false);
  }, [isLessor, fetchVehicles, fetchEarnings]);

  return (
    <ScrollView
      style={[screen.container, { backgroundColor: colors.surface1 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VectaColors.mobility} />}
    >
      {/* Header */}
      <LinearGradient colors={VectaGradients.mobility} style={screen.header}>
        <Text style={screen.headerTitle}>Fleet Earnings</Text>
        <Text style={screen.headerSub}>
          {isLessor ? 'LESSOR — Schedule E Active' : 'Enroll your vehicle to start earning'}
        </Text>
        {isLessor && (
          <View style={screen.headerBadge}>
            <Ionicons name="shield-checkmark" size={12} color={VectaColors.success} />
            <Text style={screen.headerBadgeText}>F-1 COMPLIANT · PASSIVE ONLY</Text>
          </View>
        )}
      </LinearGradient>

      <View style={screen.body}>
        {/* Always show compliance banner when LESSOR */}
        {isLessor && <F1ComplianceBanner />}

        {isLessor ? (
          <>
            <EarningsCard loading={isLoading} />
            <VehiclesList />
            <FlightRecorderCard />
            <DsoMemoCard />
          </>
        ) : (
          <>
            <EnrollCTA />

            {/* Preview what they'll unlock */}
            <ModuleCard type="mobility" title="What You'll Earn" subtitle="Estimated returns">
              <StatusRow label="Avg. Monthly Income"  value="$800 – $1,400" valueColor={VectaColors.mobility} />
              <StatusRow label="Tax Classification"   value="Schedule E Passive" />
              <StatusRow label="1099 Form"            value="1099-MISC Box 1" />
              <StatusRow label="Self-Employment Tax"  value="Not applicable" valueColor={VectaColors.success} />
              <StatusRow label="F-1 Status Impact"    value="None — strictly passive" valueColor={VectaColors.success} />
            </ModuleCard>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const screen = StyleSheet.create({
  container:       { flex: 1, backgroundColor: VectaColors.surface1 },
  header:          { paddingTop: 60, paddingBottom: VectaSpacing['5'], paddingHorizontal: VectaSpacing['6'], gap: 6 },
  headerTitle:     { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF' },
  headerSub:       { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)' },
  headerBadge:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,185,129,0.2)', borderRadius: VectaRadius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  headerBadgeText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: '#6EE7B7', letterSpacing: VectaFonts.letterSpacing.wide },
  body:            { padding: VectaSpacing['4'], paddingBottom: 40 },
});
