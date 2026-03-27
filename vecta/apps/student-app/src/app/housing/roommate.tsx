/**
 * housing/roommate.tsx — AI Roommate Finder
 *
 * Step 1: Lifestyle profile form (sleep, noise, guests, diet, budget, move-in)
 * Step 2: AI matches via pgvector cosine similarity (compliance-ai)
 * Step 3: Match cards with compatibility score + contact initiation
 *
 * Privacy: No PII in match results — compatibility score + lifestyle attributes only.
 * Country of origin, passport info, exact balance never included.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { VectaBadge, SkeletonLoader } from '../../components/ui';
import { API_V1_BASE } from '../../config/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoommateMatch {
  student_id:        string;
  compatibility_score: number;        // 0–1
  sleep_schedule:    string;
  cleanliness:       string;
  noise_level:       string;
  major_category:    string;
  languages:         string[];
  budget_min:        number;
  budget_max:        number;
  university_name:   string;
}

interface ProfileForm {
  sleepSchedule:  'early_bird' | 'night_owl' | 'flexible';
  cleanliness:    'very_clean' | 'clean' | 'relaxed';
  guestPolicy:    'no_guests' | 'occasional' | 'frequent';
  noiseLevel:     'very_quiet' | 'moderate' | 'social';
  studyHabits:    'library' | 'home_quiet' | 'home_music' | 'cafe';
  budgetMin:      number;
  budgetMax:      number;
  moveInDate:     string;
}

// ---------------------------------------------------------------------------
// Mock data shown when API is offline
// ---------------------------------------------------------------------------

const MOCK_MATCHES: RoommateMatch[] = [
  { student_id: '1', compatibility_score: 0.94, major_category: 'Computer Science', university_name: 'MIT', sleep_schedule: 'flexible',   cleanliness: 'clean',      noise_level: 'moderate',   languages: ['English', 'Hindi'],    budget_min: 900,  budget_max: 1800 },
  { student_id: '2', compatibility_score: 0.87, major_category: 'Engineering',      university_name: 'MIT', sleep_schedule: 'early_bird', cleanliness: 'very_clean', noise_level: 'very_quiet', languages: ['English', 'Tamil'],    budget_min: 800,  budget_max: 1600 },
  { student_id: '3', compatibility_score: 0.81, major_category: 'Business',         university_name: 'MIT', sleep_schedule: 'flexible',   cleanliness: 'clean',      noise_level: 'moderate',   languages: ['English', 'Mandarin'], budget_min: 1000, budget_max: 2000 },
];

// ---------------------------------------------------------------------------
// Option selector component
// ---------------------------------------------------------------------------

function OptionGroup<T extends string>({
  label, options, value, onChange,
}: {
  label:    string;
  options:  Array<{ value: T; label: string; emoji?: string }>;
  value:    T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={og.container}>
      <Text style={og.label}>{label}</Text>
      <View style={og.row}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[og.option, value === opt.value && og.optionSelected]}
            activeOpacity={0.8}
          >
            {opt.emoji ? <Text style={{ fontSize: 14 }}>{opt.emoji}</Text> : null}
            <Text style={[og.optionText, value === opt.value && og.optionTextSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const og = StyleSheet.create({
  container:           { marginBottom: VectaSpacing['4'] },
  label:               { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text, marginBottom: VectaSpacing['2'] },
  row:                 { flexDirection: 'row', flexWrap: 'wrap', gap: VectaSpacing['2'] },
  option:              { paddingHorizontal: VectaSpacing['3'], paddingVertical: VectaSpacing['2'], borderRadius: VectaRadius.full, borderWidth: 1, borderColor: VectaColors.border, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: VectaColors.surfaceBase },
  optionSelected:      { borderColor: VectaColors.housing, backgroundColor: VectaColors.housingBg },
  optionText:          { fontFamily: VectaFonts.medium, fontSize: VectaFonts.xs, color: VectaColors.textSecondary },
  optionTextSelected:  { color: VectaColors.housing, fontFamily: VectaFonts.bold },
});

// ---------------------------------------------------------------------------
// Match card
// ---------------------------------------------------------------------------

function MatchCard({ match, rank }: { match: RoommateMatch; rank: number }) {
  const scorePercent = Math.round(match.compatibility_score * 100);
  const scoreColor =
    scorePercent >= 90 ? VectaColors.success :
    scorePercent >= 75 ? VectaColors.housing :
    VectaColors.warning;

  return (
    <View style={mc.card}>
      {/* Score badge */}
      <View style={mc.header}>
        <View style={mc.rankBadge}>
          <Text style={mc.rankText}>#{rank}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={mc.majorText}>{match.major_category}</Text>
          <Text style={mc.universityText}>{match.university_name}</Text>
        </View>
        <View style={[mc.scoreBadge, { backgroundColor: scoreColor + '18' }]}>
          <Text style={[mc.scoreText, { color: scoreColor }]}>{scorePercent}%</Text>
          <Text style={[mc.scoreLabel, { color: scoreColor }]}>match</Text>
        </View>
      </View>

      {/* Attributes */}
      <View style={mc.attrs}>
        {[
          { icon: 'moon',        val: match.sleep_schedule.replace('_', ' ') },
          { icon: 'sparkles',    val: match.cleanliness.replace('_', ' ')    },
          { icon: 'volume-medium',val: match.noise_level.replace('_', ' ')  },
        ].map(({ icon, val }) => (
          <View key={icon} style={mc.attr}>
            <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={12} color={VectaColors.textMuted} />
            <Text style={mc.attrText}>{val}</Text>
          </View>
        ))}
      </View>

      {/* Budget + languages */}
      <View style={mc.footer}>
        <Text style={mc.budgetText}>
          ${match.budget_min.toLocaleString()} – ${match.budget_max.toLocaleString()}/mo
        </Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {match.languages.slice(0, 3).map((lang) => (
            <VectaBadge key={lang} label={lang} variant="info" />
          ))}
        </View>
      </View>

      <TouchableOpacity style={mc.connectBtn} activeOpacity={0.85}
        onPress={() => Alert.alert('Connect', 'This will send an anonymous connection request through Vecta.')}>
        <Ionicons name="chatbubble-outline" size={14} color={VectaColors.housing} />
        <Text style={mc.connectText}>Request Connection</Text>
      </TouchableOpacity>
    </View>
  );
}

