/**
 * insurance/index.tsx — Student Insurance Screen
 *
 * Two panels:
 *   1. University Health Plan Check — upload PDF → Claude Vision compliance analysis
 *   2. Insurance Marketplace — Lemonade renters + auto quotes
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { ModuleCard, StatusRow, VectaBadge } from '../../components/ui';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const AI_BASE  = process.env.EXPO_PUBLIC_COMPLIANCE_AI_URL ?? 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthPlanAnalysis {
  plan_name:           string;
  is_f1_compliant:     boolean;
  annual_deductible:   number;
  emergency_coverage:  number;
  pre_existing:        boolean;
  mental_health:       boolean;
  compliance_notes:    string[];
  recommended_supplement?: string;
  iso_quotes?: Array<{
    provider: string;
    plan_name: string;
    monthly_premium: number;
    is_f1_compliant: boolean;
    bind_url: string;
  }>;
}

// ---------------------------------------------------------------------------
// Health plan checker
// ---------------------------------------------------------------------------

function HealthPlanChecker() {
  const { authToken, profile } = useStudentStore();
  const [analyzing, setAnalyzing]   = useState(false);
  const [result,    setResult]      = useState<HealthPlanAnalysis | null>(null);
  const [fileName,  setFileName]    = useState('');

  const handleUpload = useCallback(async () => {
    const doc = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });

    if (doc.canceled || !doc.assets?.[0]) return;

    const asset = doc.assets[0];
    setFileName(asset.name ?? 'document');
    setAnalyzing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', {
        uri:  asset.uri,
        name: asset.name ?? 'plan.pdf',
        type: asset.mimeType ?? 'application/pdf',
      } as unknown as Blob);
      formData.append('student_id', profile?.id ?? 'unknown');
      formData.append('university_name', profile?.universityName ?? '');

      const res = await fetch(`${AI_BASE}/insurance/analyze-university-plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      if (!res.ok) throw new Error(`Analysis failed: ${res.status}`);
      const data = await res.json() as HealthPlanAnalysis;
      setResult(data);
    } catch (err) {
      Alert.alert('Analysis Failed', (err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }, [authToken, profile]);

  return (
    <ModuleCard type="insurance" title="University Health Plan" subtitle="Claude Vision · F-1 Compliance Check">
      <Text style={card.desc}>
        Upload your university's health plan PDF. Our AI checks if it meets USCIS F-1 requirements.
      </Text>

      {result ? (
        <View style={card.resultWrap}>
          <View style={[card.complianceBadge, { backgroundColor: result.is_f1_compliant ? VectaColors.successBg : VectaColors.errorBg }]}>
            <Ionicons
              name={result.is_f1_compliant ? 'shield-checkmark' : 'close-circle'}
              size={18}
              color={result.is_f1_compliant ? VectaColors.success : VectaColors.error}
            />
            <Text style={[card.complianceText, { color: result.is_f1_compliant ? VectaColors.success : VectaColors.error }]}>
              {result.is_f1_compliant ? 'F-1 COMPLIANT' : 'NOT COMPLIANT'}
            </Text>
          </View>

          <Text style={card.planName}>{result.plan_name}</Text>

          <StatusRow label="Annual Deductible" value={`$${result.annual_deductible.toLocaleString()}`}
            valueColor={result.annual_deductible <= 500 ? VectaColors.success : VectaColors.error} />
          <StatusRow label="Emergency Coverage" value={`$${result.emergency_coverage.toLocaleString()}`}
            valueColor={result.emergency_coverage >= 100_000 ? VectaColors.success : VectaColors.error} />
          <StatusRow label="Pre-existing Covered" value={result.pre_existing ? 'Yes' : 'No'}
            valueColor={result.pre_existing ? VectaColors.success : VectaColors.error} />
          <StatusRow label="Mental Health" value={result.mental_health ? 'Covered' : 'Not covered'} />

          {result.compliance_notes.length > 0 && (
            <View style={card.notes}>
              {result.compliance_notes.map((note, i) => (
                <Text key={i} style={card.note}>{note}</Text>
              ))}
            </View>
          )}

          {result.recommended_supplement && (
            <View style={card.supplementBanner}>
              <Ionicons name="information-circle" size={14} color={VectaColors.info} />
              <Text style={card.supplementText}>{result.recommended_supplement}</Text>
            </View>
          )}

          <TouchableOpacity onPress={() => setResult(null)} style={card.reuploadBtn}>
            <Text style={card.reuploadText}>Analyze a different plan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleUpload}
          disabled={analyzing}
          style={[card.uploadBtn, analyzing && { opacity: 0.7 }]}
          activeOpacity={0.85}
        >
          {analyzing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#FFF" />
              <Text style={card.uploadBtnText}>Analyzing {fileName}…</Text>
            </View>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color="#FFF" />
              <Text style={card.uploadBtnText}>Upload Health Plan PDF</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </ModuleCard>
  );
}

// ---------------------------------------------------------------------------
// Insurance product card
// ---------------------------------------------------------------------------

function ProductCard({ icon, title, price, features, color, onPress }: {
  icon: string; title: string; price: string;
  features: string[]; color: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}
      style={{ backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['3'], borderWidth: 1, borderColor: VectaColors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], marginBottom: VectaSpacing['3'] }}>
        <View style={{ width: 48, height: 48, borderRadius: VectaRadius.xl, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.text }}>{title}</Text>
          <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.lg, color }}>{price}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={VectaColors.textMuted} />
      </View>
      <View style={{ gap: VectaSpacing['1'] }}>
        {features.map(f => (
          <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-circle" size={12} color={VectaColors.success} />
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textSecondary }}>{f}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function InsuranceScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: VectaColors.surface1 }} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={['#001F3F', '#001A33']}
        style={{ paddingTop: 60, paddingBottom: VectaSpacing['6'], paddingHorizontal: VectaSpacing['6'], gap: 4 }}>
        <TouchableOpacity onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['3'] }}>
          <Ionicons name="chevron-back" size={20} color="#FFF" />
        </TouchableOpacity>
        <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF' }}>Insurance</Text>
        <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)' }}>
          No US history required · No SSN · No co-signer
        </Text>
      </LinearGradient>

      <View style={{ padding: VectaSpacing['4'] }}>
        {/* F-1 notice */}
        <View style={{ flexDirection: 'row', gap: VectaSpacing['3'], backgroundColor: '#FFF7ED', borderRadius: VectaRadius.lg, padding: VectaSpacing['3'], marginBottom: VectaSpacing['4'], borderWidth: 1, borderColor: '#FED7AA' }}>
          <Text style={{ fontSize: 16 }}>⚖️</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: '#C2410C', letterSpacing: 1 }}>F-1 STUDENT NOTES</Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: '#9A3412', lineHeight: 16, marginTop: 2 }}>
              No US credit, SSN, or driving history required. Foreign experience accepted for auto. Nova Credit translated score used.
            </Text>
          </View>
        </View>

        {/* Health plan checker */}
        <HealthPlanChecker />

        {/* Insurance marketplace */}
        <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted, letterSpacing: VectaFonts.letterSpacing.wider, marginBottom: VectaSpacing['3'] }}>
          INSURANCE MARKETPLACE
        </Text>

        <ProductCard
          icon="🏠" title="Renter's Insurance" price="from $15/mo"
          color={VectaColors.success}
          features={['Personal property up to $15,000', 'Liability up to $100,000', 'No credit score required', 'Instant digital policy']}
          onPress={() => Alert.alert('Lemonade', 'Opening Lemonade Renters quote…')}
        />

        <ProductCard
          icon="🚗" title="Auto Insurance" price="from $45/mo"
          color={VectaColors.mobility}
          features={['For LESSOR fleet vehicles', 'Foreign driving history accepted', 'Personal/storage use only', 'Vecta fleet policy for active rides']}
          onPress={() => Alert.alert('Lemonade', 'Opening Lemonade Auto quote…')}
        />

        <View style={{ marginTop: VectaSpacing['2'], padding: VectaSpacing['3'], backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.lg }}>
          <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center' }}>
            Powered by Lemonade Insurance · A-rated carrier · FDIC member
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

const card = StyleSheet.create({
  desc:            { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, lineHeight: 20, marginBottom: VectaSpacing['3'] },
  uploadBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', backgroundColor: '#001F3F', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['3'] },
  uploadBtnText:   { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' },
  resultWrap:      { gap: VectaSpacing['2'] },
  complianceBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: VectaRadius.full, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: VectaSpacing['2'] },
  complianceText:  { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, letterSpacing: 1 },
  planName:        { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text, marginBottom: VectaSpacing['2'] },
  notes:           { backgroundColor: VectaColors.surface2, borderRadius: VectaRadius.md, padding: VectaSpacing['3'], gap: 4, marginTop: VectaSpacing['2'] },
  note:            { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textSecondary },
  supplementBanner:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#EFF6FF', borderRadius: VectaRadius.md, padding: VectaSpacing['3'], marginTop: VectaSpacing['2'] },
  supplementText:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: '#001F3F', flex: 1 },
  reuploadBtn:     { alignItems: 'center', paddingVertical: VectaSpacing['2'], marginTop: VectaSpacing['2'] },
  reuploadText:    { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textMuted },
});
