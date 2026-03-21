/**
 * app/(tabs)/_layout.tsx — Bottom tab navigator
 * Tabs: Home · Banking · Housing · Mobility · Profile
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { VectaColors, VectaFonts } from '../../constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: Array<{
  name: string;
  title: string;
  icon: IconName;
  activeIcon: IconName;
}> = [
  { name: 'index',   title: 'Home',     icon: 'home-outline',     activeIcon: 'home' },
  { name: 'banking', title: 'Banking',  icon: 'card-outline',     activeIcon: 'card' },
  { name: 'housing', title: 'Housing',  icon: 'business-outline', activeIcon: 'business' },
  { name: 'mobility',title: 'Fleet',    icon: 'car-outline',      activeIcon: 'car-sport' },
  { name: 'profile', title: 'Profile',  icon: 'person-outline',   activeIcon: 'person' },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: VectaColors.surfaceBase,
          borderTopColor: VectaColors.border,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 6,
          height: 64,
        },
        tabBarActiveTintColor:   VectaColors.primary,
        tabBarInactiveTintColor: VectaColors.textMuted,
        tabBarLabelStyle: {
          fontFamily: VectaFonts.medium,
          fontSize:   VectaFonts.xs,
          marginTop:  -2,
        },
      }}
    >
      {TABS.map(({ name, title, icon, activeIcon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? activeIcon : icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