const mc = StyleSheet.create({
  card:        { backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['3'], borderWidth: 1, borderColor: VectaColors.border },
  header:      { flexDirection: 'row', alignItems: 'flex-start', gap: VectaSpacing['3'], marginBottom: VectaSpacing['3'] },
  rankBadge:   { width: 28, height: 28, borderRadius: VectaRadius.full, backgroundColor: VectaColors.surface2, alignItems: 'center', justifyContent: 'center' },
  rankText:    { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted },
  majorText:   { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.text },
  universityText: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 },
  scoreBadge:  { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: VectaRadius.lg },
  scoreText:   { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.xl },
  scoreLabel:  { fontFamily: VectaFonts.regular, fontSize: 9, letterSpacing: 1 },
  attrs:       { flexDirection: 'row', flexWrap: 'wrap', gap: VectaSpacing['2'], marginBottom: VectaSpacing['3'] },
  attr:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: VectaColors.surface1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: VectaRadius.full },
  attrText:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textSecondary, textTransform: 'capitalize' },
  footer:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: VectaSpacing['3'] },
  budgetText:  { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.xs, color: VectaColors.text },
  connectBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: VectaSpacing['2'], backgroundColor: VectaColors.housingBg, borderRadius: VectaRadius.md },
  connectText: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.housing },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE: ProfileForm = {
  sleepSchedule: 'flexible',
  cleanliness:   'clean',
  guestPolicy:   'occasional',
  noiseLevel:    'moderate',
  studyHabits:   'home_quiet',
  budgetMin:     800,
  budgetMax:     1800,
  moveInDate:    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
};

