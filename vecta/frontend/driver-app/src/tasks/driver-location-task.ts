import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DRIVER_LOCATION_TASK = 'DRIVER_LOCATION_TASK';

function apiBase(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? 'https://vecta-elaf.onrender.com/api/v1').replace(/\/$/, '');
}

if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    const loc = locations?.[0];
    if (!loc) return;
    const token = await AsyncStorage.getItem('driver_auth_token');
    if (!token) return;
    try {
      await fetch(`${apiBase()}/mobility/driver/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading: loc.coords.heading,
        }),
      });
    } catch {
      /* ignore */
    }
  });
}

export async function startDriverBackgroundLocation(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) return;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return;
  await Location.requestBackgroundPermissionsAsync();
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,
    distanceInterval: 10,
    foregroundService: {
      notificationTitle: 'Vecta Driver',
      notificationBody: 'Tracking your location for active ride',
      notificationColor: '#00E6CC',
    },
  });
}

export async function stopDriverBackgroundLocation(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
}
