/**
 * Mirrors backend ride-matching PRICE_MATRIX for client-side fare previews.
 */

const BASE_PER_MILE_CENTS = 75;
const MAX_PER_MILE_CENTS = 150;
const PEAK_MULTIPLIER = 1.4;
const NIGHT_MULTIPLIER = 1.2;
const PLATFORM_CUT = 0.1;

export function estimateFareCents(estimatedMiles: number): {
  pricePerMileCents: number;
  estimatedFareCents: number;
  platformFeeCents: number;
  driverPayoutCents: number;
} {
  const hour = new Date().getHours();
  const isPeak = (hour >= 8 && hour <= 9) || (hour >= 17 && hour <= 18);
  const isNight = hour >= 22 || hour <= 5;

  let perMile = BASE_PER_MILE_CENTS;
  if (isPeak) perMile = Math.round(perMile * PEAK_MULTIPLIER);
  if (isNight) perMile = Math.round(perMile * NIGHT_MULTIPLIER);
  perMile = Math.min(perMile, MAX_PER_MILE_CENTS);

  const estimatedFareCents = Math.round(estimatedMiles * perMile);
  const platformFeeCents = Math.round(estimatedFareCents * PLATFORM_CUT);
  const driverPayoutCents = estimatedFareCents - platformFeeCents;

  return { pricePerMileCents: perMile, estimatedFareCents, platformFeeCents, driverPayoutCents };
}

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
