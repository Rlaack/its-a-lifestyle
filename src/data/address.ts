import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

// Turning a typed address into the official one, and opening it for directions.
// Uses the phone's own geocoder (Apple's on iPhone, Google's on Android): the address is sent to
// that service to look it up, nothing else. No location permission is needed for this.

export type CheckedAddress = { formatted: string; lat: number; lon: number };

export async function checkAddress(text: string): Promise<CheckedAddress | null> {
  const q = text.trim();
  if (q.length < 4) return null;
  try {
    const [hit] = await Location.geocodeAsync(q);
    if (!hit) return null;
    const [a] = await Location.reverseGeocodeAsync({ latitude: hit.latitude, longitude: hit.longitude });
    const street = [a?.streetNumber, a?.street].filter(Boolean).join(' ');
    const line2 = [a?.city, [a?.region, a?.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const formatted = a?.formattedAddress || [street || a?.name, line2].filter(Boolean).join(', ');
    return formatted ? { formatted, lat: hit.latitude, lon: hit.longitude } : null;
  } catch {
    return null;
  }
}

/** Opens the address in the phone's maps app, ready for directions. */
export function openInMaps(address: string) {
  const q = encodeURIComponent(address);
  const url = Platform.OS === 'ios' ? `https://maps.apple.com/?daddr=${q}` : `geo:0,0?q=${q}`;
  return Linking.openURL(url);
}
