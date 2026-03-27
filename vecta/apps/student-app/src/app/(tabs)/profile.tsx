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
import { useStudentStore, useBalanceStore, useHousingStore, useMobilityStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { VectaIDStatusBadge, VectaBadge } from '../../components/ui';

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

  const handleShare = useCallback(async () => {
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
  const { profile }             = useStudentStore();
  const { balance }             = useBalanceStore();
  const { trustScore, activeLoC } = useHousingStore();
  const { vehicles }            = useMobilityStore();

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
      icon: 'car-sport',
      label: 'Fleet',
      status: vehicles.length > 0 ? 'ok' : 'idle',
      detail: vehicles.length > 0 ? `${vehicles.length} vehicle(s)` : 'Not enrolled',
    },
  ];

  return (
    <View style={healthStyle.container}>
      <Text style={healthStyle.title}>Platform Status</Text>
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
              <Text style={healthStyle.itemDetail}>{detail}</Text>
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
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress && !toggle}
      style={rowStyle.container}
      activeOpacity={0.7}
    >
      <View style={rowStyle.left}>
        <View style={[rowStyle.iconWrap, destructive && { backgroundColor: VectaColors.errorBg }]}>
          <Ionicons name={icon} size={18} color={destructive ? VectaColors.error : VectaColors.primary} />
        </View>
        <Text style={[rowStyle.label, destructive && { color: VectaColors.error }]}>{label}</Text>
      </View>
      <View style={rowStyle.right}>
        {value && <Text style={rowStyle.value}>{value}</Text>}
        {toggle && (
          <Switch
            value={toggle.value}
            onValueChange={toggle.onChange}
            trackColor={{ false: VectaColors.border, true: VectaColors.primary }}
            thumbColor="#FFF"
          />
        )}
        {onPress && !toggle && (
          <Ionicons name="chevron-forward" size={16} color={VectaColors.textMuted} />
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
  return (
    <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.xs, color: VectaColors.textMuted, letterSpacing: VectaFonts.letterSpacing.wider, paddingHorizontal: VectaSpacing['4'], paddingTop: VectaSpacing['5'], paddingBottom: VectaSpacing['2'] }}>
      {title.toUpperCase()}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const LANGUAGES = ['English', 'Spanish', 'Hindi', 'Mandarin', 'Arabic', 'Portuguese'];

export default function ProfileScreen() {
  const { profile, clearSession } = useStudentStore();
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
    <ScrollView style={{ flex: 1, backgroundColor: VectaColors.surface1 }} showsVerticalScrollIndicator={false}>
      <ProfileHero />
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
