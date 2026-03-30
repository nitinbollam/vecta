import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function PendingScreen() {
  return (
    <LinearGradient colors={['#001F3F', '#001A33']} style={styles.container}>
      <Text style={styles.icon}>⏳</Text>
      <Text style={styles.title}>Application Under Review</Text>
      <Text style={styles.body}>
        Your driver application is being reviewed. We typically complete reviews within 24-48 hours. You will receive
        an email when approved.
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  body: { fontSize: 16, color: '#A8B8C8', textAlign: 'center', lineHeight: 24 },
});
