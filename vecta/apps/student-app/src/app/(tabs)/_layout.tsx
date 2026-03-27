/**
 * app/(tabs)/_layout.tsx — Bottom tab navigator with declarative auth guard
 *
 * Auth is handled here with <Redirect> (declarative) rather than
 * router.replace() in useEffect (imperative). The declarative approach
 * is the Expo Router recommended pattern and avoids navigation-state loops.
 */

import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStudentStore } from '../../stores';
import { VectaColors, VectaFonts } from '../../constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: Array<{
  name: string;
  title: string;
  icon: IconName;
  activeIcon: IconName;
}> = [
  { name: 'index',   title: 'Home',    icon: 'home-outline',     activeIcon: 'home'      },
  { name: 'banking', title: 'Banking', icon: 'card-outline',     activeIcon: 'card'      },
  { name: 'housing', title: 'Housing', icon: 'business-outline', activeIcon: 'business'  },
  { name: 'mobility',title: 'Fleet',   icon: 'car-outline',      activeIcon: 'car-sport' },
  { name: 'profile', title: 'Profile', icon: 'person-outline',   activeIcon: 'person'    },
];

export default function TabLayout() {
  // Selector keeps this component isolated — only re-renders when authToken changes
  const authToken = useStudentStore((s) => s.authToken);

  // Declarative auth guard — Expo Router handles this correctly without loops
  if (!authToken) {
    return <Redirect href="/auth/login" />;
  }

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
