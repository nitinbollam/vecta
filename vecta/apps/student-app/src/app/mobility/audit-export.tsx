/**
 * mobility/audit-export.tsx — Flight Recorder Audit Chain Export Screen
 *
 * Allows LESSOR students to export their immutable audit chain as a
 * JSON document suitable for submission to USCIS or IRS.
 *
 * Features:
 *   - Chain integrity indicator (VERIFIED / BROKEN)
 *   - Tax year selector
 *   - Entry preview (condensed list)
 *   - Export → Share sheet (JSON file)
 *   - DSO memo quick-link
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Share, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore, useMobilityStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { StatusRow, VectaBadge } from '../../components/ui';
import { API_V1_BASE } from '../../config/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  id: string;
  event_type: string;
  resource_id: string;
  service: string;
  hash: string;
  previous_hash: string;
  created_at: string;
}

interface ChainExport {
  studentId: string;
  taxYear: number;
  exportedAt: string;
  chainIntegrity: 'VERIFIED' | 'BROKEN';
  eventCount: number;
  genesisHash: string;
  latestHash: string;
  entries: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Year selector
// ---------------------------------------------------------------------------

function YearSelector({
  selectedYear,
  onSelect,
}: {
  selectedYear: number;
  onSelect: (y: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <View style={ysStyle.row}>
      {years.map((year) => (
        <TouchableOpacity
          key={year}
          onPress={() => onSelect(year)}
          style={[ysStyle.btn, selectedYear === year && ysStyle.btnActive]}
        >
          <Text style={[ysStyle.label, selectedYear === year && ysStyle.labelActive]}>
            {year}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const ysStyle = StyleSheet.create({
  row:         { flexDirection: 'row', gap: VectaSpacing['2'] },
  btn:         { flex: 1, paddingVertical: VectaSpacing['2'], borderRadius: VectaRadius.md, backgroundColor: VectaColors.surface2, alignItems: 'center' },
  btnActive:   { backgroundColor: VectaColors.mobility },
  label:       { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.textSecondary },
  labelActive: { color: '#FFF' },
});

// ---------------------------------------------------------------------------
// Chain integrity badge
// ---------------------------------------------------------------------------

function ChainIntegrityBadge({ verified }: { verified: boolean }) {
  return (
    <View style={[
      cibStyle.container,
      { backgroundColor: verified ? VectaColors.successBg : VectaColors.errorBg },
    ]}>
      <Ionicons
        name={verified ? 'shield-checkmark' : 'warning'}
        size={18}
        color={verified ? VectaColors.success : VectaColors.error}
      />
      <View>
        <Text style={[cibStyle.label, { color: verified ? VectaColors.success : VectaColors.error }]}>
          CHAIN INTEGRITY {verified ? 'VERIFIED' : 'BROKEN'}
        </Text>
        <Text style={cibStyle.sub}>
          {verified
            ? 'All SHA-256 hashes in sequence. Safe for USCIS/IRS submission.'
            : 'Chain integrity check failed. Contact compliance@vecta.io immediately.'}
        </Text>
      </View>
    </View>
  );
}

const cibStyle = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: VectaSpacing['3'], padding: VectaSpacing['4'], borderRadius: VectaRadius.lg, marginBottom: VectaSpacing['4'] },
  label:     { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, letterSpacing: VectaFonts.letterSpacing.wide },
  sub:       { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textSecondary, marginTop: 2, maxWidth: 260 },
});

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function EntryRow({ entry, index }: { entry: AuditEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const typeColors: Record<string, string> = {
    RIDE_COMPLETED:    VectaColors.success,
    VEHICLE_ENROLLED:  VectaColors.mobility,
    AUDIT_CHAIN_EXPORTED: VectaColors.info,
  };

  return (
    <TouchableOpacity
      onPress={() => setExpanded((e) => !e)}
      style={entryStyle.container}
      activeOpacity={0.8}
    >
      <View style={entryStyle.header}>
        <View style={entryStyle.indexWrap}>
          <Text style={entryStyle.index}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[entryStyle.type, { color: typeColors[entry.event_type] ?? VectaColors.text }]}>
            {entry.event_type.replace(/_/g, ' ')}
          </Text>
          <Text style={entryStyle.date}>
            {new Date(entry.created_at).toLocaleString()}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={VectaColors.textMuted}
        />
      </View>

      {expanded && (
        <View style={entryStyle.detail}>
          <Text style={entryStyle.hashLabel}>SHA-256 Hash</Text>
          <Text style={entryStyle.hash}>{entry.hash.slice(0, 32)}…</Text>
          <Text style={entryStyle.hashLabel}>Previous Hash</Text>
          <Text style={entryStyle.hash}>{entry.previous_hash.slice(0, 32)}…</Text>
          <Text style={entryStyle.hashLabel}>Service</Text>
          <Text style={entryStyle.hashValue}>{entry.service}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const entryStyle = StyleSheet.create({
  container:  { backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.md, marginBottom: VectaSpacing['2'], overflow: 'hidden', borderWidth: 1, borderColor: VectaColors.border },
  header:     { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], padding: VectaSpacing['3'] },
  indexWrap:  { width: 28, height: 28, borderRadius: VectaRadius.full, backgroundColor: VectaColors.surface2, alignItems: 'center', justifyContent: 'center' },
  index:      { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted },
  type:       { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm },
  date:       { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 },
  detail:     { paddingHorizontal: VectaSpacing['4'], paddingBottom: VectaSpacing['3'], gap: 3, backgroundColor: VectaColors.surface1 },
  hashLabel:  { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: VectaSpacing['2'] },
  hash:       { fontFamily: VectaFonts.mono, fontSize: 10, color: VectaColors.text },
  hashValue:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.text },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function AuditExportScreen() {
  const { authToken } = useStudentStore();
  const { earnings }  = useMobilityStore();

  const [taxYear,   setTaxYear]   = useState(new Date().getFullYear());
  const [chain,     setChain]     = useState<ChainExport | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchChain = useCallback(async (year: number) => {
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_V1_BASE}/mobility/audit/chain?year=${year}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json() as ChainExport;
      setChain(data);
    } catch {
      Alert.alert('Error', 'Could not fetch audit chain. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => { fetchChain(taxYear); }, [taxYear, fetchChain]);

  const handleExport = useCallback(async () => {
    if (!chain) return;
    setExporting(true);
    try {
      const json = JSON.stringify(chain, null, 2);
      await Share.share({
        message: json,
        title:   `Vecta Flight Recorder — ${chain.taxYear} Tax Year`,
      });
    } catch {
      Alert.alert('Export failed', 'Could not share the audit chain.');
    } finally {
      setExporting(false);
    }
  }, [chain]);

  return (
    <View style={{ flex: 1, backgroundColor: VectaColors.surface1 }}>
      {/* Header */}
      <LinearGradient colors={VectaGradients.mobility} style={screen.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['3'] }}
        >
          <Ionicons name="chevron-back" size={20} color="#FFF" />
        </TouchableOpacity>
        <Text style={screen.title}>Flight Recorder</Text>
        <Text style={screen.subtitle}>Immutable Audit Chain — USCIS / IRS Export</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: VectaSpacing['4'], paddingBottom: 60 }}>
        {/* Tax year selector */}
        <Text style={screen.sectionLabel}>TAX YEAR</Text>
        <YearSelector selectedYear={taxYear} onSelect={(y) => { setTaxYear(y); }} />

        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['10'] }}>
            <ActivityIndicator size="large" color={VectaColors.mobility} />
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textMuted, marginTop: VectaSpacing['3'] }}>
              Loading audit chain…
            </Text>
          </View>
        ) : chain ? (
          <>
            {/* Chain integrity */}
            <Text style={[screen.sectionLabel, { marginTop: VectaSpacing['5'] }]}>INTEGRITY</Text>
            <ChainIntegrityBadge verified={chain.chainIntegrity === 'VERIFIED'} />

            {/* Summary */}
            <Text style={screen.sectionLabel}>SUMMARY</Text>
            <View style={{ backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['4'], borderWidth: 1, borderColor: VectaColors.border }}>
              <StatusRow label="Tax Year"          value={String(chain.taxYear)} />
              <StatusRow label="Total Entries"     value={chain.eventCount.toLocaleString()} />
              <StatusRow label="Latest Hash"       value={`${chain.latestHash?.slice(0, 12) ?? '—'}…`} />
              <StatusRow label="Exported At"       value={new Date(chain.exportedAt).toLocaleString()} />
              <StatusRow
                label="Tax Classification"
                value="Schedule E Passive"
                valueColor={VectaColors.success}
                icon="checkmark-circle"
              />
              <StatusRow
                label="1099 Form"
                value="1099-MISC Box 1"
                valueColor={VectaColors.success}
              />
            </View>

            {/* Export button */}
            <TouchableOpacity
              onPress={handleExport}
              disabled={exporting || chain.chainIntegrity !== 'VERIFIED'}
              style={[
                screen.exportBtn,
                (exporting || chain.chainIntegrity !== 'VERIFIED') && { opacity: 0.5 },
              ]}
            >
              {exporting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="download" size={20} color="#FFF" />
                  <Text style={screen.exportBtnText}>Export for USCIS / IRS</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/mobility/enroll')}
              style={screen.dsoLink}
            >
              <Ionicons name="document-text-outline" size={16} color={VectaColors.mobility} />
              <Text style={screen.dsoLinkText}>Generate DSO Compliance Memo →</Text>
            </TouchableOpacity>

            {/* Entry list */}
            <Text style={[screen.sectionLabel, { marginTop: VectaSpacing['5'] }]}>
              ENTRIES ({chain.eventCount})
            </Text>
            {chain.entries.slice(0, 50).map((entry, i) => (
              <EntryRow key={entry.id} entry={entry} index={i} />
            ))}
            {chain.entries.length > 50 && (
              <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center', marginTop: VectaSpacing['3'] }}>
                + {chain.entries.length - 50} more entries in the exported JSON
              </Text>
            )}
          </>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['10'] }}>
            <Ionicons name="document-outline" size={48} color={VectaColors.textMuted} />
            <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textMuted, marginTop: VectaSpacing['3'] }}>
              No audit entries for {taxYear}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const screen = StyleSheet.create({
  header:       { paddingTop: 60, paddingBottom: VectaSpacing['5'], paddingHorizontal: VectaSpacing['5'] },
  title:        { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF' },
  subtitle:     { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  sectionLabel: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted, letterSpacing: VectaFonts.letterSpacing.wider, marginBottom: VectaSpacing['3'], marginTop: VectaSpacing['4'] },
  exportBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: VectaSpacing['2'], backgroundColor: VectaColors.mobility, borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], marginBottom: VectaSpacing['3'] },
  exportBtnText:{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: '#FFF' },
  dsoLink:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: VectaSpacing['3'] },
  dsoLinkText:  { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.mobility },
});
