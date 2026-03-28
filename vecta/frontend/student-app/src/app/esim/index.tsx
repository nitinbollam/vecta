/**
 * app/esim/index.tsx — US eSIM Management Screen
 * Accessible from Profile → Platform Status → SIM row
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { VectaColors, VectaFonts, VectaSpacing, VectaRadius } from '../../constants/theme';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { useTheme } from '../../context/ThemeContext';

// ---------------------------------------------------------------------------
// Plan info
// ---------------------------------------------------------------------------

const PLAN_INFO = {
  data:       '10 GB',
  number:     'US number included',
  validity:   '30 days',
  carriers:   'T-Mobile · AT&T (via eSIM Go)',
  price:      '$29 / month',
};

const FAQ = [
  {
    q: 'Will this work alongside my home SIM?',
    a: 'Yes. eSIM runs alongside your physical SIM. Your home number stays active for calls and SMS from home.',
  },
  {
    q: 'Which carriers does Vecta eSIM use?',
    a: 'Vecta eSIM is powered by eSIM Go, using T-Mobile and AT&T networks depending on coverage in your area.',
  },
  {
    q: 'How do I renew my plan?',
    a: 'You will receive a renewal reminder 3 days before expiry. Tap "Renew Plan" or contact support@vecta.io.',
  },
];

// ---------------------------------------------------------------------------
// FAQ accordion item
// ---------------------------------------------------------------------------

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => setOpen((o) => !o)}
      activeOpacity={0.8}
      style={faqStyle.item}
    >
      <View style={faqStyle.row}>
        <Text style={faqStyle.q}>{q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={VectaColors.textMuted} />
      </View>
      {open && <Text style={faqStyle.a}>{a}</Text>}
    </TouchableOpacity>
  );
}

const faqStyle = StyleSheet.create({
  item: { borderBottomWidth: 1, borderBottomColor: VectaColors.border, paddingVertical: VectaSpacing['3'] },
  row:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  q:    { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text, flex: 1 },
  a:    { fontFamily: VectaFonts.regular,  fontSize: VectaFonts.xs, color: VectaColors.textSecondary, marginTop: VectaSpacing['2'], lineHeight: 18 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function EsimManagementScreen() {
  const { colors }  = useTheme();
  const [activating, setActivating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'inactive' | 'activated'>('inactive');
  const activated = status === 'activated';

  const handleActivate = useCallback(async () => {
    try {
      setActivating(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/housing/esim/activate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan: '5g_unlimited' }),
      });
      const data = await res.json() as { qrCodeUrl?: string; message?: string };
      if (data.qrCodeUrl) {
        setQrCodeUrl(data.qrCodeUrl);
        setStatus('activated');
      } else if (data.message) {
        Alert.alert('eSIM Submitted', data.message);
      } else {
        Alert.alert(
          'eSIM',
          'Activation submitted. Your QR code will arrive via email within 15 minutes.',
        );
      }
    } catch {
      Alert.alert('Error', 'Could not activate eSIM. Please check your connection and try again.');
    } finally {
      setActivating(false);
    }
  }, []);

  const gradient: [string, string] = ['#0284C7', '#06B6D4'];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface1 }}>
      {/* Header */}
      <LinearGradient colors={gradient} style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={20} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerIcon}>
          <Ionicons name="cellular" size={32} color="#FFF" />
        </View>
        <Text style={styles.headerTitle}>US eSIM</Text>
        <Text style={styles.headerSub}>Get a US number in 3 minutes</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: VectaSpacing['4'], paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* Status card */}
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: activated ? VectaColors.success : VectaColors.warning }]} />
            <Text style={styles.statusLabel}>
              {activated ? 'eSIM Active' : 'Not Activated'}
            </Text>
          </View>

          {activated && qrCodeUrl ? (
            <View style={styles.qrSection}>
              <Text style={styles.qrTitle}>Scan to Install eSIM</Text>
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code" size={80} color={VectaColors.primary} />
                <Text style={styles.qrNote}>QR code ready</Text>
              </View>
              <Text style={styles.instructions}>
                Open <Text style={styles.bold}>Settings → Mobile Data → Add eSIM</Text> and scan the QR code above.
              </Text>
            </View>
          ) : activated ? (
            <Text style={styles.activatedNote}>
              Your eSIM is active. Open Settings → Mobile Data to manage it.
            </Text>
          ) : (
            <TouchableOpacity
              style={[styles.activateBtn, activating && { opacity: 0.7 }]}
              onPress={handleActivate}
              disabled={activating}
              activeOpacity={0.88}
            >
              {activating ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="cellular" size={18} color="#FFF" />
                  <Text style={styles.activateBtnText}>Activate US eSIM</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Plan info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Plan Details</Text>
          {Object.entries(PLAN_INFO).map(([key, value]) => (
            <View key={key} style={styles.infoRow}>
              <Text style={styles.infoKey}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
              <Text style={styles.infoVal}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Install instructions */}
        {!activated && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How to Install</Text>
            {[
              'Tap "Activate US eSIM" above',
              'Open Settings → Mobile Data → Add eSIM',
              'Choose "Scan QR Code" and scan the code shown',
              'Your US number will be active within minutes',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        )}

        {/* FAQ */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>FAQ</Text>
          {FAQ.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header:         { paddingTop: 60, paddingBottom: VectaSpacing['6'], paddingHorizontal: VectaSpacing['5'], alignItems: 'flex-start' },
  backBtn:        { width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['4'] },
  headerIcon:     { marginBottom: VectaSpacing['2'] },
  headerTitle:    { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF' },
  headerSub:      { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  card:           { backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['4'], borderWidth: 1, borderColor: VectaColors.border },
  cardTitle:      { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.text, marginBottom: VectaSpacing['3'] },

  statusRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: VectaSpacing['4'] },
  statusDot:      { width: 10, height: 10, borderRadius: 5 },
  statusLabel:    { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text },

  activateBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0284C7', borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'] },
  activateBtnText:{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: '#FFF' },
  activatedNote:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary },

  qrSection:      { alignItems: 'center', gap: VectaSpacing['3'] },
  qrTitle:        { fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.text },
  qrPlaceholder:  { width: 160, height: 160, borderRadius: VectaRadius.lg, backgroundColor: VectaColors.surface1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: VectaColors.border },
  qrNote:         { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 4 },
  instructions:   { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, textAlign: 'center', lineHeight: 20 },
  bold:           { fontFamily: VectaFonts.bold, color: VectaColors.text },

  infoRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: VectaSpacing['2'], borderBottomWidth: 1, borderBottomColor: VectaColors.border },
  infoKey:        { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textMuted },
  infoVal:        { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text },

  stepRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: VectaSpacing['3'], marginBottom: VectaSpacing['3'] },
  stepNum:        { width: 24, height: 24, borderRadius: 12, backgroundColor: '#0284C7', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText:    { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: '#FFF' },
  stepText:       { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary, flex: 1, lineHeight: 20 },
});
