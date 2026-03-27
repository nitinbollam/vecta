/**
 * app/_layout.tsx — Expo Router root layout with deep-link handler
 *
 * Auth is handled declaratively via <Redirect> in (tabs)/_layout.tsx,
 * NOT with router.replace() in useEffect — that pattern causes infinite
 * loops because navigation events re-trigger navigation-state-dependent effects.
 */

import { useEffect, useCallback, useRef } from 'react';
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
import { ThemeProvider } from '../context/ThemeContext';

SplashScreen.preventAutoHideAsync();

// ---------------------------------------------------------------------------
// Deep-link magic link handler
// Use selectors so this hook only re-renders when the specific actions change
// (Zustand actions are stable references — this effectively never re-renders)
// ---------------------------------------------------------------------------

function useMagicLinkHandler() {
  const setAuthToken = useStudentStore((s) => s.setAuthToken);
  const fetchProfile = useStudentStore((s) => s.fetchProfile);

  const handleUrl = useCallback(async (url: string) => {
    try {
      const parsed = Linking.parse(url);
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

  // Stable ref so the event listener always calls the latest handleUrl
  const handleUrlRef = useRef(handleUrl);
  useEffect(() => { handleUrlRef.current = handleUrl; }, [handleUrl]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) void handleUrlRef.current(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => void handleUrlRef.current(url));
    return () => sub.remove();
  }, []); // Empty deps — subscribe once, use ref for latest handler
}

// ---------------------------------------------------------------------------
// Root layout — NO imperative auth redirects here
// Auth guard lives in (tabs)/_layout.tsx as a declarative <Redirect>
// ---------------------------------------------------------------------------

export default function RootLayout() {
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
    <ThemeProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth/login"                  options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)"                      options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/index"            options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding/passport-scan"   options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/plaid-link"      options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/banking"         options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/esim"            options={{ headerShown: false }} />
        <Stack.Screen name="esim/index"                 options={{ headerShown: false }} />
        <Stack.Screen name="housing/roommate"           options={{ headerShown: false }} />
        <Stack.Screen name="insurance/index"            options={{ headerShown: false }} />
        <Stack.Screen name="mobility/enroll"            options={{ headerShown: false }} />
        <Stack.Screen name="mobility/audit-export"      options={{ headerShown: false }} />
        <Stack.Screen name="profile/tokens"             options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
    </ThemeProvider>
  );
}
