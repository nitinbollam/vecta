import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useDriverStore } from '../stores/driver-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const bootstrap = useDriverStore((s) => s.bootstrap);
  const bootstrapped = useDriverStore((s) => s.bootstrapped);

  useEffect(() => {
    void (async () => {
      await bootstrap();
      await SplashScreen.hideAsync();
    })();
  }, [bootstrap]);

  if (!bootstrapped) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/pending" />
        <Stack.Screen name="onboarding/rejected" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="ride-active" />
      </Stack>
    </GestureHandlerRootView>
  );
}