export default function RoommateScreen() {
  const { authToken, profile } = useStudentStore();
  const [step,      setStep]   = useState<'profile' | 'matches'>('profile');
  const [usingMock, setUsingMock] = useState(false);
  const [form,      setForm]   = useState<ProfileForm>(DEFAULT_PROFILE);
  const [matches,   setMatches]  = useState<RoommateMatch[]>([]);
  const [loading,   setLoading]  = useState(false);
  const [refreshing,setRefreshing] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      // 1. Upsert lifestyle profile + generate embedding
      await fetch(`${API_V1_BASE}/housing/roommate/profile`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sleepSchedule:  form.sleepSchedule,
          cleanliness:    form.cleanliness,
          guestPolicy:    form.guestPolicy,
          noiseLevel:     form.noiseLevel,
          studyHabits:    form.studyHabits,
          dietaryNeeds:   [],
          languages:      ['English'],
          majorCategory:  profile?.programOfStudy ?? 'General',
          interests:      [],
          budgetMin:      form.budgetMin,
          budgetMax:      form.budgetMax,
          moveInDate:     form.moveInDate,
        }),
      });

      // 2. Fetch matches
      const res = await fetch(`${API_V1_BASE}/housing/roommate/matches`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json() as { matches: RoommateMatch[] };
      setMatches(data.matches ?? []);
      setStep('matches');
    } catch {
      setMatches(MOCK_MATCHES);
      setUsingMock(true);
      setStep('matches');
    } finally {
      setLoading(false);
    }
  }, [authToken, form, profile]);

  const onRefresh = useCallback(async () => {
    if (step !== 'matches') return;
    setRefreshing(true);
    await handleSearch();
    setRefreshing(false);
  }, [step, handleSearch]);

  return (
    <View style={{ flex: 1, backgroundColor: VectaColors.surface1 }}>
      <LinearGradient colors={VectaGradients.housing} style={screen.header}>
        <TouchableOpacity onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['3'] }}>
          <Ionicons name="chevron-back" size={20} color="#FFF" />
        </TouchableOpacity>
        <Text style={screen.title}>AI Roommate Finder</Text>
        <Text style={screen.subtitle}>pgvector · Lifestyle Match · {profile?.universityName ?? 'Your University'}</Text>
      </LinearGradient>

      {step === 'profile' ? (
        <ScrollView contentContainerStyle={{ padding: VectaSpacing['4'], paddingBottom: 60 }}>
          <Text style={screen.sectionLabel}>YOUR LIFESTYLE</Text>

          <OptionGroup label="Sleep Schedule" value={form.sleepSchedule}
            onChange={(v) => setForm(f => ({ ...f, sleepSchedule: v }))}
            options={[
              { value: 'early_bird', label: 'Early Bird', emoji: '🌅' },
              { value: 'flexible',   label: 'Flexible',   emoji: '🔄' },
              { value: 'night_owl',  label: 'Night Owl',  emoji: '🌙' },
            ]} />

          <OptionGroup label="Cleanliness" value={form.cleanliness}
            onChange={(v) => setForm(f => ({ ...f, cleanliness: v }))}
            options={[
              { value: 'very_clean', label: 'Spotless', emoji: '✨' },
              { value: 'clean',      label: 'Tidy',     emoji: '🧹' },
              { value: 'relaxed',    label: 'Relaxed',  emoji: '😌' },
            ]} />

          <OptionGroup label="Noise Level" value={form.noiseLevel}
            onChange={(v) => setForm(f => ({ ...f, noiseLevel: v }))}
            options={[
              { value: 'very_quiet', label: 'Quiet',    emoji: '🤫' },
              { value: 'moderate',   label: 'Moderate', emoji: '🎵' },
              { value: 'social',     label: 'Social',   emoji: '🎉' },
            ]} />

          <OptionGroup label="Guests" value={form.guestPolicy}
            onChange={(v) => setForm(f => ({ ...f, guestPolicy: v }))}
            options={[
              { value: 'no_guests',  label: 'No Guests', emoji: '🚫' },
              { value: 'occasional', label: 'Sometimes',  emoji: '👋' },
              { value: 'frequent',   label: 'Often',      emoji: '🏠' },
            ]} />

          <OptionGroup label="Study Habits" value={form.studyHabits}
            onChange={(v) => setForm(f => ({ ...f, studyHabits: v }))}
            options={[
              { value: 'library',    label: 'Library',  emoji: '📚' },
              { value: 'home_quiet', label: 'Home/Quiet',emoji: '🏡' },
              { value: 'cafe',       label: 'Café',     emoji: '☕' },
            ]} />

          {/* Budget */}
          <Text style={og.label}>Monthly Budget</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], marginBottom: VectaSpacing['4'] }}>
            <View style={{ flex: 1, backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.lg, borderWidth: 1, borderColor: VectaColors.border, padding: VectaSpacing['3'], alignItems: 'center' }}>
              <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.lg, color: VectaColors.housing }}>${form.budgetMin.toLocaleString()}</Text>
              <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted }}>Min</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={VectaColors.textMuted} />
            <View style={{ flex: 1, backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.lg, borderWidth: 1, borderColor: VectaColors.border, padding: VectaSpacing['3'], alignItems: 'center' }}>
              <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.lg, color: VectaColors.housing }}>${form.budgetMax.toLocaleString()}</Text>
              <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted }}>Max</Text>
            </View>
          </View>

          <TouchableOpacity onPress={handleSearch} disabled={loading}
            style={[screen.searchBtn, loading && { opacity: 0.7 }]}>
            {loading ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="search" size={18} color="#FFF" />
                <Text style={screen.searchBtnText}>Find Roommates</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={screen.privacyNote}>
            🔒 Your exact budget, name, and personal details are never shared. Matches see only lifestyle compatibility.
          </Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: VectaSpacing['4'], paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VectaColors.housing} />}>

          <View style={screen.matchHeader}>
            <Text style={screen.sectionLabel}>{matches.length} MATCHES FOUND</Text>
            <TouchableOpacity onPress={() => setStep('profile')}>
              <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.xs, color: VectaColors.housing }}>Edit Preferences</Text>
            </TouchableOpacity>
          </View>

          {usingMock && (
            <View style={{ backgroundColor: '#FFF7ED', borderRadius: VectaRadius.md, padding: VectaSpacing['3'], marginBottom: VectaSpacing['3'], flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="wifi-outline" size={14} color="#C2410C" />
              <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: '#9A3412', flex: 1 }}>
                Live AI matching activates when compliance service is online
              </Text>
            </View>
          )}
          {matches.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['10'], gap: VectaSpacing['3'] }}>
              <Ionicons name="people-outline" size={48} color={VectaColors.textMuted} />
              <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textMuted }}>No matches yet</Text>
              <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center' }}>
                More students join every day. Check back soon!
              </Text>
            </View>
          ) : (
            matches.map((match, i) => <MatchCard key={match.student_id} match={match} rank={i + 1} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

const screen = StyleSheet.create({
  header:       { paddingTop: 60, paddingBottom: VectaSpacing['5'], paddingHorizontal: VectaSpacing['5'] },
  title:        { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF' },
  subtitle:     { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  sectionLabel: { fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted, letterSpacing: VectaFonts.letterSpacing.wider, marginBottom: VectaSpacing['4'] },
  searchBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', backgroundColor: VectaColors.housing, borderRadius: VectaRadius.full, paddingVertical: VectaSpacing['4'], marginBottom: VectaSpacing['3'] },
  searchBtnText:{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: '#FFF' },
  privacyNote:  { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center', lineHeight: 18 },
  matchHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: VectaSpacing['3'] },
});
