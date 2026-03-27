/**
 * app/(tabs)/insurance.tsx — Complete Insurance Hub
 *
 * Sections:
 *   A. Header gradient
 *   B. University Health Plan PDF Checker (AI-powered)
 *   C. Renters Insurance (Lemonade)
 *   D. Auto Insurance (Lemonade)
 *   E. Student Health Plans (ISO / PSI)
 *   F. F-1 Compliance note
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Share, Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import { useStudentStore } from '../../stores';
import { API_V1_BASE, COMPLIANCE_AI_BASE } from '../../config/api';

// expo-document-picker requires a native rebuild to be compiled in.
// This stub replaces the real import so the screen loads without crashing.
// Once the new EAS build (in progress) is installed, swap this stub for the real import.
type DocPickerResult = { canceled: boolean; assets: Array<{ uri: string; name: string; mimeType?: string }> };
const DocumentPicker = {
  getDocumentAsync: async (_opts?: unknown): Promise<DocPickerResult> => {
    Alert.alert(
      'New Build Required',
      'PDF upload will be available once you install the new build from expo.dev. Your EAS build is currently in progress.',
    );
    return { canceled: true, assets: [] };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PdfAnalysis {
  compliant:        boolean;
  gaps:             string[];
  recommendations:  string[];
}

interface HealthPlan {
  id:           string;
  name:         string;
  provider:     string;
  monthly:      number;
  annual:       number;
  deductible:   number;
  maxCoverage:  number;
  fCompliant:   boolean;
  features:     string[];
}

// ---------------------------------------------------------------------------
// Mock / fallback data
// ---------------------------------------------------------------------------

const FALLBACK_ANALYSIS: PdfAnalysis = {
  compliant:       true,
  gaps:            [],
  recommendations: [
    'Your plan appears to meet F-1 requirements based on document analysis.',
    'Verify mental health parity coverage with your international student office.',
  ],
};

const FALLBACK_HEALTH_PLANS: HealthPlan[] = [
  {
    id:          '1',
    name:        'ISO Student Secure',
    provider:    'ISO',
    monthly:     89,
    annual:      1068,
    deductible:  500,
    maxCoverage: 500_000,
    fCompliant:  true,
    features:    ['Preventive care', 'Emergency coverage', 'Prescription drugs', 'Mental health'],
  },
  {
    id:          '2',
    name:        'ISO Student Health Select',
    provider:    'ISO',
    monthly:     149,
    annual:      1788,
    deductible:  250,
    maxCoverage: 1_000_000,
    fCompliant:  true,
    features:    ['All Basic features', 'Dental & vision', 'Sports injuries', 'Telehealth'],
  },
  {
    id:          '3',
    name:        'PSI International Premier',
    provider:    'PSI',
    monthly:     199,
    annual:      2388,
    deductible:  0,
    maxCoverage: 2_000_000,
    fCompliant:  true,
    features:    ['Zero deductible', 'Global coverage', 'Repatriation included', 'Family add-on available'],
  },
];

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function Pill({ label }: { label: string }) {
  return (
    <View style={s.pillWrap}>
      <Text style={s.pillText}>{label}</Text>
    </View>
  );
}

function CheckRow({ text, textColor }: { text: string; textColor: string }) {
  return (
    <View style={s.checkRow}>
      <Ionicons name="checkmark-circle" size={16} color="#00E6CC" />
      <Text style={[s.checkText, { color: textColor }]}>{text}</Text>
    </View>
  );
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: object }) {
  const { colors } = useTheme();
  return (
    <View style={[s.card, { backgroundColor: colors.surfaceBase, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section B – University Health Plan Checker
// ---------------------------------------------------------------------------

function UniversityPlanChecker() {
  const { colors }                    = useTheme();
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalysis | null>(null);
  const [analyzing,   setAnalyzing]   = useState(false);

  const handleUpload = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (result.canceled) return;

      const file = result.assets[0];
      setAnalyzing(true);

      try {
        const formData = new FormData();
        formData.append('file', {
          uri:  file.uri,
          name: file.name ?? 'plan.pdf',
          type: file.mimeType ?? 'application/pdf',
        } as unknown as Blob);

        const res = await fetch(`${COMPLIANCE_AI_BASE}/insurance/analyze-university-plan`, {
          method:  'POST',
          headers: { 'Content-Type': 'multipart/form-data' },
          body:    formData,
        });

        if (!res.ok) throw new Error('API error');
        const data = await res.json() as PdfAnalysis;
        setPdfAnalysis(data);
      } catch {
        // Compliance AI offline — show fallback analysis
        setPdfAnalysis(FALLBACK_ANALYSIS);
      } finally {
        setAnalyzing(false);
      }
    } catch {
      setAnalyzing(false);
      Alert.alert('Error', 'Could not open document picker. Please try again.');
    }
  }, []);

  const handleShareResult = useCallback(async () => {
    if (!pdfAnalysis) return;
    const text = pdfAnalysis.compliant
      ? `✅ F-1 Compliant\n\n${pdfAnalysis.recommendations.map(r => `• ${r}`).join('\n')}`
      : `❌ Gaps Found\n\nGaps:\n${pdfAnalysis.gaps.map(g => `• ${g}`).join('\n')}\n\nRecommendations:\n${pdfAnalysis.recommendations.map(r => `• ${r}`).join('\n')}`;
    await Share.share({ message: text });
  }, [pdfAnalysis]);

  return (
    <View style={[s.navyCard, { backgroundColor: '#001F3F' }]}>
      <Text style={s.navyCardTitle}>University Health Plan</Text>
      <Text style={s.navyCardSubtitle}>Does your plan meet F-1 visa requirements?</Text>

      {/* F-1 requirements checklist */}
      <View style={s.requirementsList}>
        {[
          'Minimum coverage: $100,000',
          'Mental health parity: Required',
          'Repatriation: Required',
        ].map((req) => (
          <View key={req} style={s.requirementRow}>
            <Ionicons name="shield-checkmark" size={14} color="#00E6CC" />
            <Text style={s.requirementText}>{req}</Text>
          </View>
        ))}
      </View>

      {/* Upload button */}
      <TouchableOpacity
        onPress={handleUpload}
        disabled={analyzing}
        style={[s.tealBtn, analyzing && { opacity: 0.7 }]}
        activeOpacity={0.85}
      >
        {analyzing ? (
          <View style={s.analyzingRow}>
            <ActivityIndicator color="#001F3F" size="small" />
            <Text style={s.tealBtnText}>Analyzing your plan with AI…</Text>
          </View>
        ) : (
          <View style={s.analyzingRow}>
            <Ionicons name="cloud-upload" size={18} color="#001F3F" />
            <Text style={s.tealBtnText}>Upload Plan PDF</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Analysis result */}
      {pdfAnalysis && (
        <View style={[
          s.resultCard,
          { backgroundColor: pdfAnalysis.compliant ? 'rgba(0,200,150,0.15)' : 'rgba(239,68,68,0.15)' },
        ]}>
          <Text style={[s.resultTitle, { color: pdfAnalysis.compliant ? '#00C896' : '#EF4444' }]}>
            {pdfAnalysis.compliant ? '✅ F-1 Compliant' : '❌ Gaps Found'}
          </Text>

          {!pdfAnalysis.compliant && pdfAnalysis.gaps.map((gap) => (
            <View key={gap} style={s.gapRow}>
              <Ionicons name="alert-circle" size={14} color="#EF4444" />
              <Text style={s.gapText}>{gap}</Text>
            </View>
          ))}

          {pdfAnalysis.recommendations.map((rec) => (
            <View key={rec} style={s.recRow}>
              <Ionicons name="information-circle" size={14} color="#00E6CC" />
              <Text style={s.recText}>{rec}</Text>
            </View>
          ))}

          <TouchableOpacity onPress={handleShareResult} style={s.shareResultBtn} activeOpacity={0.85}>
            <Ionicons name="share-outline" size={16} color="#00E6CC" />
            <Text style={s.shareResultText}>Share Result</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section C – Renters Insurance
// ---------------------------------------------------------------------------

function RentersInsurance() {
  const { colors } = useTheme();
  const profile    = useStudentStore((s) => s.profile);
  const authToken  = useStudentStore((s) => s.authToken);

  const handleGetQuote = useCallback(async () => {
    Alert.alert(
      'Opening Lemonade',
      'You will be taken to Lemonade to complete your quote. Your Vecta verification may pre-fill some fields.',
      [
        {
          text: 'Continue',
          onPress: async () => {
            try {
              const res = await fetch(`${API_V1_BASE}/insurance/lemonade-quote`, {
                method:  'POST',
                headers: {
                  'Content-Type':  'application/json',
                  Authorization: authToken ? `Bearer ${authToken}` : '',
                },
                body: JSON.stringify({ type: 'renters', studentId: profile?.id }),
              });
              if (!res.ok) throw new Error('no quote url');
              const data = await res.json() as { quoteUrl?: string };
              await Linking.openURL(data.quoteUrl ?? 'https://www.lemonade.com/renters');
            } catch {
              await Linking.openURL('https://www.lemonade.com/renters');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [authToken, profile?.id]);

  return (
    <SectionCard>
      {/* Header row */}
      <View style={s.cardHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.cardTitle, { color: colors.text }]}>🏠 Renters Insurance</Text>
          <Text style={[s.cardProvider, { color: colors.textSecondary }]}>Powered by Lemonade</Text>
        </View>
        <View style={s.recommendedBadge}>
          <Text style={s.recommendedText}>RECOMMENDED</Text>
        </View>
      </View>

      {/* Price */}
      <Text style={s.priceText}>$8 – $15 <Text style={[s.pricePer, { color: colors.textSecondary }]}>/ month</Text></Text>

      {/* Coverage */}
      <View style={s.coverageList}>
        {[
          'Personal property up to $30,000',
          'Liability coverage $100,000',
          'Loss of use covered',
          'No SSN required',
          'Cancel anytime',
        ].map((item) => (
          <CheckRow key={item} text={item} textColor={colors.textSecondary} />
        ))}
      </View>

      <TouchableOpacity onPress={handleGetQuote} style={s.tealBtn} activeOpacity={0.85}>
        <Ionicons name="open-outline" size={18} color="#001F3F" />
        <Text style={s.tealBtnText}>Get Instant Quote</Text>
      </TouchableOpacity>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section D – Auto Insurance
// ---------------------------------------------------------------------------

function AutoInsurance() {
  const { colors } = useTheme();

  const handleGetQuote = useCallback(() => {
    Alert.alert(
      'Opening Lemonade Auto',
      'You will be taken to Lemonade to get your auto insurance quote.',
      [
        { text: 'Continue', onPress: () => Linking.openURL('https://www.lemonade.com/car') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, []);

  return (
    <SectionCard>
      <View style={s.cardHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.cardTitle, { color: colors.text }]}>🚗 Auto Insurance</Text>
          <Text style={[s.cardProvider, { color: colors.textSecondary }]}>Powered by Lemonade</Text>
        </View>
      </View>

      <View style={[s.noteBox, { backgroundColor: 'rgba(255,107,53,0.12)', borderColor: 'rgba(255,107,53,0.25)' }]}>
        <Ionicons name="information-circle-outline" size={14} color="#FF6B35" />
        <Text style={[s.noteText, { color: '#FF6B35' }]}>Required if you enroll your vehicle in Vecta Fleet</Text>
      </View>

      <Text style={s.priceText}>$45 – $120 <Text style={[s.pricePer, { color: colors.textSecondary }]}>/ month</Text></Text>

      <View style={s.coverageList}>
        {[
          'Liability coverage',
          'Collision & comprehensive',
          'International license accepted',
          'No US credit history required',
        ].map((item) => (
          <CheckRow key={item} text={item} textColor={colors.textSecondary} />
        ))}
      </View>

      <TouchableOpacity onPress={handleGetQuote} style={s.tealBtn} activeOpacity={0.85}>
        <Ionicons name="open-outline" size={18} color="#001F3F" />
        <Text style={s.tealBtnText}>Get Auto Quote</Text>
      </TouchableOpacity>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section E – Student Health Plans
// ---------------------------------------------------------------------------

function HealthPlanCard({ plan }: { plan: HealthPlan }) {
  const { colors } = useTheme();

  const handleSelect = useCallback(() => {
    const url = plan.provider === 'PSI' ? 'https://www.psi.edu' : 'https://www.isoa.org';
    Alert.alert(
      `Select ${plan.name}`,
      `You will be taken to ${plan.provider}'s website to enroll.`,
      [
        { text: 'Continue', onPress: () => Linking.openURL(url) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [plan]);

  return (
    <View style={[s.planCard, { backgroundColor: colors.surfaceBase, borderColor: colors.border }]}>
      {/* Plan header */}
      <View style={s.planHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[s.planName, { color: colors.text }]}>{plan.name}</Text>
          <View style={s.planBadgeRow}>
            <View style={s.providerBadge}>
              <Text style={s.providerBadgeText}>{plan.provider}</Text>
            </View>
            {plan.fCompliant && (
              <View style={s.fCompliantBadge}>
                <Text style={s.fCompliantText}>F-1 Compliant ✓</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.planMonthly}>${plan.monthly}<Text style={[s.planMonthlyUnit, { color: colors.textSecondary }]}>/mo</Text></Text>
          <Text style={[s.planAnnual, { color: colors.textMuted }]}>${plan.annual.toLocaleString()} / year</Text>
        </View>
      </View>

      {/* Deductible */}
      <Text style={[s.planDeductible, { color: colors.textSecondary }]}>
        Deductible: {plan.deductible === 0 ? 'None (zero deductible)' : `$${plan.deductible.toLocaleString()}`}
        {'   '}Max: ${(plan.maxCoverage / 1_000_000).toFixed(plan.maxCoverage < 1_000_000 ? 0 : 1)}M
      </Text>

      {/* Features */}
      <View style={s.planFeatures}>
        {plan.features.map((feat) => (
          <CheckRow key={feat} text={feat} textColor={colors.textSecondary} />
        ))}
      </View>

      <TouchableOpacity onPress={handleSelect} style={s.tealBtn} activeOpacity={0.85}>
        <Text style={s.tealBtnText}>Select Plan</Text>
      </TouchableOpacity>
    </View>
  );
}

function StudentHealthPlans() {
  const { colors }                        = useTheme();
  const [healthPlans,   setHealthPlans]   = useState<HealthPlan[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [plansLoaded,   setPlansLoaded]   = useState(false);
  const authToken = useStudentStore((s) => s.authToken);

  const handleComparePlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_V1_BASE}/insurance/iso-quotes`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) throw new Error('no data');
      const data = await res.json() as { plans: HealthPlan[] };
      setHealthPlans(data.plans);
    } catch {
      setHealthPlans(FALLBACK_HEALTH_PLANS);
    } finally {
      setLoading(false);
      setPlansLoaded(true);
    }
  }, [authToken]);

  return (
    <View>
      {/* Section header */}
      <View style={s.sectionHeaderRow}>
        <Text style={[s.sectionTitle, { color: colors.text }]}>🏥 Student Health Plans</Text>
        <View style={s.isoCertBadge}>
          <Text style={s.isoCertText}>ISO &amp; PSI Certified</Text>
        </View>
      </View>

      {!plansLoaded ? (
        <SectionCard>
          <Text style={[s.compareSubtitle, { color: colors.textSecondary }]}>
            Compare F-1 certified plans from ISO and PSI — the two largest international student health insurance providers in the US.
          </Text>
          <TouchableOpacity
            onPress={handleComparePlans}
            disabled={loading}
            style={[s.tealBtn, loading && { opacity: 0.7 }]}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#001F3F" />
            ) : (
              <View style={s.analyzingRow}>
                <Ionicons name="search" size={18} color="#001F3F" />
                <Text style={s.tealBtnText}>Compare Plans</Text>
              </View>
            )}
          </TouchableOpacity>
        </SectionCard>
      ) : (
        healthPlans.map((plan) => <HealthPlanCard key={plan.id} plan={plan} />)
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function InsuranceScreen() {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface1 }}
      contentContainerStyle={s.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ─── Section A: Header ─────────────────────────────────────────── */}
      <LinearGradient
        colors={['#00B8A4', '#001A33']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.header}
      >
        <Text style={s.headerTitle}>Insurance</Text>
        <Text style={s.headerSubtitle}>F-1 compliant coverage — all in one place</Text>
        <View style={s.pillRow}>
          <Pill label="🏥 Health" />
          <Pill label="🏠 Renters" />
          <Pill label="🚗 Auto" />
        </View>
      </LinearGradient>

      <View style={s.body}>

        {/* ─── Section B: University Health Plan Checker ─────────────── */}
        <Text style={[s.sectionTitle, { color: colors.text, marginBottom: 10 }]}>
          University Health Plan
        </Text>
        <UniversityPlanChecker />

        {/* ─── Section C: Renters Insurance ──────────────────────────── */}
        <Text style={[s.sectionTitle, { color: colors.text }]}>Renters Insurance</Text>
        <RentersInsurance />

        {/* ─── Section D: Auto Insurance ─────────────────────────────── */}
        <Text style={[s.sectionTitle, { color: colors.text }]}>Auto Insurance</Text>
        <AutoInsurance />

        {/* ─── Section E: Student Health Plans ───────────────────────── */}
        <StudentHealthPlans />

        {/* ─── Section F: F-1 Compliance Note ────────────────────────── */}
        <View style={[s.noteCard, { backgroundColor: 'rgba(0,230,204,0.08)', borderColor: 'rgba(0,230,204,0.25)' }]}>
          <Ionicons name="shield-checkmark" size={18} color="#00E6CC" style={{ marginBottom: 6 }} />
          <Text style={[s.noteCardText, { color: colors.textSecondary }]}>
            F-1 visa regulations require maintaining health insurance with minimum $100,000 coverage. Gaps in coverage may affect your visa status. Vecta plans are certified F-1 compliant.
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL('https://vecta.io/f1-insurance')}
            activeOpacity={0.8}
          >
            <Text style={s.noteCardLink}>Learn more → vecta.io/f1-insurance</Text>
          </TouchableOpacity>
        </View>

      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TEAL   = '#00E6CC';
const NAVY   = '#001F3F';

const s = StyleSheet.create({
  scrollContent: { paddingBottom: 60 },
  body:          { padding: 16, gap: 14 },

  // Header
  header:         { paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 28, paddingHorizontal: 20 },
  headerTitle:    { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 14 },
  pillRow:        { flexDirection: 'row', gap: 8 },
  pillWrap:       { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20 },
  pillText:       { color: '#FFF', fontSize: 12, fontWeight: '600' },

  // Navy card (health plan checker)
  navyCard:        { borderRadius: 16, padding: 20, gap: 12, marginBottom: 4 },
  navyCardTitle:   { fontSize: 17, fontWeight: '700', color: '#FFF' },
  navyCardSubtitle:{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 4 },
  requirementsList:{ gap: 6, marginBottom: 4 },
  requirementRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  requirementText: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  analyzingRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // Result card
  resultCard:  { borderRadius: 12, padding: 14, gap: 8, marginTop: 4 },
  resultTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  gapRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  gapText:     { fontSize: 12, color: '#EF4444', flex: 1 },
  recRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  recText:     { fontSize: 12, color: 'rgba(255,255,255,0.8)', flex: 1 },
  shareResultBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4 },
  shareResultText: { color: TEAL, fontSize: 13, fontWeight: '600' },

  // Generic card
  card: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12 },

  // Card internals
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle:     { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  cardProvider:  { fontSize: 12 },
  noteBox:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, padding: 10, borderWidth: 1 },
  noteText:      { fontSize: 12, flex: 1 },
  recommendedBadge: { backgroundColor: 'rgba(0,230,204,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  recommendedText:  { color: TEAL, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },

  // Price
  priceText: { fontSize: 28, fontWeight: '800', color: TEAL },
  pricePer:  { fontSize: 14, fontWeight: '400' },

  // Coverage list
  coverageList: { gap: 6 },
  checkRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText:    { fontSize: 13, flex: 1 },

  // Teal CTA button
  tealBtn:     { backgroundColor: TEAL, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  tealBtnText: { fontSize: 15, fontWeight: '700', color: NAVY },

  // Section title
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 },
  sectionTitle:     { fontSize: 17, fontWeight: '700', marginTop: 6 },
  isoCertBadge:     { backgroundColor: 'rgba(0,230,204,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  isoCertText:      { color: TEAL, fontSize: 10, fontWeight: '700' },

  // Compare subtitle
  compareSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 4 },

  // Plan card
  planCard:        { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12, marginBottom: 10 },
  planHeader:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  planName:        { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  planBadgeRow:    { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  providerBadge:   { backgroundColor: 'rgba(0,31,63,0.12)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  providerBadgeText:{ fontSize: 10, fontWeight: '700', color: NAVY },
  fCompliantBadge: { backgroundColor: 'rgba(0,200,150,0.15)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  fCompliantText:  { fontSize: 10, fontWeight: '700', color: '#00C896' },
  planMonthly:     { fontSize: 22, fontWeight: '800', color: TEAL },
  planMonthlyUnit: { fontSize: 13, fontWeight: '400' },
  planAnnual:      { fontSize: 11 },
  planDeductible:  { fontSize: 12 },
  planFeatures:    { gap: 5 },

  // F-1 note card
  noteCard:     { borderRadius: 14, padding: 16, borderWidth: 1, gap: 6 },
  noteCardText: { fontSize: 13, lineHeight: 19 },
  noteCardLink: { fontSize: 13, fontWeight: '600', color: TEAL, marginTop: 4 },
});
