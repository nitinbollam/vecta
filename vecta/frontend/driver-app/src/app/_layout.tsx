import { useEffect, useCallback, useRef } from 'react';
import '../tasks/driver-location-task';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Alert } from 'react-native';
import { useDriverStore } from '../stores/driver-store';
import { API_V1_BASE } from '../config/api';

SplashScreen.preventAutoHideAsync();

function useDriverMagicLinkHandler() {
  const setAuthToken = useDriverStore((s) => s.setAuthToken);
  const refreshDriver = useDriverStore((s) => s.refreshDriver);

  const handleUrl = useCallback(
    async (url: string) => {
      try {
        const parsed = Linking.parse(url);
        if (!parsed.path?.includes('auth/verify')) return;

        const token = parsed.queryParams?.token as string | undefined;
        const email = parsed.queryParams?.email as string | undefined;
        if (!token || !email) return;

        const res = await fetch(`${API_V1_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, email }),
        });

        if (!res.ok) {
          Alert.alert(
            'Link Expired',
            'This sign-in link has expired or was already used. Request a new one from the login screen.',
          );
          return;
        }

        const data = (await res.json()) as { token: string; studentId?: string };
        await setAuthToken(data.token);
        await refreshDriver();
        const driver = useDriverStore.getState().driver;
        if (!driver?.hasProfile) {
          router.replace('/onboarding');
        } else if (driver.status === 'PENDING_REVIEW') {
          router.replace('/onboarding/pending');
        } else if (driver.status === 'REJECTED') {
          router.replace('/onboarding/rejected');
        } else if (driver.status === 'APPROVED') {
          router.replace('/(tabs)');
        } else {
          router.replace('/onboarding/pending');
        }
      } catch {
        Alert.alert('Error', 'Could not verify sign-in link. Please try again.');
      }
    },
    [setAuthToken, refreshDriver],
  );

  const handleUrlRef = useRef(handleUrl);
  useEffect(() => {
    handleUrlRef.current = handleUrl;
  }, [handleUrl]);

  useEffect(() => {
    void Linking.getInitialURL().then((u) => {
      if (u) void handleUrlRef.current(u);
    });
    const sub = Linking.addEventListener('url', ({ url }) => void handleUrlRef.current(url));
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  useDriverMagicLinkHandler();
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
