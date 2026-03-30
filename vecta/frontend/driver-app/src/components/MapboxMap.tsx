import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapboxGL from '@rnmapbox/maps';

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  color: string;
  icon?: 'pickup' | 'dropoff' | 'car' | 'user';
  label?: string;
}

export interface MapRoute {
  coordinates: [number, number][];
  color: string;
}

interface MapboxMapProps {
  pins: MapPin[];
  route?: MapRoute;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  style?: object;
  onMapReady?: () => void;
}

export default function MapboxMap({
  pins,
  route,
  centerLat,
  centerLng,
  zoom = 14,
  style,
  onMapReady,
}: MapboxMapProps) {
  const cameraRef = useRef<MapboxGL.Camera>(null);

  useEffect(() => {
    if (centerLat != null && centerLng != null && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [centerLng, centerLat],
        zoomLevel: zoom,
        animationDuration: 500,
      });
    }
  }, [centerLat, centerLng, zoom]);

  return (
    <View style={[styles.container, style]}>
      <MapboxGL.MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={MapboxGL.StyleURL.Street}
        onDidFinishLoadingMap={onMapReady}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          zoomLevel={zoom}
          centerCoordinate={
            centerLng != null && centerLat != null ? [centerLng, centerLat] : [-122.4194, 37.7749]
          }
          animationMode="flyTo"
          animationDuration={500}
        />

        {route && route.coordinates.length > 1 ? (
          <MapboxGL.ShapeSource
            id="routeLineSource"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: route.coordinates,
              },
            }}
          >
            <MapboxGL.LineLayer
              id="routeLineLayer"
              style={{
                lineColor: route.color,
                lineWidth: 4,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        ) : null}

        {pins.map((pin) => (
          <MapboxGL.PointAnnotation key={pin.id} id={pin.id} coordinate={[pin.lng, pin.lat]}>
            {pin.icon === 'car' ? (
              <View style={styles.carPin}>
                <Text style={styles.carEmoji}>🚗</Text>
              </View>
            ) : (
              <View style={[styles.pin, { backgroundColor: pin.color }]} />
            )}
          </MapboxGL.PointAnnotation>
        ))}

        <MapboxGL.UserLocation visible showsUserHeadingIndicator />
      </MapboxGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  carPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00E6CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carEmoji: { fontSize: 16 },
});
