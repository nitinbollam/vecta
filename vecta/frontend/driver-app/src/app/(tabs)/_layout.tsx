import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useDriverStore } from '../../stores/driver-store';

export default function TabsLayout() {
  const authToken = useDriverStore((s) => s.authToken);
  const driver = useDriverStore((s) => s.driver);
  const refreshDriver = useDriverStore((s) => s.refreshDriver);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    void (async () => {
      await refreshDriver();
      setLoading(false);
    })();
  }, [authToken, refreshDriver]);

  if (!authToken) {
    return <Redirect href="/auth/login" />;
  }

  if (loading || !driver) {
    return (
      <View style={{ flex: 1, backgroundColor: '#001F3F', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#00E6CC" size="large" />
      </View>
    );
  }

  if (!driver.hasProfile) {
    return <Redirect href="/onboarding" />;
  }

  if (driver.status === 'PENDING_REVIEW') {
    return <Redirect href="/onboarding/pending" />;
  }

  if (driver.status === 'REJECTED') {
    return <Redirect href="/onboarding/rejected" />;
  }

  if (driver.status !== 'APPROVED') {
    return <Redirect href="/onboarding/pending" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0F1628', borderTopColor: '#1E2D45' },
        tabBarActiveTintColor: '#00E6CC',
        tabBarInactiveTintColor: '#5A7080',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
