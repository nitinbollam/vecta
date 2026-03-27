/**
 * housing/index.tsx — Vecta Housing Screen
 *
 * Sections:
 *   1. Vecta Trust Score — Nova Credit tier + 300-850 translated score
 *   2. Solvency Badge — Plaid connection status
 *   3. Letter of Credit — generate / download / share
 *   4. AI Roommate Finder — lifestyle profile + matches
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, TextInput, Alert, Share,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useHousingStore, useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius,
  VectaGradients, VectaShadows,
} from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { ModuleCard, StatusRow, SolvencyBadge, VectaBadge } from '../../components/ui';

// ---------------------------------------------------------------------------
// Trust score visual
// ---------------------------------------------------------------------------

const TIER_CONFIG = {
  Building:  { color: '#F59E0B', bg: '#FFFBEB', min: 300, max: 579 },
  Fair:      { color: '#3B82F6', bg: '#EFF6FF', min: 580, max: 669 },
  Good:      { color: '#10B981', bg: '#ECFDF5', min: 670, max: 739 },
  Excellent: { color: '#001225', bg: '#EDE9FE', min: 740, max: 850 },
};

function TrustScoreGauge({ score, tier }: { score: number; tier: string }) {
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.Building;
  const pct = Math.min(100, Math.max(0, ((score - 300) / (850 - 300)) * 100));

  return (
    <View style={gaugeStyles.container}>
      <View style={gaugeStyles.scoreRow}>
        <Text style={[gaugeStyles.score, { color: config.color }]}>{score}</Text>
        <View style={[gaugeStyles.tierBadge, { backgroundColor: config.bg }]}>
          <Text style={[gaugeStyles.tierText, { color: config.color }]}>{tier.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={gaugeStyles.label}>Vecta Trust Score (300–850)</Text>
      {/* Progress bar */}
      <View style={gaugeStyles.track}>
        <View style={[gaugeStyles.fill, { width: `${pct}%` as `${number}%`, backgroundColor: config.color }]} />
      </View>
      <View style={gaugeStyles.scale}>
        <Text style={gaugeStyles.scaleText}>300</Text>
        <Text style={gaugeStyles.scaleText}>580</Text>
        <Text style={gaugeStyles.scaleText}>670</Text>
        <Text style={gaugeStyles.scaleText}>740</Text>
        <Text style={gaugeStyles.scaleText}>850</Text>
      </View>
    </View>
  );
}

const gaugeStyles = StyleSheet.create({
  container:  { paddingHorizontal: VectaSpacing['1'] },
  scoreRow:   { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], marginBottom: 4 },
  score:      { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['4xl'] },
  tierBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: VectaRadius.full },
  tierText:   { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, letterSpacing: 1 },
  label:      { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginBottom: VectaSpacing['3'] },
  track:      { height: 8, backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.full, overflow: 'hidden' },
  fill:       { height: '100%', borderRadius: VectaRadius.full },
  scale:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scaleText:  { fontFamily: VectaFonts.regular, fontSize: 9, color: VectaColors.textMuted },
});

// ---------------------------------------------------------------------------
// LoC generator
// ---------------------------------------------------------------------------

