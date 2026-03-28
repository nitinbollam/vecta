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
import { VectaFonts } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: Array<{
  name: string;
  title: string;
  icon: IconName;
  activeIcon: IconName;
}> = [
  { name: 'index',     title: 'Home',      icon: 'home-outline',              activeIcon: 'home'                },
  { name: 'banking',   title: 'Banking',   icon: 'card-outline',              activeIcon: 'card'                },
  { name: 'housing',   title: 'Housing',   icon: 'business-outline',          activeIcon: 'business'            },
  { name: 'insurance', title: 'Insurance', icon: 'shield-checkmark-outline',  activeIcon: 'shield-checkmark'    },
  { name: 'mobility',  title: 'Fleet',     icon: 'car-outline',               activeIcon: 'car-sport'           },
  { name: 'profile',   title: 'Profile',   icon: 'person-outline',            activeIcon: 'person'              },
];

export default function TabLayout() {
  const authToken      = useStudentStore((s) => s.authToken);
  const { isDark }     = useTheme();

  if (!authToken) {
    return <Redirect href="/auth/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#0F1628' : '#FFFFFF',
          borderTopColor:  isDark ? '#1E2D45' : '#E5E7EB',
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 6,
          height: 64,
        },
        tabBarActiveTintColor:   '#00E6CC',
        tabBarInactiveTintColor: isDark ? '#5A7080' : '#9CA3AF',
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
