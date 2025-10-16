export const EARTH_RADIUS_M = 6371000;

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const geodesicDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

export const isWithinRadius = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radiusM: number,
): boolean => geodesicDistance(lat1, lon1, lat2, lon2) <= radiusM;
