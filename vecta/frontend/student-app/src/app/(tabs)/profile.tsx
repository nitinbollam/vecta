/**
 * (tabs)/profile.tsx — Vecta Profile & Settings Tab
 */

import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Share, Alert, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';
import { useStudentStore, useHousingStore, useMobilityStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { VectaIDStatusBadge, VectaBadge } from '../../components/ui';

// ---------------------------------------------------------------------------
// Mini Vecta ID card preview (tappable, shown above Platform Status)
// ---------------------------------------------------------------------------

function VectaIDCardPreview() {
  const { colors }       = useTheme();
  const { profile, authToken } = useStudentStore();
  const [cardData, setCardData] = React.useState<{
    frontUrl?: string; vectaIdNumber?: string; status?: string;
  } | null>(null);

  React.useEffect(() => {
    if (!authToken) return;
    fetch(`${require('../../config/api').API_V1_BASE}/identity/id-card`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.json())
      .then((d: { exists: boolean; frontUrl?: string; vectaIdNumber?: string; status?: string }) => {
        if (d.exists) setCardData(d);
      })
      .catch(() => {});
  }, [authToken]);

  const screenW = require('react-native').Dimensions.get('window').width;
  const cardW   = screenW * 0.8;
  const cardH   = cardW / 1.586;

  return (
    <TouchableOpacity
      onPress={() => router.push('/profile/vecta-id')}
      activeOpacity={0.88}
      style={previewStyle.wrapper}
    >
      <View style={[previewStyle.cardShell, { width: cardW, height: cardH, shadowColor: '#00E6CC' }]}>
        {cardData?.frontUrl ? (
          <Image source={{ uri: cardData.frontUrl }} style={{ width: cardW, height: cardH, borderRadius: 12 }} />
        ) : (
          <LinearGradient colors={['#001F3F', '#001A33']} style={[previewStyle.placeholder, { width: cardW, height: cardH }]}>
            <Ionicons name="shield-checkmark-outline" size={36} color="#00E6CC" />
            <Text style={previewStyle.placeholderText}>
              {profile?.kycStatus === 'APPROVED' ? 'Tap to generate your card' : 'Complete KYC to get your card'}
            </Text>
          </LinearGradient>
        )}

        {/* Name overlay */}
        {profile?.fullName && (
          <View style={previewStyle.nameOverlay}>
            <Text style={previewStyle.nameText} numberOfLines={1}>{profile.fullName}</Text>
            {cardData?.vectaIdNumber && (
              <Text style={previewStyle.vidText}>
                {cardData.vectaIdNumber.split('-').slice(-1)[0]}
              </Text>
            )}
          </View>
        )}

        {/* VERIFIED badge */}
        {profile?.vectaIdStatus === 'VERIFIED' && (
          <View style={previewStyle.verifiedBadge}>
            <Text style={previewStyle.verifiedText}>VERIFIED</Text>
          </View>
        )}
      </View>

      <Text style={[previewStyle.viewLink, { color: '#00E6CC' }]}>View Full Card →</Text>
    </TouchableOpacity>
  );
}

const previewStyle = StyleSheet.create({
  wrapper:        { alignItems: 'center', marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['4'] },
  cardShell:      { borderRadius: 12, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 10, overflow: 'hidden' },
  placeholder:    { borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText:{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', paddingHorizontal: 16 },
  nameOverlay:    { position: 'absolute', bottom: 10, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  nameText:       { color: '#FFF', fontSize: 11, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4, flex: 1 },
  vidText:        { color: 'rgba(0,230,204,0.9)', fontSize: 10, fontFamily: 'Courier', marginLeft: 8 },
  verifiedBadge:  { position: 'absolute', top: 10, right: 10, backgroundColor: '#00C896', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  verifiedText:   { color: '#FFF', fontSize: 9, fontWeight: '800' },
  viewLink:       { marginTop: 8, fontSize: 13, fontWeight: '600' },
});

// ---------------------------------------------------------------------------
// Profile hero
// ---------------------------------------------------------------------------

function ProfileHero() {
  const { profile } = useStudentStore();
  if (!profile) return null;

  return (
    <LinearGradient colors={VectaGradients.hero} style={heroStyle.container}>
      <View style={heroStyle.avatarWrap}>
        {profile.selfieUrl ? (
          <Image source={{ uri: profile.selfieUrl }} style={heroStyle.avatar} />
        ) : (
          <View style={[heroStyle.avatar, heroStyle.avatarPlaceholder]}>
            <Ionicons name="person" size={40} color="rgba(255,255,255,0.6)" />
          </View>
        )}
        {profile.vectaIdStatus === 'VERIFIED' && (
          <View style={heroStyle.verifiedRing}>
            <Ionicons name="shield-checkmark" size={16} color={VectaColors.success} />
          </View>
        )}
      </View>

      <Text style={heroStyle.name}>{profile.fullName}</Text>
      <Text style={heroStyle.university}>{profile.universityName}</Text>
      <Text style={heroStyle.program}>{profile.programOfStudy}</Text>

      <View style={{ marginTop: VectaSpacing['3'] }}>
        <VectaIDStatusBadge status={profile.vectaIdStatus} />
      </View>
      {profile.role === 'LESSOR' && (
        <View style={{ marginTop: VectaSpacing['2'] }}>
          <VectaBadge label="LESSOR — Schedule E Active" variant="warning" />
        </View>
      )}
    </LinearGradient>
  );
}

const heroStyle = StyleSheet.create({
  container:          { paddingTop: 60, paddingBottom: VectaSpacing['8'], alignItems: 'center', paddingHorizontal: VectaSpacing['6'] },
  avatarWrap:         { position: 'relative', marginBottom: VectaSpacing['3'] },
  avatar:             { width: 96, height: 96, borderRadius: VectaRadius.full, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  avatarPlaceholder:  { backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  verifiedRing:       { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: VectaRadius.full, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  name:               { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF', textAlign: 'center' },
  university:         { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 2 },
  program:            { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
});

// ---------------------------------------------------------------------------
// Share Vecta ID
// ---------------------------------------------------------------------------

function ShareVectaID() {
  const { profile, mintVectaIdToken } = useStudentStore();
  const [minting, setMinting] = useState(false);

  const handleShare = useCallback(() => {
    Alert.alert(
      'Share Vecta ID',
      'Choose what to share',
      [
        {
          text: 'Share Verification Link',
          onPress: async () => {
            if (!profile?.vectaIdToken) {
              setMinting(true);
              await mintVectaIdToken();
              setMinting(false);
            }
            if (profile?.vectaIdToken) {
              const verifyUrl = `https://verify.vecta.io/verify/${profile.vectaIdToken}`;
              await Share.share({
                url:     verifyUrl,
                title:   'My Vecta Verified Identity',
                message: `Verify my identity and financial standing at: ${verifyUrl}`,
              });
            }
          },
        },
        {
          text: 'Share Vecta ID Card',
          onPress: async () => {
            router.push('/profile/vecta-id');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [profile, mintVectaIdToken]);

  if (profile?.vectaIdStatus !== 'VERIFIED') return null;

  return (
    <TouchableOpacity onPress={handleShare} disabled={minting} style={shareStyle.btn} activeOpacity={0.88}>
      <LinearGradient colors={['#001F3F', '#003060']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={shareStyle.gradient}>
        <Ionicons name="share-outline" size={20} color="#FFF" />
        <View>
          <Text style={shareStyle.label}>{minting ? 'Generating link…' : 'Share Vecta ID with Landlord'}</Text>
          <Text style={shareStyle.sub}>30-day verification link · NFC-secured</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
      </LinearGradient>
    </TouchableOpacity>
  );
}

const shareStyle = StyleSheet.create({
  btn:      { marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['4'], borderRadius: VectaRadius.xl, overflow: 'hidden' },
  gradient: { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], padding: VectaSpacing['4'] },
  label:    { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' },
  sub:      { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
});

// ---------------------------------------------------------------------------
// Module health overview
// ---------------------------------------------------------------------------

type ModuleItem = {
  icon:     keyof typeof Ionicons.glyphMap;
  label:    string;
  status:   'ok' | 'pending' | 'idle';
  detail:   string;
  onPress?: () => void;
};

function ModuleHealth() {
  const { colors }              = useTheme();
  const { profile, authToken }  = useStudentStore();
  const { trustScore } = useHousingStore();
  const { vehicles }            = useMobilityStore();
  const [repSummary, setRepSummary] = React.useState<{ score: number; tier: string } | null>(null);

  React.useEffect(() => {
    if (!authToken) return;
    fetch(`${require('../../config/api').API_V1_BASE}/reputation/score`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((d: { score?: number; tier?: string }) => {
        if (typeof d.score === 'number' && d.tier) setRepSummary({ score: d.score, tier: d.tier });
      })
      .catch(() => {});
  }, [authToken]);

  const modules: ModuleItem[] = [
    {
      icon: 'finger-print',
      label: 'Identity',
      status: profile?.vectaIdStatus === 'VERIFIED' ? 'ok' : 'pending',
      detail: profile?.vectaIdStatus === 'VERIFIED' ? 'NFC Verified' : 'Not verified',
    },
    {
      icon: 'card',
      label: 'Banking',
      status: profile?.kycStatus === 'APPROVED' ? 'ok' : 'pending',
      detail: profile?.kycStatus === 'APPROVED' ? 'Account active' : 'KYC pending',
    },
    {
      icon: 'cellular',
      label: 'SIM',
      status: 'ok',
      detail: 'eSIM active',
      onPress: () => router.push('/esim'),
    },
    {
      icon: 'home',
      label: 'Housing',
      status: trustScore ? 'ok' : 'pending',
      detail: trustScore ? `Score: ${trustScore.score}` : 'Bank not linked',
    },
    {
      icon: 'ribbon',
      label: 'Reputation',
      status: repSummary ? 'ok' : 'pending',
      detail: repSummary ? `${repSummary.score} · ${repSummary.tier}` : 'Tap to build history',
      onPress: () => router.push('/profile/reputation'),
    },
    {
      icon: 'car-sport',
      label: 'Fleet',
      status: vehicles.length > 0 ? 'ok' : 'idle',
      detail: vehicles.length > 0 ? `${vehicles.length} vehicle(s)` : 'Not enrolled',
    },
  ];

  return (
    <View style={[healthStyle.container, { backgroundColor: colors.surfaceBase, borderColor: colors.border }]}>
      <Text style={[healthStyle.title, { color: colors.text }]}>Platform Status</Text>
      <View style={healthStyle.grid}>
        {modules.map(({ icon, label, status, detail, onPress }) => (
          <TouchableOpacity
            key={label}
            style={healthStyle.item}
            onPress={onPress}
            disabled={!onPress}
            activeOpacity={onPress ? 0.7 : 1}
          >
            <View style={[healthStyle.dot, {
              backgroundColor:
                status === 'ok'      ? VectaColors.success :
                status === 'pending' ? VectaColors.warning  :
                VectaColors.border,
            }]} />
            <Ionicons name={icon} size={16} color={VectaColors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={healthStyle.itemLabel}>{label}</Text>
              <Text
                style={[
                  healthStyle.itemDetail,
                  label === 'Reputation' && repSummary
                    ? { color: '#00B8A4', fontFamily: VectaFonts.semiBold }
                    : null,
                ]}
              >
                {detail}
              </Text>
            </View>
            {onPress && <Ionicons name="chevron-forward" size={12} color={VectaColors.textMuted} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const healthStyle = StyleSheet.create({
  container:  { marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['4'], backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], borderWidth: 1, borderColor: VectaColors.border },
  title:      { fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: VectaColors.text, marginBottom: VectaSpacing['3'] },
  grid:       { gap: VectaSpacing['2'] },
  item:       { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['2'] },
  dot:        { width: 8, height: 8, borderRadius: VectaRadius.full },
  itemLabel:  { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.text },
  itemDetail: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted },
});

// ---------------------------------------------------------------------------
// Settings row
// ---------------------------------------------------------------------------

interface SettingsRowProps {
  icon:        keyof typeof Ionicons.glyphMap;
  label:       string;
  value?:      string;
  onPress?:    () => void;
  toggle?:     { value: boolean; onChange: (v: boolean) => void };
  destructive?: boolean;
}

function SettingsRow({ icon, label, value, onPress, toggle, destructive }: SettingsRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress && !toggle}
      style={[rowStyle.container, { backgroundColor: colors.surfaceBase, borderBottomColor: colors.border }]}
      activeOpacity={0.7}
    >
      <View style={rowStyle.left}>
        <View style={[rowStyle.iconWrap, { backgroundColor: colors.surface2 }, destructive && { backgroundColor: colors.errorBg }]}>
          <Ionicons name={icon} size={18} color={destructive ? colors.error : colors.primary} />
        </View>
        <Text style={[rowStyle.label, { color: colors.text }, destructive && { color: colors.error }]}>{label}</Text>
      </View>
      <View style={rowStyle.right}>
        {value && <Text style={[rowStyle.value, { color: colors.textMuted }]}>{value}</Text>}
        {toggle && (
          <Switch
            value={toggle.value}
            onValueChange={toggle.onChange}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFF"
          />
        )}
        {onPress && !toggle && (
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const rowStyle = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: VectaSpacing['3'], paddingHorizontal: VectaSpacing['4'], backgroundColor: VectaColors.surfaceBase, borderBottomWidth: 1, borderBottomColor: VectaColors.border },
  left:      { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'] },
  iconWrap:  { width: 34, height: 34, borderRadius: VectaRadius.md, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  label:     { fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.text },
  right:     { flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['2'] },
  value:     { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textMuted },
});

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: colors.textMuted, letterSpacing: VectaFonts.letterSpacing.wider, paddingHorizontal: VectaSpacing['4'], paddingTop: VectaSpacing['5'], paddingBottom: VectaSpacing['2'] }}>
      {title.toUpperCase()}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const LANGUAGES = ['English', 'Spanish', 'Hindi', 'Mandarin', 'Arabic', 'Portuguese'];

const MODE_LABELS: Record<ThemeMode, string> = {
  light: 'Light', dark: 'Dark', system: 'System',
};

export default function ProfileScreen() {
  const { profile, clearSession }             = useStudentStore();
  const { mode, isDark, colors, setMode }     = useTheme();
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [biometricsOn,    setBiometricsOn]    = useState(true);
  const [language,        setLanguage]        = useState('English');

  // Load persisted preferences from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.multiGet(['push_notifications_enabled', 'biometric_auth_enabled', 'preferred_language'])
      .then(([[, notif], [, bio], [, lang]]) => {
        if (notif !== null) setNotificationsOn(notif === 'true');
        if (bio  !== null) setBiometricsOn(bio === 'true');
        if (lang !== null) setLanguage(lang);
      })
      .catch(() => {});
  }, []);

  const handleNotificationsToggle = useCallback(async (value: boolean) => {
    setNotificationsOn(value);
    await AsyncStorage.setItem('push_notifications_enabled', String(value));
    Alert.alert(
      value ? 'Notifications Enabled' : 'Notifications Disabled',
      value ? 'You will receive alerts for important account updates.' : 'You will no longer receive push notifications.',
      [{ text: 'OK' }],
    );
  }, []);

  const handleBiometricsToggle = useCallback(async (value: boolean) => {
    setBiometricsOn(value);
    await AsyncStorage.setItem('biometric_auth_enabled', String(value));
  }, []);

  const handleAppearance = useCallback(() => {
    Alert.alert(
      'Appearance',
      'Choose theme',
      [
        { text: 'Light',  onPress: () => setMode('light')  },
        { text: 'Dark',   onPress: () => setMode('dark')   },
        { text: 'System', onPress: () => setMode('system') },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [setMode]);

  const handleLanguage = useCallback(() => {
    Alert.alert(
      'Select Language',
      '',
      [
        ...LANGUAGES.map((lang) => ({
          text: lang,
          onPress: async () => {
            setLanguage(lang);
            await AsyncStorage.setItem('preferred_language', lang);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Sign Out',
      'Your Vecta ID token will be revoked. You will need to re-authenticate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.multiRemove([
              'push_notifications_enabled',
              'biometric_auth_enabled',
              'preferred_language',
            ]);
            clearSession();
            router.replace('/auth/login');
          },
        },
      ],
    );
  }, [clearSession]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface1 }} showsVerticalScrollIndicator={false}>
      <ProfileHero />
      <VectaIDCardPreview />
      <ShareVectaID />
      <ModuleHealth />

      {/* F-1 Compliance */}
      <SectionHeader title="F-1 Compliance" />
      <SettingsRow icon="document-text"  label="Visa Status"    value={profile?.visaStatus ?? 'F-1'} />
      <SettingsRow icon="school"         label="University"     value={profile?.universityName ?? '—'} />
      <SettingsRow icon="shield"         label="SEVIS Status"   value="Active" />
      {profile?.role === 'LESSOR' && (
        <SettingsRow icon="car" label="Lessor Role" value="Schedule E Active" />
      )}

      {/* Account settings */}
      <SectionHeader title="Account" />
      <SettingsRow
        icon="link"
        label="Sharing Links"
        onPress={() => router.push('/profile/tokens')}
      />
      <SettingsRow
        icon="notifications"
        label="Push Notifications"
        toggle={{ value: notificationsOn, onChange: handleNotificationsToggle }}
      />
      <SettingsRow
        icon="finger-print"
        label="Biometric Auth"
        toggle={{ value: biometricsOn, onChange: handleBiometricsToggle }}
      />
      <SettingsRow
        icon="color-palette"
        label="Appearance"
        value={MODE_LABELS[mode]}
        onPress={handleAppearance}
      />
      <SettingsRow
        icon="language"
        label="Language"
        value={language}
        onPress={handleLanguage}
      />

      {/* Legal */}
      <SectionHeader title="Legal & Support" />
      <SettingsRow icon="shield-checkmark" label="Privacy Policy"     onPress={() => Linking.openURL('https://vecta.io/privacy')} />
      <SettingsRow icon="document"         label="Terms of Service"   onPress={() => Linking.openURL('https://vecta.io/terms')} />
      <SettingsRow icon="mail"             label="Contact Support"    onPress={() => Linking.openURL('mailto:support@vecta.io')} />
      <SettingsRow icon="help-circle"      label="F-1 Compliance FAQ" onPress={() => Linking.openURL('https://vecta.io/f1-faq')} />
      <SettingsRow icon="document-text"    label="App Version"        value="1.0.0" />

      {/* Sign out */}
      <SectionHeader title="Session" />
      <SettingsRow icon="log-out" label="Sign Out" onPress={handleLogout} destructive />

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}
