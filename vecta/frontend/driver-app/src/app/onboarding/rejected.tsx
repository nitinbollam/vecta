import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function RejectedScreen() {
  return (
    <LinearGradient colors={['#001F3F', '#001A33']} style={styles.container}>
      <Text style={styles.icon}>❌</Text>
      <Text style={styles.title}>Application Not Approved</Text>
      <Text style={styles.body}>
        Unfortunately your driver application was not approved. This may be due to document issues or work
        authorization status.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => void Linking.openURL('mailto:support@vecta.io?subject=Driver%20Application')}
      >
        <Text style={styles.buttonText}>Contact Support</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  body: { fontSize: 16, color: '#A8B8C8', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  button: { backgroundColor: '#00E6CC', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: '#001F3F', fontWeight: '700', fontSize: 16 },
});
