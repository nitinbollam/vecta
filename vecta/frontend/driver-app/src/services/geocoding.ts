const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export interface GeocodingResult {
  id: string;
  placeName: string;
  lat: number;
  lng: number;
}

export async function searchAddress(query: string): Promise<GeocodingResult[]> {
  if (!MAPBOX_TOKEN || !query || query.length < 3) return [];

  const encoded = encodeURIComponent(query);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=address,poi,place`;

  try {
    const res = await fetch(url);
    const data = (await res.json()) as {
      features?: { id: string; place_name: string; center: [number, number] }[];
    };

    return (data.features ?? []).map((f) => ({
      id: f.id,
      placeName: f.place_name,
      lat: f.center[1],
      lng: f.center[0],
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!MAPBOX_TOKEN) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  try {
    const res = await fetch(url);
    const data = (await res.json()) as { features?: { place_name?: string }[] };
    return data.features?.[0]?.place_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}
