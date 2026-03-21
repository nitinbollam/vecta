/**
 * apps/student-app/src/app/profile/tokens.tsx
 *
 * "My Sharing Links" screen — lets students see who has access to their
 * Vecta ID and revoke links that are no longer needed.
 *
 * Each token shows:
 *   - Masked JTI (first 8 chars + "…")
 *   - Created at
 *   - Expires at
 *   - Status: ACTIVE / USED / EXPIRED
 *
 * Students can revoke any ACTIVE (unused) token.
 * Once a token is USED, it cannot be "un-used" — but the student can
 * see that a landlord opened it (privacy audit trail).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStudentStore } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius, VectaGradients,
} from '../../constants/theme';
import { VectaBadge } from '../../components/ui';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenRecord {
  jti:       string;   // Masked: "abc123de…"
  createdAt: string;
  expiresAt: string;
  used:      boolean;
  usedAt?:   string;
}

// ---------------------------------------------------------------------------
// Token status badge
// ---------------------------------------------------------------------------

function TokenStatusBadge({ token }: { token: TokenRecord }) {
  const isExpired = new Date(token.expiresAt) < new Date();

  if (isExpired && !token.used) {
    return <VectaBadge label="Expired" variant="warning" />;
  }
  if (token.used) {
    return <VectaBadge label="Opened" variant="info" />;
  }
  return <VectaBadge label="Active" variant="success" />;
}

// ---------------------------------------------------------------------------
// Token card
// ---------------------------------------------------------------------------

function TokenCard({
  token,
  onRevoke,
}: {
  token: TokenRecord;
  onRevoke: (jti: string) => void;
}) {
  const isExpired = new Date(token.expiresAt) < new Date();
  const canRevoke = !token.used && !isExpired;

  return (
    <View style={cardStyle.container}>
      <View style={cardStyle.header}>
        <View style={cardStyle.jtiWrap}>
          <Ionicons name="link" size={14} color={VectaColors.textMuted} />
          <Text style={cardStyle.jti}>{token.jti}</Text>
        </View>
        <TokenStatusBadge token={token} />
      </View>

      <View style={cardStyle.meta}>
        <View style={cardStyle.metaRow}>
          <Text style={cardStyle.metaLabel}>Created</Text>
          <Text style={cardStyle.metaValue}>
            {new Date(token.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
          </Text>
        </View>
        <View style={cardStyle.metaRow}>
          <Text style={cardStyle.metaLabel}>Expires</Text>
          <Text style={[cardStyle.metaValue, isExpired && { color: VectaColors.error }]}>
            {new Date(token.expiresAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
          </Text>
        </View>
        {token.used && token.usedAt && (
          <View style={cardStyle.metaRow}>
            <Text style={cardStyle.metaLabel}>Opened by landlord</Text>
            <Text style={[cardStyle.metaValue, { color: VectaColors.info }]}>
              {new Date(token.usedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
            </Text>
          </View>
        )}
      </View>

      {canRevoke && (
        <TouchableOpacity
          onPress={() => onRevoke(token.jti)}
          style={cardStyle.revokeBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="close-circle-outline" size={14} color={VectaColors.error} />
          <Text style={cardStyle.revokeBtnText}>Revoke Access</Text>
        </TouchableOpacity>
      )}

      {token.used && (
        <View style={cardStyle.usedNotice}>
          <Ionicons name="eye" size={14} color={VectaColors.info} />
          <Text style={cardStyle.usedNoticeText}>
            A landlord viewed your identity using this link. It cannot be reused.
          </Text>
        </View>
      )}
    </View>
  );
}

const cardStyle = StyleSheet.create({
  container:    { backgroundColor: VectaColors.surfaceBase, borderRadius: VectaRadius.xl, padding: VectaSpacing['4'], marginBottom: VectaSpacing['3'], borderWidth: 1, borderColor: VectaColors.border },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: VectaSpacing['3'] },
  jtiWrap:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jti:          { fontFamily: VectaFonts.mono, fontSize: VectaFonts.sm, color: VectaColors.text },
  meta:         { gap: VectaSpacing['2'], marginBottom: VectaSpacing['3'] },
  metaRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  metaLabel:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted },
  metaValue:    { fontFamily: VectaFonts.medium, fontSize: VectaFonts.xs, color: VectaColors.text },
  revokeBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: VectaSpacing['2'], justifyContent: 'center', backgroundColor: VectaColors.errorBg, borderRadius: VectaRadius.md },
  revokeBtnText:{ fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.xs, color: VectaColors.error },
  usedNotice:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: VectaSpacing['2'], borderTopWidth: 1, borderTopColor: VectaColors.border },
  usedNoticeText:{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.info, flex: 1 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TokenManagementScreen() {
  const { authToken } = useStudentStore();
  const [tokens,     setTokens]     = useState<TokenRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTokens = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/identity/tokens`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json() as { tokens: TokenRecord[] };
      setTokens(data.tokens ?? []);
    } catch { /* silent */ }
  }, [authToken]);

  useEffect(() => {
    setLoading(true);
    fetchTokens().finally(() => setLoading(false));
  }, [fetchTokens]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTokens();
    setRefreshing(false);
  };

  const handleRevoke = useCallback((jti: string) => {
    Alert.alert(
      'Revoke Access',
      'This will invalidate the sharing link. Any landlord who received it will no longer be able to view your profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            if (!authToken) return;
            try {
              await fetch(`${API_BASE}/identity/tokens/${encodeURIComponent(jti)}/revoke`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${authToken}` },
              });
              setTokens((prev) => prev.filter((t) => t.jti !== jti));
            } catch {
              Alert.alert('Error', 'Could not revoke token. Please try again.');
            }
          },
        },
      ],
    );
  }, [authToken]);

  const activeCount = tokens.filter((t) => !t.used && new Date(t.expiresAt) > new Date()).length;
  const usedCount   = tokens.filter((t) => t.used).length;

  return (
    <View style={{ flex: 1, backgroundColor: VectaColors.surface1 }}>
      {/* Header */}
      <LinearGradient colors={VectaGradients.hero} style={screen.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: VectaRadius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: VectaSpacing['3'] }}
        >
          <Ionicons name="chevron-back" size={20} color="#FFF" />
        </TouchableOpacity>
        <Text style={screen.title}>Sharing Links</Text>
        <Text style={screen.subtitle}>Control who can view your Vecta ID</Text>
      </LinearGradient>

      {/* Stats */}
      <View style={screen.stats}>
        <View style={screen.statItem}>
          <Text style={screen.statNum}>{activeCount}</Text>
          <Text style={screen.statLabel}>Active</Text>
        </View>
        <View style={[screen.statItem, screen.statDivider]}>
          <Text style={screen.statNum}>{usedCount}</Text>
          <Text style={screen.statLabel}>Opened</Text>
        </View>
        <View style={screen.statItem}>
          <Text style={screen.statNum}>{tokens.length}</Text>
          <Text style={screen.statLabel}>Total</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: VectaSpacing['4'], paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VectaColors.primary} />}
      >
        {/* Privacy note */}
        <View style={screen.privacyNote}>
          <Ionicons name="shield-checkmark" size={16} color={VectaColors.primary} />
          <Text style={screen.privacyText}>
            Each link can only be opened <Text style={{ fontFamily: VectaFonts.bold }}>once</Text>.
            After a landlord opens it, the link is consumed and cannot be forwarded.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={VectaColors.primary} style={{ marginTop: VectaSpacing['8'] }} />
        ) : tokens.length === 0 ? (
          <View style={screen.empty}>
            <Ionicons name="link-outline" size={48} color={VectaColors.textMuted} />
            <Text style={screen.emptyText}>No sharing links yet</Text>
            <Text style={screen.emptySubText}>
              Go to Profile → Share Vecta ID to generate a link for a landlord.
            </Text>
          </View>
        ) : (
          tokens.map((token) => (
            <TokenCard key={token.jti} token={token} onRevoke={handleRevoke} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const screen = StyleSheet.create({
  header:      { paddingTop: 60, paddingBottom: VectaSpacing['5'], paddingHorizontal: VectaSpacing['5'] },
  title:       { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: '#FFF' },
  subtitle:    { fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  stats:       { flexDirection: 'row', backgroundColor: VectaColors.surfaceBase, borderBottomWidth: 1, borderBottomColor: VectaColors.border },
  statItem:    { flex: 1, alignItems: 'center', paddingVertical: VectaSpacing['4'] },
  statDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: VectaColors.border },
  statNum:     { fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['2xl'], color: VectaColors.text },
  statLabel:   { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#EEF2FF', borderRadius: VectaRadius.lg, padding: VectaSpacing['3'], marginBottom: VectaSpacing['4'] },
  privacyText: { fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.primary, flex: 1, lineHeight: 18 },
  empty:       { alignItems: 'center', paddingVertical: VectaSpacing['10'], gap: VectaSpacing['3'] },
  emptyText:   { fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.textMuted },
  emptySubText:{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, textAlign: 'center', maxWidth: 260 },
});
