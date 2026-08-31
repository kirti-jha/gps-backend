/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1000) / 1000;
}

/**
 * Check if a point (lat, lng) is inside a Circle geofence
 */
export function isPointInCircle(
  lat: number,
  lng: number,
  center: { lat: number; lng: number },
  radiusMeters: number
): boolean {
  const distKm = calculateDistanceKm(lat, lng, center.lat, center.lng);
  return distKm * 1000 <= radiusMeters;
}

/**
 * Check if a point (lat, lng) is inside a Polygon geofence using Ray-Casting algorithm
 */
export function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;

    const intersect =
      yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Validates incoming GPS location accuracy and jump speed
 */
export function validateGPSPoint(
  lat: number,
  lng: number,
  accuracy: number,
  timestampMs: number,
  lastPoint?: { lat: number; lng: number; timestampMs: number }
): { valid: boolean; reason?: string } {
  // Reject low accuracy (> 100m)
  if (accuracy > 100) {
    return { valid: false, reason: `Low GPS accuracy (${accuracy}m)` };
  }

  // Check impossible speed jump if last point exists
  if (lastPoint) {
    const timeDeltaSec = (timestampMs - lastPoint.timestampMs) / 1000;
    if (timeDeltaSec > 0 && timeDeltaSec < 10) {
      const distKm = calculateDistanceKm(lat, lng, lastPoint.lat, lastPoint.lng);
      const speedKmH = (distKm / timeDeltaSec) * 3600;
      // If speed jump > 250 km/h in 10 seconds, it's likely a bad GPS reading
      if (speedKmH > 250) {
        return { valid: false, reason: `Impossible jump speed (${Math.round(speedKmH)} km/h)` };
      }
    }
  }

  return { valid: true };
}
