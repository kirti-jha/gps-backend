"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDistanceKm = calculateDistanceKm;
exports.isPointInCircle = isPointInCircle;
exports.isPointInPolygon = isPointInPolygon;
exports.validateGPSPoint = validateGPSPoint;
exports.formatDistance = formatDistance;
exports.calculateBearing = calculateBearing;
exports.bearingToDirection = bearingToDirection;
/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
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
function isPointInCircle(lat, lng, center, radiusMeters) {
    const distKm = calculateDistanceKm(lat, lng, center.lat, center.lng);
    return distKm * 1000 <= radiusMeters;
}
/**
 * Check if a point (lat, lng) is inside a Polygon geofence using Ray-Casting algorithm
 */
function isPointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
        if (intersect)
            inside = !inside;
    }
    return inside;
}
/**
 * Validates incoming GPS location accuracy and jump speed
 */
function validateGPSPoint(lat, lng, accuracy, timestampMs, lastPoint) {
    // Reject very low accuracy (> 50m) — client should filter to ≤40m, this is a safety net
    if (accuracy > 50) {
        return { valid: false, reason: `Low GPS accuracy (${accuracy}m). Need ≤50m.` };
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
/**
 * Format distance in human-readable string (meters if < 1km, km otherwise)
 */
function formatDistance(km) {
    if (km < 1)
        return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(2)} km`;
}
/**
 * Calculate compass bearing from point A to point B (0-360 degrees)
 * 0° = North, 90° = East, 180° = South, 270° = West
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const rLat1 = toRad(lat1);
    const rLat2 = toRad(lat2);
    const y = Math.sin(dLon) * Math.cos(rLat2);
    const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
    const bearing = toDeg(Math.atan2(y, x));
    return Math.round((bearing + 360) % 360);
}
/**
 * Convert bearing degrees to human-readable compass direction
 */
function bearingToDirection(bearing) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(bearing / 45) % 8];
}
