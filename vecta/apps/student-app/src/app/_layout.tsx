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
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
} from '@expo-google-fonts/dm-sans';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { useStudentStore } from '../stores';
import { API_V1_BASE } from '../config/api';

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

      const res = await fetch(`${API_V1_BASE}/auth/verify`, {
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

  useEffect(() => {
    // authToken starts as null (not undefined) after Zustand rehydration
    if (authToken === undefined) return;

    if (!authToken) {
      router.replace('/auth/login');
    }
  }, [authToken, profile]);
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout() {
  useAuthGuard();
  useMagicLinkHandler();

  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
    JetBrainsMono_400Regular,
  });

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
