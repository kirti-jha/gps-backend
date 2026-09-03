import { Router, Response } from 'express';
import { db } from '../store/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { calculateDistanceKm, formatDistance, calculateBearing, bearingToDirection } from '../utils/geo';
import { updateTrackerStatus } from './trackers';

const router = Router();

const OSRM_BASE_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';

function formatDuration(mins: number): string {
  if (mins < 1) return 'Less than 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/**
 * GET /api/v1/route
 *
 * Supports flexible real-world query combinations:
 * 1. ?fromTrackerId=TRK_1&toTrackerId=TRK_2             (Route between 2 devices)
 * 2. ?trackerId=TRK_1&userLat=28.5772&userLng=77.0650   (Route from User Browser GPS to Device)
 * 3. ?fromLat=28.5772&fromLng=77.0650&toLat=28.5830&toLng=77.0560 (Route between 2 custom coordinates)
 * 4. ?trackerId=TRK_1                                   (Route between target device and nearest device or location history)
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const query = req.query as { [key: string]: string };

  // Parse potential coordinate inputs
  const fromLatRaw = query.fromLat || query.userLat || query.originLat || query.startLat || query.lat1;
  const fromLngRaw = query.fromLng || query.userLng || query.originLng || query.startLng || query.lng1;

  const toLatRaw   = query.toLat   || query.destLat || query.targetLat || query.endLat   || query.lat2;
  const toLngRaw   = query.toLng   || query.destLng || query.targetLng || query.endLng   || query.lng2;

  let fromTrackerId = query.fromTrackerId || query.from;
  let toTrackerId   = query.toTrackerId   || query.to;
  const mainTrackerId = query.trackerId || query.id;

  // Single trackerId param support
  if (mainTrackerId && !fromTrackerId && !toTrackerId) {
    if (fromLatRaw != null && fromLngRaw != null) {
      // Route from user coordinates to trackerId
      toTrackerId = mainTrackerId;
    } else {
      // Default fromTrackerId to trackerId
      fromTrackerId = mainTrackerId;
    }
  }

  let startLat: number | null = fromLatRaw ? parseFloat(fromLatRaw) : null;
  let startLng: number | null = fromLngRaw ? parseFloat(fromLngRaw) : null;
  let startLabel = 'User / Origin';
  let startId: string | undefined = undefined;

  let endLat: number | null = toLatRaw ? parseFloat(toLatRaw) : null;
  let endLng: number | null = toLngRaw ? parseFloat(toLngRaw) : null;
  let endLabel = 'Destination';
  let endId: string | undefined = undefined;

  const orgTrackers = Array.from(db.trackers.values())
    .filter(t => t.organizationId === req.user!.organizationId && t.lastLatitude != null && t.lastLongitude != null);

  // Resolve Start Location from Tracker if not explicit coordinates
  if ((startLat == null || startLng == null || isNaN(startLat) || isNaN(startLng)) && fromTrackerId) {
    const fromTracker = orgTrackers.find(
      t => t.id === fromTrackerId || t.trackerCode.toUpperCase() === fromTrackerId.toUpperCase()
    );
    if (fromTracker) {
      updateTrackerStatus(fromTracker);
      startLat = fromTracker.lastLatitude;
      startLng = fromTracker.lastLongitude;
      startLabel = fromTracker.deviceName;
      startId = fromTracker.id;
    }
  }

  // Resolve End Location from Tracker if not explicit coordinates
  if ((endLat == null || endLng == null || isNaN(endLat) || isNaN(endLng)) && toTrackerId) {
    const toTracker = orgTrackers.find(
      t => t.id === toTrackerId || t.trackerCode.toUpperCase() === toTrackerId.toUpperCase()
    );
    if (toTracker) {
      updateTrackerStatus(toTracker);
      endLat = toTracker.lastLatitude;
      endLng = toTracker.lastLongitude;
      endLabel = toTracker.deviceName;
      endId = toTracker.id;
    }
  }

  // Fallback: If only 1 point is resolved, try finding another device in organization
  if (startLat != null && startLng != null && (endLat == null || endLng == null)) {
    const fallbackOther = orgTrackers.find(t => t.id !== startId);
    if (fallbackOther) {
      endLat = fallbackOther.lastLatitude;
      endLng = fallbackOther.lastLongitude;
      endLabel = fallbackOther.deviceName;
      endId = fallbackOther.id;
    }
  }

  if (endLat != null && endLng != null && (startLat == null || startLng == null)) {
    const fallbackOther = orgTrackers.find(t => t.id !== endId);
    if (fallbackOther) {
      startLat = fallbackOther.lastLatitude;
      startLng = fallbackOther.lastLongitude;
      startLabel = fallbackOther.deviceName;
      startId = fallbackOther.id;
    }
  }

  // Fallback: If we have a tracker with location history points, build history route line
  if ((startLat == null || endLat == null) && mainTrackerId) {
    const tracker = orgTrackers.find(t => t.id === mainTrackerId || t.trackerCode.toUpperCase() === mainTrackerId.toUpperCase());
    if (tracker) {
      const history = db.locations.get(tracker.id) || [];
      if (history.length >= 2) {
        const coordinates = history.map(p => [p.longitude, p.latitude]);
        const p1 = history[0];
        const p2 = history[history.length - 1];
        const distKm = calculateDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

        return res.json({
          success: true,
          data: {
            type: 'LineString',
            coordinates,
            distanceKm: Math.round(distKm * 100) / 100,
            distanceFormatted: formatDistance(distKm),
            durationMinutes: 0,
            durationFormatted: '0 min',
            from: { id: tracker.id, deviceName: tracker.deviceName, lat: p1.latitude, lng: p1.longitude },
            to: { id: tracker.id, deviceName: tracker.deviceName, lat: p2.latitude, lng: p2.longitude }
          }
        });
      }
    }
  }

  // If we still cannot resolve two points
  if (startLat == null || startLng == null || endLat == null || endLng == null) {
    return res.status(400).json({
      success: false,
      error: 'Could not resolve origin and destination coordinates. Please provide user coordinates or activate tracking on a device.'
    });
  }

  const straightLineKm = calculateDistanceKm(startLat, startLng, endLat, endLng);
  const bearing        = calculateBearing(startLat, startLng, endLat, endLng);
  const direction      = bearingToDirection(bearing);

  // If start and end points are essentially identical (< 5 meters), add a micro offset for map polyline rendering
  let renderEndLat = endLat;
  let renderEndLng = endLng;
  if (straightLineKm < 0.005) {
    renderEndLat = endLat + 0.00015; // ~15 meters shift so a visible segment renders on map
    renderEndLng = endLng + 0.00015;
  }

  const osrmUrl = `${OSRM_BASE_URL}/route/v1/driving/${startLng},${startLat};${renderEndLng},${renderEndLat}?overview=full&geometries=geojson&steps=true`;

  try {
    const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(6000) });
    if (!osrmRes.ok) throw new Error(`OSRM HTTP ${osrmRes.status}`);

    const osrmData = await osrmRes.json() as any;
    if (osrmData.code !== 'Ok' || !osrmData.routes || osrmData.routes.length === 0) {
      throw new Error(`OSRM routing code: ${osrmData.code}`);
    }

    const osrmRoute = osrmData.routes[0];
    const distanceKm      = Math.round((osrmRoute.distance / 1000) * 100) / 100;
    const durationMinutes = Math.max(1, Math.round(osrmRoute.duration / 60));

    return res.json({
      success: true,
      data: {
        type: 'LineString',
        coordinates: osrmRoute.geometry.coordinates,
        distanceKm,
        distanceFormatted: formatDistance(distanceKm),
        durationMinutes,
        durationFormatted: formatDuration(durationMinutes),
        straightLineKm: Math.round(straightLineKm * 100) / 100,
        straightLineFormatted: formatDistance(straightLineKm),
        bearing,
        direction,
        summary: osrmRoute.legs?.[0]?.summary || 'Shortest Driving Route',
        from: {
          id: startId,
          deviceName: startLabel,
          lat: startLat,
          lng: startLng
        },
        to: {
          id: endId,
          deviceName: endLabel,
          lat: endLat,
          lng: endLng
        }
      }
    });

  } catch (err: any) {
    console.warn(`[Route API] OSRM network route unavailable: ${err.message}. Using straight-line geometry fallback.`);

    return res.json({
      success: true,
      warning: 'Road routing service unavailable. Showing direct path segment.',
      data: {
        type: 'LineString',
        coordinates: [
          [startLng, startLat],
          [renderEndLng, renderEndLat]
        ],
        distanceKm: Math.round(straightLineKm * 100) / 100,
        distanceFormatted: formatDistance(straightLineKm),
        durationMinutes: Math.max(1, Math.round((straightLineKm / 40) * 60)), // estimated at 40 km/h
        durationFormatted: formatDuration(Math.max(1, Math.round((straightLineKm / 40) * 60))),
        straightLineKm: Math.round(straightLineKm * 100) / 100,
        straightLineFormatted: formatDistance(straightLineKm),
        bearing,
        direction,
        from: { id: startId, deviceName: startLabel, lat: startLat, lng: startLng },
        to: { id: endId, deviceName: endLabel, lat: endLat, lng: endLng }
      }
    });
  }
});

export default router;
