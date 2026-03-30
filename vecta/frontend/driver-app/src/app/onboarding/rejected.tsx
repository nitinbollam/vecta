import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

export default function RejectedScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Application not approved</Text>
      <Text style={styles.body}>Contact support@vecta.io if you believe this is an error.</Text>
      <TouchableOpacity style={styles.btn} onPress={() => router.replace('/auth/login')}>
        <Text style={styles.btnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F', padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 12 },
  body: { fontSize: 16, color: '#9CB4C8', lineHeight: 24 },
  btn: { marginTop: 32, padding: 16, backgroundColor: '#00E6CC', borderRadius: 12, alignItems: 'center' },
  btnText: { fontWeight: '700', color: '#001F3F' },
});