function LetterOfCreditPanel() {
  const { activeLoC, plaidConnected, isLoading, generateLoC, refreshLoCUrl } = useHousingStore();
  const [monthlyRent,   setMonthlyRent]   = useState('');
  const [landlordName,  setLandlordName]  = useState('');
  const [generating,    setGenerating]    = useState(false);

  const handleGenerate = useCallback(async () => {
    const rent = parseFloat(monthlyRent);
    if (!rent || rent < 100 || rent > 50_000) {
      Alert.alert('Invalid Amount', 'Enter a monthly rent between $100 and $50,000.');
      return;
    }
    setGenerating(true);
    await generateLoC(rent, landlordName || undefined);
    setGenerating(false);
  }, [monthlyRent, landlordName, generateLoC]);

  const handleShare = useCallback(async () => {
    if (!activeLoC?.id) return;
    await refreshLoCUrl(activeLoC.id);
    if (activeLoC.downloadUrl) {
      await Share.share({ url: activeLoC.downloadUrl, title: 'Vecta Letter of Credit' });
    }
  }, [activeLoC, refreshLoCUrl]);

  if (!plaidConnected) {
    return (
      <View style={locStyles.connectPrompt}>
        <Ionicons name="link" size={28} color={VectaColors.housing} />
        <Text style={locStyles.connectTitle}>Connect Your Bank First</Text>
        <Text style={locStyles.connectSub}>
          Link your home-country or US bank account to generate a verified Letter of Credit.
        </Text>
        <TouchableOpacity style={locStyles.connectBtn} onPress={() => router.push('/onboarding/plaid-link')}>
          <Text style={locStyles.connectBtnText}>Connect with Plaid</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      {activeLoC ? (
        <>
          <SolvencyBadge status="SOLVENT" guaranteeMonths={activeLoC.guaranteeMonths} />
          <View style={locStyles.locCard}>
            <StatusRow label="Monthly Rent Covered"  value={`$${activeLoC.monthlyRent.toLocaleString()}`} valueColor={VectaColors.success} />
            <StatusRow label="Guarantee Period"       value={`${activeLoC.guaranteeMonths} months`} />
            <StatusRow label="Expires"                value={new Date(activeLoC.expiresAt).toLocaleDateString()} />
            <StatusRow label="Status"                 value={activeLoC.status.toUpperCase()} valueColor={VectaColors.success} />
          </View>
          <TouchableOpacity onPress={handleShare} style={locStyles.shareBtn}>
            <Ionicons name="share-outline" size={18} color={VectaColors.housing} />
            <Text style={locStyles.shareBtnText}>Share with Landlord</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={locStyles.generateForm}>
          <Text style={locStyles.formLabel}>Monthly Rent (USD)</Text>
          <TextInput
            style={locStyles.input}
            placeholder="e.g. 1500"
            placeholderTextColor={VectaColors.textMuted}
            keyboardType="numeric"
            value={monthlyRent}
            onChangeText={setMonthlyRent}
          />
          <Text style={[locStyles.formLabel, { marginTop: VectaSpacing['3'] }]}>Landlord Name (optional)</Text>
          <TextInput
            style={locStyles.input}
            placeholder="e.g. Sunrise Properties LLC"
            placeholderTextColor={VectaColors.textMuted}
            value={landlordName}
            onChangeText={setLandlordName}
          />
          <TouchableOpacity
            onPress={handleGenerate}
            disabled={generating || !monthlyRent}
            style={[locStyles.generateBtn, (!monthlyRent || generating) && { opacity: 0.5 }]}
          >
            <Ionicons name="document-text" size={18} color="#FFF" />
            <Text style={locStyles.generateBtnText}>
              {generating ? 'Generating…' : 'Generate Letter of Credit'}
            </Text>
          </TouchableOpacity>
          <Text style={locStyles.privacyNote}>
            🔒 Your exact balance is never shown. Landlords only see a signed guarantee statement.
          </Text>
        </View>
      )}
    </View>
  );
}

const locStyles = StyleSheet.create({
  connectPrompt: { alignItems: 'center', gap: VectaSpacing['3'], paddingVertical: VectaSpacing['4'] },
  connectTitle:  { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.text },
  connectSub:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, textAlign: 'center' },
  connectBtn:    { backgroundColor: VectaColors.housing, borderRadius: VectaRadius.full, paddingHorizontal: VectaSpacing['5'], paddingVertical: VectaSpacing['3'] },
  connectBtnText:{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' },

  locCard:      { gap: 4, marginVertical: VectaSpacing['3'] },
  shareBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: VectaSpacing['3'], backgroundColor: VectaColors.housingBg, borderRadius: VectaRadius.lg },
  shareBtnText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.housing },

  generateForm:    { gap: 4 },
  formLabel:       { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textSecondary },
  input:           { backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.md, paddingHorizontal: VectaSpacing['4'], paddingVertical: VectaSpacing['3'], fontFamily: VectaFonts.regular, fontSize: VectaFonts.md, color: VectaColors.text, marginTop: 4 },
  generateBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', backgroundColor: VectaColors.housing, borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['3'], marginTop: VectaSpacing['4'] },
  generateBtnText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' },
  privacyNote:     { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center', marginTop: VectaSpacing['2'] },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HousingScreen() {
  const { colors }                               = useTheme();
  const { trustScore, isLoading, fetchTrustScore } = useHousingStore();
  const [refreshing, setRefreshing]              = useState(false);

  useEffect(() => { fetchTrustScore(); }, [fetchTrustScore]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTrustScore();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface1 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VectaColors.housing} />}
    >
      {/* Header */}
      <LinearGradient colors={VectaGradients.housing} style={{ paddingTop: 60, paddingBottom: 24, paddingHorizontal: 24, gap: 4 }}>
        <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF' }}>
          Housing
        </Text>
        <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)' }}>
          No co-signer required
        </Text>
      </LinearGradient>

      <View style={{ padding: VectaSpacing['4'] }}>
        {/* Trust Score */}
        <ModuleCard type="housing" title="Vecta Trust Score" subtitle="Nova Credit · Translated" status="active">
          {isLoading ? (
            <View style={{ gap: 8 }}>
              <View style={{ height: 48, backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.md }} />
              <View style={{ height: 8, backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.full }} />
            </View>
          ) : trustScore ? (
            <TrustScoreGauge score={trustScore.score} tier={trustScore.tier} />
          ) : (
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textMuted }}>
              Connect your bank to generate your score.
            </Text>
          )}
        </ModuleCard>

        {/* Letter of Credit */}
        <ModuleCard type="housing" title="Letter of Credit" subtitle="Plaid · Solvency Verified" status="active">
          <LetterOfCreditPanel />
        </ModuleCard>

        {/* AI Roommate Finder */}
        <ModuleCard
          type="housing"
          title="AI Roommate Finder"
          subtitle="pgvector · Lifestyle Match"
          status="active"
          onPress={() => {}}
        >
          <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary }}>
            Find compatible roommates at your university based on lifestyle, budget, and move-in date.
          </Text>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: VectaSpacing['2'] }}>
            <Ionicons name="people" size={16} color={VectaColors.housing} />
            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.housing }}>
              Set Roommate Preferences →
            </Text>
          </TouchableOpacity>
        </ModuleCard>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}
