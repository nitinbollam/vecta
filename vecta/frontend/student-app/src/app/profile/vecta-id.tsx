/**
 * apps/student-app/src/app/profile/vecta-id.tsx
 *
 * Vecta ID Card screen — shows the student's digital identity card
 * with flip animation, download, share, and regenerate actions.
 */

import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Alert, Share, ActivityIndicator, Platform, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import { useStudentStore } from '../../stores';
import { API_V1_BASE } from '../../config/api';

// ---------------------------------------------------------------------------
// File system / sharing stubs (require native build — graceful fallback)
// ---------------------------------------------------------------------------

let FileSystem: { downloadAsync: (url: string, dest: string) => Promise<void>; documentDirectory: string | null } | null = null;
let Sharing:    { shareAsync: (uri: string, opts?: object) => Promise<void> } | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FileSystem = require('expo-file-system');
} catch { /* native module not compiled yet */ }

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sharing = require('expo-sharing');
} catch { /* native module not compiled yet */ }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IDCardData {
  exists:         boolean;
  vectaIdNumber:  string;
  pdfUrl:         string;
  frontUrl:       string;
  backUrl:        string;
  issuedAt:       string;
  expiresAt:      string;
  status:         'ACTIVE' | 'EXPIRED';
  kycStatus:      string;
  verificationUrl: string;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W - 40;
const CARD_H = CARD_W / 1.586; // credit card ratio

// ---------------------------------------------------------------------------
// ID Card Display Component (front or back image with glow)
// ---------------------------------------------------------------------------

function IDCardImage({ uri, side }: { uri: string; side: 'front' | 'back' }) {
  return (
    <View style={cardImageStyles.shadow}>
      <Image
        source={{ uri }}
        style={[cardImageStyles.card, { width: CARD_W, height: CARD_H }]}
        resizeMode="cover"
      />
    </View>
  );
}

const cardImageStyles = StyleSheet.create({
  shadow: {
    shadowColor:   '#00E6CC',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius:  20,
    elevation:     12,
    borderRadius:  12,
    marginHorizontal: 20,
  },
  card: {
    borderRadius: 12,
    overflow:     'hidden',
  },
});

// ---------------------------------------------------------------------------
// Empty card placeholder
// ---------------------------------------------------------------------------

function EmptyCardPlaceholder({ onGenerate, onScan, kycStatus, generating }: {
  onGenerate: () => void;
  onScan:     () => void;
  kycStatus:  string;
  generating: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[emptyStyles.frame, { borderColor: '#00E6CC', width: CARD_W, height: CARD_H }]}>
      <Ionicons name="shield-outline" size={52} color="#00E6CC" />
      <Text style={[emptyStyles.title, { color: colors.text }]}>
        Your Vecta ID hasn't been generated yet
      </Text>
      <Text style={[emptyStyles.subtitle, { color: colors.textSecondary }]}>
        {kycStatus === 'APPROVED'
          ? 'Tap below to generate your Vecta ID card'
          : 'Complete passport verification to generate your card'}
      </Text>

      {kycStatus === 'APPROVED' ? (
        <TouchableOpacity
          style={emptyStyles.btn}
          onPress={onGenerate}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator color="#001F3F" size="small" />
          ) : (
            <Text style={emptyStyles.btnText}>Generate My Vecta ID</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={[emptyStyles.btn, { backgroundColor: '#5B4AE8' }]} onPress={onScan}>
          <Text style={emptyStyles.btnText}>Complete Passport Scan First</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  frame:    {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    gap: 10,
    padding: 20,
  },
  title:    { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  btn:      { backgroundColor: '#00E6CC', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8, minWidth: 200, alignItems: 'center' },
  btnText:  { color: '#001F3F', fontWeight: '800', fontSize: 14 },
});

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionBtn({ icon, label, onPress, disabled }: {
  icon: string; label: string; onPress: () => void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[actionStyles.btn, { backgroundColor: colors.surface1 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons name={icon as never} size={24} color="#00E6CC" />
      <Text style={[actionStyles.label, { color: colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const actionStyles = StyleSheet.create({
  btn:   { flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 12, gap: 6 },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function VectaIDScreen() {
  const { colors, isDark } = useTheme();
  const { profile, authToken } = useStudentStore();

  const [card,       setCard]       = useState<IDCardData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showBack,   setShowBack]   = useState(false);

  // Flip animation
  const flipAnim = useRef(new Animated.Value(0)).current;

  const frontInterp = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] });
  const backInterp  = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['180deg', '360deg'] });

  const flipCard = useCallback(() => {
    if (showBack) {
      Animated.spring(flipAnim, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
    } else {
      Animated.spring(flipAnim, { toValue: 180, useNativeDriver: true, friction: 8 }).start();
    }
    setShowBack(prev => !prev);
  }, [showBack, flipAnim]);

  // ---------------------------------------------------------------------------
  // Fetch existing card
  // ---------------------------------------------------------------------------

  const fetchCard = useCallback(async () => {
    if (!authToken) { setLoading(false); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_V1_BASE}/identity/id-card`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json() as IDCardData & { exists: boolean };
      if (data.exists) setCard(data);
      else setCard(null);
    } catch {
      setCard(null);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => { void fetchCard(); }, [fetchCard]);

  // ---------------------------------------------------------------------------
  // Generate card
  // ---------------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    if (!authToken) return;
    setGenerating(true);
    try {
      const res  = await fetch(`${API_V1_BASE}/identity/generate-id-card`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Generation failed');
      await fetchCard();
      Alert.alert('Vecta ID Created!', 'Your digital identity card is ready.');
    } catch {
      Alert.alert('Error', 'Could not generate your Vecta ID. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [authToken, fetchCard]);

  // ---------------------------------------------------------------------------
  // Regenerate (confirm first)
  // ---------------------------------------------------------------------------

  const handleRegenerate = useCallback(() => {
    Alert.alert(
      'Regenerate ID Card',
      'This will generate a new card and invalidate your old one. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Regenerate', style: 'destructive', onPress: handleGenerate },
      ],
    );
  }, [handleGenerate]);

  // ---------------------------------------------------------------------------
  // Download PDF
  // ---------------------------------------------------------------------------

  const handleDownload = useCallback(async () => {
    if (!card?.pdfUrl) return;
    if (!FileSystem || !Sharing) {
      Alert.alert('Build Required', 'File download requires a fresh EAS build with expo-file-system and expo-sharing.');
      return;
    }
    try {
      const dest = `${FileSystem.documentDirectory ?? ''}vecta-id-card.pdf`;
      await FileSystem.downloadAsync(card.pdfUrl, dest);
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Save Vecta ID Card' });
    } catch {
      Alert.alert('Error', 'Could not download the ID card. Please try again.');
    }
  }, [card]);

  // ---------------------------------------------------------------------------
  // Share card
  // ---------------------------------------------------------------------------

  const handleShare = useCallback(async () => {
    if (!card) return;
    const message = `My verified Vecta ID: ${card.verificationUrl}\n\nVerify my identity at verify.vecta.io`;
    try {
      await Share.share({ message, url: card.frontUrl });
    } catch { /* user dismissed */ }
  }, [card]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#00E6CC" />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your card…</Text>
      </View>
    );
  }

  const kycStatus = profile?.kycStatus ?? card?.kycStatus ?? 'PENDING';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient colors={['#001F3F', '#001A33']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Vecta ID</Text>
          <Text style={styles.headerSub}>Your verified digital identity</Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Card area */}
        {card ? (
          <>
            {/* Flip card container */}
            <TouchableOpacity onPress={flipCard} activeOpacity={0.95} style={styles.cardArea}>
              {/* Front face */}
              <Animated.View
                style={[
                  styles.cardFace,
                  { transform: [{ rotateY: frontInterp }] },
                ]}
              >
                <IDCardImage uri={card.frontUrl} side="front" />
              </Animated.View>

              {/* Back face */}
              <Animated.View
                style={[
                  styles.cardFace,
                  styles.cardBack,
                  { transform: [{ rotateY: backInterp }] },
                ]}
              >
                <IDCardImage uri={card.backUrl} side="back" />
              </Animated.View>
            </TouchableOpacity>

            <Text style={[styles.flipHint, { color: colors.textMuted ?? colors.textSecondary }]}>
              Tap card to flip
            </Text>

            {/* Card details */}
            <View style={[styles.detailsCard, { backgroundColor: colors.surface1 }]}>
              <Text style={[styles.vidNumber, { color: '#00E6CC' }]}>{card.vectaIdNumber}</Text>

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Issued</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {new Date(card.issuedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Expires</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {new Date(card.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Status</Text>
                <View style={styles.statusBadge}>
                  <View style={[styles.dot, { backgroundColor: card.status === 'ACTIVE' ? '#00C896' : '#EF4444' }]} />
                  <Text style={[styles.statusText, { color: card.status === 'ACTIVE' ? '#00C896' : '#EF4444' }]}>
                    {card.status}
                  </Text>
                </View>
              </View>
            </View>

            {/* Action buttons 2×2 grid */}
            <View style={styles.actionsGrid}>
              <View style={styles.actionsRow}>
                <ActionBtn icon="download-outline"  label="Download PDF" onPress={handleDownload} />
                <ActionBtn icon="share-social-outline" label="Share Card"   onPress={handleShare}   />
              </View>
              <View style={styles.actionsRow}>
                <ActionBtn icon="wallet-outline"    label="Add to Wallet" onPress={() => Alert.alert('Coming Soon', 'Apple Wallet and Google Wallet support coming soon.')} />
                <ActionBtn icon="refresh-outline"   label="Regenerate"    onPress={handleRegenerate} disabled={generating} />
              </View>
            </View>
          </>
        ) : (
          <EmptyCardPlaceholder
            kycStatus={kycStatus}
            generating={generating}
            onGenerate={handleGenerate}
            onScan={() => router.push('/onboarding/passport-scan')}
          />
        )}

        {/* Generating overlay */}
        {generating && (
          <View style={styles.generatingBanner}>
            <ActivityIndicator color="#00E6CC" size="small" />
            <Text style={styles.generatingText}>Generating your Vecta ID…</Text>
          </View>
        )}

        {/* Security notice */}
        <View style={[styles.securityNote, { backgroundColor: colors.surface1, borderColor: isDark ? '#1E2D45' : '#E5E7EB' }]}>
          <Ionicons name="lock-closed-outline" size={16} color="#00E6CC" style={{ marginRight: 8 }} />
          <Text style={[styles.securityText, { color: colors.textSecondary }]}>
            Your Vecta ID is cryptographically signed. Anyone can verify its authenticity at{' '}
            <Text style={{ color: '#00E6CC' }}>verify.vecta.io</Text>
            {' '}without contacting Vecta.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root:        { flex: 1 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  header:      { paddingTop: Platform.OS === 'ios' ? 54 : 40, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter:{ flex: 1, alignItems: 'center' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  headerSub:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  scroll:      { paddingVertical: 24, gap: 20, paddingBottom: 40 },

  // Card flip
  cardArea:    { height: CARD_H + 8, marginHorizontal: 20 },
  cardFace:    { position: 'absolute', width: '100%', backfaceVisibility: 'hidden' },
  cardBack:    { zIndex: 0 },

  flipHint:    { textAlign: 'center', fontSize: 12, marginTop: CARD_H + 16 },

  // Details
  detailsCard: { marginHorizontal: 20, borderRadius: 12, padding: 16, gap: 10 },
  vidNumber:   { fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700', textAlign: 'center', letterSpacing: 1 },
  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 13, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot:         { width: 8, height: 8, borderRadius: 4 },
  statusText:  { fontSize: 13, fontWeight: '700' },

  // Actions
  actionsGrid: { marginHorizontal: 20, gap: 10 },
  actionsRow:  { flexDirection: 'row', gap: 10 },

  // Generating
  generatingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#001F3F', marginHorizontal: 20, borderRadius: 10, padding: 14 },
  generatingText:   { color: '#00E6CC', fontSize: 14, fontWeight: '600' },

  // Security note
  securityNote: { marginHorizontal: 20, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1 },
  securityText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
