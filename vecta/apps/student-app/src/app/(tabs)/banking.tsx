/**
 * (tabs)/banking.tsx — Vecta Banking Screen with live Unit.co transactions
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStudentStore, useBalanceStore, type MaskedBalance } from '../../stores';
import {
  VectaColors, VectaFonts, VectaSpacing, VectaRadius,
  VectaGradients, VectaShadows,
} from '../../constants/theme';
import { VectaIDStatusBadge, VectaBadge, SkeletonLoader } from '../../components/ui';
import { API_V1_BASE } from '../../config/api';

type TxCategory = 'RENT_INCOME' | 'ESIM_TOPUP' | 'BANK_TRANSFER' | 'CARD_PAYMENT' | 'FEE' | 'OTHER';
interface TransactionLine {
  id: string; date: string; description: string;
  amountCents: number; category: TxCategory;
  direction: 'CREDIT' | 'DEBIT'; status: 'PENDING' | 'CLEARED' | 'RETURNED';
}

const CAT: Record<TxCategory, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  RENT_INCOME:   { icon: 'car-sport',          color: VectaColors.mobility      },
  ESIM_TOPUP:    { icon: 'cellular',           color: VectaColors.connectivity  },
  BANK_TRANSFER: { icon: 'swap-horizontal',    color: VectaColors.primary       },
  CARD_PAYMENT:  { icon: 'card',               color: VectaColors.banking       },
  FEE:           { icon: 'remove-circle',      color: VectaColors.error         },
  OTHER:         { icon: 'ellipsis-horizontal',color: VectaColors.textMuted     },
};

function DebitCard({ cardholderName, last4, kycStatus }: {
  cardholderName: string; last4?: string; kycStatus: string;
}) {
  const isPending = kycStatus !== 'APPROVED';
  return (
    <LinearGradient colors={VectaGradients.banking} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: VectaRadius['2xl'], padding: VectaSpacing['5'], marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['6'], ...VectaShadows.lg, aspectRatio: 1.586, justifyContent: 'space-between' as const }}>
      <View style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const }}>
        <View>
          <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.xl, color: '#FFF', letterSpacing: 2 }}>VECTA</Text>
          <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: 'rgba(255,255,255,0.6)' }}>Powered by Unit.co</Text>
        </View>
        <View style={{ width: 40, height: 30, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const }}>
          <Ionicons name="card" size={22} color="rgba(255,255,255,0.7)" />
        </View>
      </View>
      <Text style={{ fontFamily: VectaFonts.mono, fontSize: VectaFonts.lg, color: '#FFF', letterSpacing: 3, textAlign: 'center' as const }}>
        {isPending ? '•••• •••• •••• ????' : `•••• •••• •••• ${last4 ?? '????'}`}
      </Text>
      <View style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-end' as const }}>
        <View>
          <Text style={{ fontFamily: VectaFonts.regular, fontSize: 8, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>CARD HOLDER</Text>
          <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.sm, color: '#FFF' }}>
            {isPending ? 'Verification Pending' : cardholderName.toUpperCase()}
          </Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts.md, color: '#FFF', fontStyle: 'italic' as const }}>VISA</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

function TransactionRow({ tx }: { tx: TransactionLine }) {
  const cfg   = CAT[tx.category];
  const isCr  = tx.direction === 'CREDIT';
  const amt   = (Math.abs(tx.amountCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: VectaSpacing['3'], paddingVertical: VectaSpacing['3'], borderBottomWidth: 1, borderBottomColor: VectaColors.border }}>
      <View style={{ width: 40, height: 40, borderRadius: VectaRadius.full, backgroundColor: cfg.color + '18', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={cfg.icon} size={18} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.text }} numberOfLines={1}>{tx.description}</Text>
        <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: VectaColors.textMuted, marginTop: 2 }}>
          {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {tx.status === 'PENDING' && '  ·  Pending'}
        </Text>
      </View>
      <Text style={{ fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: isCr ? VectaColors.success : VectaColors.text }}>
        {isCr ? '+' : '-'}{amt}
      </Text>
    </View>
  );
}

export default function BankingScreen() {
  const { profile }                              = useStudentStore();
  const { balance, isLoading: balLoading, fetchBalance } = useBalanceStore();
  const [transactions, setTransactions]          = useState<TransactionLine[]>([]);
  const [txLoading,    setTxLoading]             = useState(false);
  const [refreshing,   setRefreshing]            = useState(false);
  const authToken = useStudentStore.getState().authToken;

  const fetchTransactions = useCallback(async () => {
    if (!authToken || profile?.kycStatus !== 'APPROVED') return;
    setTxLoading(true);
    try {
      const res  = await fetch(`${API_V1_BASE}/identity/transactions?limit=20`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = await res.json() as { transactions: TransactionLine[] };
      setTransactions(data.transactions ?? []);
    } catch { /* silent */ } finally { setTxLoading(false); }
  }, [authToken, profile?.kycStatus]);

  useEffect(() => { fetchBalance(); fetchTransactions(); }, [fetchBalance, fetchTransactions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchBalance(), fetchTransactions()]);
    setRefreshing(false);
  };

  const isPending = profile?.kycStatus !== 'APPROVED';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: VectaColors.surface1 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VectaColors.primary} />}>

      <LinearGradient colors={VectaGradients.banking} style={{ paddingTop: 60, paddingBottom: VectaSpacing['6'], paddingHorizontal: VectaSpacing['6'], gap: 4 }}>
        <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['3xl'], color: '#FFF' }}>US Banking</Text>
        <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: 'rgba(255,255,255,0.7)' }}>Powered by Unit.co</Text>
        {profile && <VectaIDStatusBadge status={profile.vectaIdStatus} size="sm" showLabel={false} />}
      </LinearGradient>

      {/* Balance */}
      <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['5'], gap: 6 }}>
        {balLoading ? (
          <>
            <SkeletonLoader width="40%" height={40} style={{ marginBottom: 8 }} />
            <SkeletonLoader width="60%" height={14} />
          </>
        ) : (
          <>
            <Text style={{ fontFamily: VectaFonts.extraBold, fontSize: VectaFonts['4xl'], color: VectaColors.text }}>{balance?.rangeLabel ?? '—'}</Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.sm, color: VectaColors.textSecondary }}>Verified balance range</Text>
            {balance && <VectaBadge label={balance.tier} variant="success" />}
          </>
        )}
      </View>

      <DebitCard cardholderName={profile?.fullName ?? 'Your Name'} last4={balance?.unitAccountLast4} kycStatus={profile?.kycStatus ?? 'PENDING'} />

      {isPending && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: VectaSpacing['3'], marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['4'], backgroundColor: VectaColors.warningBg, borderRadius: VectaRadius.lg, padding: VectaSpacing['4'], borderWidth: 1, borderColor: '#FDE68A' }}>
          <Ionicons name="time" size={18} color={VectaColors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: '#92400E' }}>KYC Verification In Progress</Text>
            <Text style={{ fontFamily: VectaFonts.regular, fontSize: VectaFonts.xs, color: '#B45309', marginTop: 2 }}>Unit.co is reviewing your passport. Usually takes 2–5 minutes.</Text>
          </View>
        </View>
      )}

      {/* Quick actions */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['6'] }}>
        {[
          { icon: 'arrow-down-circle' as const, label: 'Add Money', color: VectaColors.success },
          { icon: 'arrow-up-circle'   as const, label: 'Send',      color: VectaColors.banking },
          { icon: 'swap-horizontal'   as const, label: 'Exchange',  color: VectaColors.mobility },
          { icon: 'qr-code'           as const, label: 'My QR',     color: VectaColors.primary },
        ].map(({ icon, label, color }) => (
          <TouchableOpacity key={label} style={{ alignItems: 'center', gap: 6 }} activeOpacity={0.8}>
            <View style={{ width: 52, height: 52, borderRadius: VectaRadius.xl, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={icon} size={24} color={color} />
            </View>
            <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.xs, color: VectaColors.textSecondary }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Transactions */}
      <View style={{ marginHorizontal: VectaSpacing['4'], marginBottom: VectaSpacing['4'] }}>
        <Text style={{ fontFamily: VectaFonts.bold, fontSize: VectaFonts.md, color: VectaColors.text, marginBottom: VectaSpacing['3'] }}>Recent Transactions</Text>
        {txLoading ? (
          <View style={{ gap: 8, paddingVertical: 4 }}>
            {[1,2,3].map(i => <SkeletonLoader key={i} height={56} style={{ borderRadius: VectaRadius.md }} />)}
          </View>
        ) : isPending ? (
          <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['8'], gap: VectaSpacing['2'] }}>
            <Ionicons name="lock-closed" size={32} color={VectaColors.textMuted} />
            <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textMuted }}>Available after KYC approval</Text>
          </View>
        ) : transactions.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: VectaSpacing['8'], gap: VectaSpacing['2'] }}>
            <Ionicons name="receipt-outline" size={32} color={VectaColors.textMuted} />
            <Text style={{ fontFamily: VectaFonts.medium, fontSize: VectaFonts.sm, color: VectaColors.textMuted }}>No transactions yet</Text>
          </View>
        ) : (
          <>
            {transactions.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: VectaSpacing['4'] }}>
              <Text style={{ fontFamily: VectaFonts.semiBold, fontSize: VectaFonts.sm, color: VectaColors.primary }}>View All Transactions</Text>
              <Ionicons name="chevron-forward" size={14} color={VectaColors.primary} />
            </TouchableOpacity>
          </>
        )}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
