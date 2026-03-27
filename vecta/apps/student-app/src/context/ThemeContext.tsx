/**
 * context/ThemeContext.tsx — Light / Dark / System theme provider
 *
 * Usage:
 *   const { isDark, colors, mode, setMode } = useTheme();
 *
 * Wrap the root layout with <ThemeProvider>.
 * Persists preference to AsyncStorage under 'theme_mode'.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { VectaColors, VectaDarkColors } from '../constants/theme';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  mode:    ThemeMode;
  isDark:  boolean;
  colors:  typeof VectaColors;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode:    'system',
  isDark:  false,
  colors:  VectaColors,
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme              = useColorScheme();
  const [mode, setModeState]      = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem('theme_mode').then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    }).catch(() => {});
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem('theme_mode', newMode).catch(() => {});
  };

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');

  // Cast so consumers get the same type regardless of which palette is active
  const colors = (isDark ? VectaDarkColors : VectaColors) as typeof VectaColors;

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
