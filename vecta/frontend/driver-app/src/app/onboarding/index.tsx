import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { API_V1_BASE, getAuthHeaders } from '../../config/api';
import { useDriverStore } from '../../stores/driver-store';

const WORK_TYPES = ['OPT', 'CPT', 'EAD', 'US_CITIZEN', 'PERMANENT_RESIDENT'] as const;

function pendingDocUrl(label: string): string {
  return `https://docs.vecta.io/pending/${encodeURIComponent(label)}`;
}

export default function DriverOnboarding() {
  const refreshDriver = useDriverStore((s) => s.refreshDriver);
  const [step, setStep] = useState(0);
  const [f1Block, setF1Block] = useState(false);
  const [workAuthType, setWorkAuthType] = useState<string>('OPT');
  const [workAuthExpiry, setWorkAuthExpiry] = useState('');
  const [licenseState, setLicenseState] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [licenseNumberEnc, setLicenseNumberEnc] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleCapacity, setVehicleCapacity] = useState('4');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const pickLabel = useCallback(async (label: string): Promise<string> => {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return pendingDocUrl(`${label}-missing`);
    return pendingDocUrl(`${label}-${r.assets[0].name}`);
  }, []);

  const submit = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workAuthType,
          workAuthDocUrl: pendingDocUrl('work-auth'),
          workAuthExpiry,
          licenseNumberEnc,
          licenseState,
          licenseExpiry,
          licenseDocUrl: pendingDocUrl('license'),
          insuranceDocUrl: pendingDocUrl('insurance'),
          insuranceExpiry,
          vehicleMake,
          vehicleModel,
          vehicleYear: parseInt(vehicleYear, 10),
          vehicleColor,
          vehiclePlate,
          vehicleCapacity: parseInt(vehicleCapacity, 10),
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Apply failed');
      await refreshDriver();
      router.replace('/onboarding/pending');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [
    workAuthType,
    workAuthExpiry,
    licenseNumberEnc,
    licenseState,
    licenseExpiry,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    vehiclePlate,
    vehicleCapacity,
    insuranceExpiry,
    refreshDriver,
  ]);

  if (f1Block) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>F-1 students cannot drive on Vecta Rides</Text>
        <Text style={styles.body}>
          You can earn passive income by enrolling your vehicle in the Vecta Fleet. Download the Vecta Student app to
          get started.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={{ backgroundColor: '#001F3F' }}>
      <Text style={styles.title}>Driver application</Text>
      {step === 0 && (
        <View>
          <Text style={styles.label}>Work authorization</Text>
          {WORK_TYPES.map((t) => (
            <TouchableOpacity key={t} style={styles.choice} onPress={() => setWorkAuthType(t)}>
              <Text style={{ color: workAuthType === t ? '#00E6CC' : '#fff' }}>{t}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.choice} onPress={() => setF1Block(true)}>
            <Text style={{ color: '#FCA5A5' }}>I am on F-1 without OPT/CPT/EAD</Text>
          </TouchableOpacity>
          <Text style={styles.label}>Work auth expiry (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={workAuthExpiry} onChangeText={setWorkAuthExpiry} placeholder="2030-01-01" placeholderTextColor="#7A9BAD" />
          <TouchableOpacity style={styles.nav} onPress={() => void pickLabel('work-auth')}>
            <Text style={styles.navText}>Attach work auth doc (metadata only for now)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => setStep(1)}>
            <Text style={styles.btnText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
      {step === 1 && (
        <View>
          <Text style={styles.label}>Driver license # (stored encrypted server-side)</Text>
          <TextInput style={styles.input} value={licenseNumberEnc} onChangeText={setLicenseNumberEnc} placeholder="License number" placeholderTextColor="#7A9BAD" />
          <Text style={styles.label}>State</Text>
          <TextInput style={styles.input} value={licenseState} onChangeText={setLicenseState} placeholder="CA" placeholderTextColor="#7A9BAD" />
          <Text style={styles.label}>License expiry</Text>
          <TextInput style={styles.input} value={licenseExpiry} onChangeText={setLicenseExpiry} placeholder="2028-01-01" placeholderTextColor="#7A9BAD" />
          <TouchableOpacity style={styles.nav} onPress={() => void pickLabel('license')}>
            <Text style={styles.navText}>Attach license image</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => setStep(2)}>
            <Text style={styles.btnText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
      {step === 2 && (
        <View>
          <Text style={styles.label}>Vehicle</Text>
          <TextInput style={styles.input} value={vehicleMake} onChangeText={setVehicleMake} placeholder="Make" placeholderTextColor="#7A9BAD" />
          <TextInput style={styles.input} value={vehicleModel} onChangeText={setVehicleModel} placeholder="Model" placeholderTextColor="#7A9BAD" />
          <TextInput style={styles.input} value={vehicleYear} onChangeText={setVehicleYear} placeholder="Year" placeholderTextColor="#7A9BAD" keyboardType="number-pad" />
          <TextInput style={styles.input} value={vehicleColor} onChangeText={setVehicleColor} placeholder="Color" placeholderTextColor="#7A9BAD" />
          <TextInput style={styles.input} value={vehiclePlate} onChangeText={setVehiclePlate} placeholder="Plate" placeholderTextColor="#7A9BAD" />
          <TextInput style={styles.input} value={vehicleCapacity} onChangeText={setVehicleCapacity} placeholder="Capacity 2-7" placeholderTextColor="#7A9BAD" keyboardType="number-pad" />
          <Text style={styles.label}>Insurance expiry</Text>
          <TextInput style={styles.input} value={insuranceExpiry} onChangeText={setInsuranceExpiry} placeholder="2026-01-01" placeholderTextColor="#7A9BAD" />
          <TouchableOpacity style={styles.nav} onPress={() => void pickLabel('insurance')}>
            <Text style={styles.navText}>Attach insurance</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => setStep(3)}>
            <Text style={styles.btnText}>Review</Text>
          </TouchableOpacity>
        </View>
      )}
      {step === 3 && (
        <View>
          <Text style={styles.body}>By submitting, you confirm the information is accurate.</Text>
          {err ? <Text style={{ color: '#FCA5A5', marginVertical: 8 }}>{err}</Text> : null}
          <TouchableOpacity style={styles.btn} onPress={() => void submit()} disabled={loading}>
            {loading ? <ActivityIndicator color="#001F3F" /> : <Text style={styles.btnText}>Submit application</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F', padding: 24, justifyContent: 'center' },
  scroll: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 20 },
  label: { color: '#9CB4C8', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    marginBottom: 8,
  },
  choice: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#334155' },
  nav: { marginVertical: 8 },
  navText: { color: '#00E6CC' },
  body: { color: '#9CB4C8', fontSize: 15, lineHeight: 22 },
  btn: {
    marginTop: 20,
    backgroundColor: '#00E6CC',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { fontWeight: '800', color: '#001F3F', fontSize: 16 },
});
