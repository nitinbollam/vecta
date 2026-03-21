/**
 * app/_layout.tsx — Expo Router root layout with auth guard + deep-link handler
 */

import { useEffect, useCallback } from 'react';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { useStudentStore } from '../stores';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

SplashScreen.preventAutoHideAsync();

// ---------------------------------------------------------------------------
// Deep-link magic link handler
// ---------------------------------------------------------------------------

function useMagicLinkHandler() {
  const { setAuthToken, fetchProfile } = useStudentStore();

  const handleUrl = useCallback(async (url: string) => {
    try {
      const parsed = Linking.parse(url);
      // vecta://auth/verify?token=xxx&email=yyy
      // or https://app.vecta.io/auth/verify?token=xxx&email=yyy
      if (!parsed.path?.includes('auth/verify')) return;

      const token = parsed.queryParams?.token as string | undefined;
      const email = parsed.queryParams?.email as string | undefined;

      if (!token || !email) return;

      const res = await fetch(`${API_BASE}/auth/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, email }),
      });

      if (!res.ok) {
        router.replace('/auth/login');
        return;
      }

      const { token: authToken } = await res.json() as { token: string };
      setAuthToken(authToken);
      await fetchProfile();
      router.replace('/(tabs)');
    } catch {
      router.replace('/auth/login');
    }
  }, [setAuthToken, fetchProfile]);

  useEffect(() => {
    // Handle cold-start deep link
    Linking.getInitialURL().then((url) => {
      if (url) void handleUrl(url);
    });

    // Handle warm-start deep link
    const sub = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
    return () => sub.remove();
  }, [handleUrl]);
}

// ---------------------------------------------------------------------------
// Auth guard — redirects unauthenticated users to login
// ---------------------------------------------------------------------------

function useAuthGuard() {
  const { authToken, profile } = useStudentStore();
  const [hydrated, setHydrated] = useStudentStore((s) => [s.authToken !== undefined, () => {}]);

  useEffect(() => {
    // Skip until Zustand rehydration is done (AsyncStorage read)
    // The store's `authToken` starts as null (not undefined) after hydration
    if (authToken === undefined) return;

    if (!authToken) {
      // No session → login screen
      router.replace('/auth/login');
    } else if (profile && profile.kycStatus !== 'APPROVED') {
      // Authenticated but not verified → onboarding
      // Don't redirect if already on onboarding
    }
  }, [authToken, profile]);
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout() {
  const { authToken } = useStudentStore();

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_400Regular,
  });

  // Handle magic-link deep links
  useMagicLinkHandler();

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Auth */}
        <Stack.Screen name="auth/login"   options={{ headerShown: false, gestureEnabled: false }} />
        {/* Main app */}
        <Stack.Screen name="(tabs)"       options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"   options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="mobility"     options={{ headerShown: false }} />
        <Stack.Screen name="insurance"    options={{ headerShown: false }} />
        <Stack.Screen name="housing"      options={{ headerShown: false }} />
        <Stack.Screen name="profile"      options={{ headerShown: false }} />
        <Stack.Screen name="verify"       options={{ presentation: 'modal' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
