/**
 * profile/reputation.tsx — Vecta portable reputation (score + W3C VC share)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { API_V1_BASE } from '../../config/api';
import { useStudentStore } from '../../stores';
import {
  VectaColors,
  VectaFonts,
  VectaSpacing,
  VectaRadius,
} from '../../constants/theme';

type Tier = 'BUILDING' | 'FAIR' | 'GOOD' | 'EXCELLENT';

type ScorePayload = {
  score?: number;
  tier?: string;
  on_time_payments?: number;
  total_payments?: number;
  repayment_rate?: number;
  months_of_history?: number;
  last_calculated?: string;
  message?: string;
};

function tierColor(tier: string): string {
  switch (tier) {
    case 'EXCELLENT':
      return '#22C55E';
    case 'GOOD':
      return '#14B8A6';
    case 'FAIR':
      return '#F97316';
    default:
      return '#EF4444';
  }
}

function gaugeColor(score: number): string {
  if (score >= 700) return '#22C55E';
  if (score >= 600) return '#14B8A6';
  if (score >= 500) return '#F97316';
  return '#EF4444';
}

export default function ReputationScreen() {
  const { authToken, profile } = useStudentStore();
  const [data, setData] = useState<ScorePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [anchorOpen, setAnchorOpen] = useState(false);

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    fetch(`${API_V1_BASE}/reputation/score`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((j: ScorePayload) => setData(j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [authToken]);

  const score    = data?.score ?? 300;
  const tier     = (data?.tier ?? 'BUILDING') as Tier;
  const onTime   = data?.on_time_payments ?? 0;
  const months   = data?.months_of_history ?? 0;
  const repayPct = Math.round((Number(data?.repayment_rate) || 0) * 100);
  const pct      = Math.min(100, Math.max(0, ((score - 300) / (850 - 300)) * 100));

  const shareReputation = useCallback(async () => {
    if (!authToken || !profile?.id) {
      Alert.alert('Sign in required', 'Log in to share your reputation credential.');
      return;
    }
    try {
      const res = await fetch(`${API_V1_BASE}/certificate/me/reputation-vc`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Could not load credential', (err as { error?: string }).error ?? 'Try again later.');
        return;
      }
      const vc = await res.json();
      const link = `https://verify.vecta.io/reputation/${profile.id}`;
      const body = `${JSON.stringify(vc, null, 2)}\n\nVerify: ${link}`;
      await Share.share({
        message: body,
        title: 'Vecta Reputation Credential',
      });
    } catch {
      Alert.alert('Share failed', 'Please try again.');
    }
  }, [authToken, profile?.id]);

  if (!authToken) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Sign in to view your reputation.</Text>
        <TouchableOpacity onPress={() => router.replace('/auth/login')} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Go to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Reputation',
          headerStyle: { backgroundColor: '#001F3F' },
          headerTintColor: '#FFF',
          headerTitleStyle: { fontFamily: VectaFonts.bold },
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <LinearGradient colors={['#001F3F', '#003A5C']} style={styles.hero}>
          <Text style={styles.heroEyebrow}>Vecta Reputation</Text>
          <Text style={styles.heroSub}>Your portable credit history</Text>
        </LinearGradient>

        {loading ? (
          <ActivityIndicator size="large" color={VectaColors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={styles.gaugeWrap}>
              <View
                style={[
                  styles.gaugeRing,
                  { borderColor: gaugeColor(score), shadowColor: gaugeColor(score) },
                ]}
              >
                <Text style={[styles.scoreNum, { color: gaugeColor(score) }]}>{score}</Text>
                <Text style={styles.scoreScale}>300 – 850</Text>
              </View>
              <Text style={[styles.tierLabel, { color: tierColor(tier) }]}>{tier}</Text>
            </View>

            <View style={styles.barTrack}>
              <LinearGradient
                colors={[gaugeColor(score), `${gaugeColor(score)}88`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.barFill, { width: `${pct}%` }]}
              />
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{onTime}</Text>
                <Text style={styles.statLbl}>On-time payments</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{months}</Text>
                <Text style={styles.statLbl}>Months of history</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{repayPct}%</Text>
                <Text style={styles.statLbl}>Repayment rate</Text>
              </View>
            </View>

            {data?.message && (
              <Text style={styles.hint}>{data.message}</Text>
            )}

            <Text style={styles.sectionTitle}>What builds your score</Text>
            {[
              { t: 'On-time rent payment', pts: '+15 points each' },
              { t: 'Completing a lease', pts: '+30 points' },
              { t: 'Identity verified', pts: '+50 points (one-time)' },
              { t: 'Insurance maintained', pts: '+5 / month' },
              { t: 'Referral', pts: '+20 points' },
            ].map((row) => (
              <View key={row.t} style={styles.infoCard}>
                <Ionicons name="trending-up" size={18} color="#00B8A4" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle}>{row.t}</Text>
                  <Text style={styles.infoPts}>{row.pts}</Text>
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.shareBtn} onPress={shareReputation} activeOpacity={0.88}>
              <LinearGradient
                colors={['#001F3F', '#00B8A4']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.shareGrad}
              >
                <Ionicons name="share-outline" size={22} color="#FFF" />
                <Text style={styles.shareText}>Share Reputation</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.anchorRow} onPress={() => setAnchorOpen(true)}>
              <Ionicons name="information-circle-outline" size={18} color={VectaColors.textMuted} />
              <Text style={styles.anchorText}>
                Last anchored to public record:{' '}
                {data?.last_calculated
                  ? new Date(data.last_calculated).toLocaleDateString()
                  : '—'}
              </Text>
              <Text style={styles.anchorLink}>What does this mean?</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={anchorOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Daily anchor</Text>
            <Text style={styles.modalBody}>
              Each day, Vecta hashes aggregate reputation scores and publishes an anchor to our public
              audit trail (GitHub gist + manifest). It proves the score you see existed on that date
              without putting personal data on a blockchain.
            </Text>
            <TouchableOpacity onPress={() => setAnchorOpen(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#F8FAFC' },
  content:  { paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#F8FAFC' },
  muted:    { fontFamily: VectaFonts.regular, color: VectaColors.textMuted, textAlign: 'center' },
  primaryBtn: { marginTop: 16, backgroundColor: '#001F3F', paddingHorizontal: 20, paddingVertical: 12, borderRadius: VectaRadius.lg },
  primaryBtnText: { color: '#FFF', fontFamily: VectaFonts.bold },

  hero:     { paddingTop: 8, paddingBottom: 20, paddingHorizontal: VectaSpacing['6'] },
  heroEyebrow:{ fontFamily: VectaFonts.extraBold, fontSize: 22, color: '#FFF' },
  heroSub:  { fontFamily: VectaFonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  gaugeWrap:{ alignItems: 'center', marginTop: -32, marginBottom: 8 },
  gaugeRing:{
    width:           200,
    height:          200,
    borderRadius:    100,
    borderWidth:     10,
    backgroundColor: '#FFF',
    alignItems:      'center',
    justifyContent:  'center',
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.2,
    shadowRadius:    16,
    elevation:       8,
  },
  scoreNum: { fontFamily: VectaFonts.extraBold, fontSize: 44 },
  scoreScale:{ fontFamily: VectaFonts.regular, fontSize: 11, color: VectaColors.textMuted },
  tierLabel:{ fontFamily: VectaFonts.bold, fontSize: 14, marginTop: 10, letterSpacing: 1 },

  barTrack: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, marginHorizontal: VectaSpacing['6'], overflow: 'hidden' },
  barFill:  { height: '100%', borderRadius: 4 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingHorizontal: VectaSpacing['5'] },
  stat:     { flex: 1, alignItems: 'center' },
  statVal:  { fontFamily: VectaFonts.bold, fontSize: 18, color: '#001F3F' },
  statLbl:  { fontFamily: VectaFonts.regular, fontSize: 11, color: VectaColors.textMuted, textAlign: 'center', marginTop: 4 },

  hint:     { marginHorizontal: VectaSpacing['6'], marginTop: 16, fontSize: 13, color: VectaColors.textSecondary, textAlign: 'center' },

  sectionTitle: {
    fontFamily:   VectaFonts.bold,
    fontSize:     13,
    color:        VectaColors.text,
    marginTop:    28,
    marginBottom: 12,
    marginHorizontal: VectaSpacing['6'],
  },
  infoCard: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    marginHorizontal: VectaSpacing['4'],
    marginBottom:   8,
    padding:        14,
    borderRadius:   VectaRadius.lg,
    backgroundColor:'#FFF',
    borderWidth:    1,
    borderColor:    '#E2E8F0',
  },
  infoTitle:{ fontFamily: VectaFonts.semiBold, fontSize: 14, color: VectaColors.text },
  infoPts:  { fontFamily: VectaFonts.regular, fontSize: 12, color: VectaColors.textMuted, marginTop: 2 },

  shareBtn: { marginHorizontal: VectaSpacing['4'], marginTop: 24, borderRadius: VectaRadius.xl, overflow: 'hidden' },
  shareGrad:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  shareText:{ fontFamily: VectaFonts.bold, color: '#FFF', fontSize: 16 },

  anchorRow:{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 20, marginHorizontal: VectaSpacing['6'] },
  anchorText:{ fontFamily: VectaFonts.regular, fontSize: 12, color: VectaColors.textMuted, flex: 1 },
  anchorLink:{ fontFamily: VectaFonts.semiBold, fontSize: 12, color: '#00B8A4' },

  modalBackdrop:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard:    { backgroundColor: '#FFF', borderRadius: 16, padding: 20 },
  modalTitle:   { fontFamily: VectaFonts.bold, fontSize: 18, color: '#001F3F', marginBottom: 8 },
  modalBody:    { fontFamily: VectaFonts.regular, fontSize: 14, color: VectaColors.textSecondary, lineHeight: 22 },
  modalClose:   { marginTop: 16, alignSelf: 'flex-end' },
  modalCloseText:{ fontFamily: VectaFonts.bold, color: '#00B8A4', fontSize: 15 },
});
