import { Router, Response } from 'express';
import { db } from '../store/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { calculateDistanceKm, formatDistance, calculateBearing, bearingToDirection } from '../utils/geo.js';
import { updateTrackerStatus } from './trackers.js';

const router = Router();

const OSRM_BASE_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';

/**
 * GET /api/v1/route
 *
 * Supports two query styles:
 * 1. ?fromTrackerId=TRK_1&toTrackerId=TRK_2  (Route between 2 devices)
 * 2. ?trackerId=TRK_1                        (Route for single device - using nearest device or history)
 *
 * Returns standard GeoJSON LineString at `data.type` / `data.coordinates`
 * for direct map consumption, plus metadata.
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  let { fromTrackerId, toTrackerId, trackerId } = req.query as { [key: string]: string };

  // Support single trackerId query parameter by finding another device in the same org
  if (trackerId && (!fromTrackerId || !toTrackerId)) {
    fromTrackerId = trackerId;
    const otherTrackers = Array.from(db.trackers.values())
      .filter(t => t.id !== trackerId && t.organizationId === req.user!.organizationId && t.lastLatitude != null);
    
    if (otherTrackers.length > 0) {
      toTrackerId = otherTrackers[0].id;
    }
  }

  if (!fromTrackerId) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "fromTrackerId" or "trackerId" is required'
    });
  }

  // Look up source tracker
  const fromTracker = Array.from(db.trackers.values()).find(
    t => (t.id === fromTrackerId || t.trackerCode.toUpperCase() === fromTrackerId.toUpperCase()) &&
         t.organizationId === req.user!.organizationId
  );

  if (!fromTracker) {
    return res.status(404).json({ success: false, error: 'Source tracker not found in your organization' });
  }

  if (fromTracker.lastLatitude == null || fromTracker.lastLongitude == null) {
    return res.status(422).json({ success: false, error: `Tracker "${fromTracker.deviceName}" has no location data yet` });
  }

  // Look up destination tracker
  let toTracker = toTrackerId ? Array.from(db.trackers.values()).find(
    t => (t.id === toTrackerId || t.trackerCode.toUpperCase() === toTrackerId.toUpperCase()) &&
         t.organizationId === req.user!.organizationId
  ) : undefined;

  // If no destination tracker exists, fallback to history points of source tracker
  if (!toTracker || toTracker.id === fromTracker.id) {
    const points = db.locations.get(fromTracker.id) || [];
    const coordinates = points.map(p => [p.longitude, p.latitude]);

    if (coordinates.length === 0) {
      coordinates.push([fromTracker.lastLongitude, fromTracker.lastLatitude]);
    }

    return res.json({
      success: true,
      data: {
        type: 'LineString',
        coordinates,
        tracker: {
          id: fromTracker.id,
          trackerCode: fromTracker.trackerCode,
          deviceName: fromTracker.deviceName
        }
      }
    });
  }

  updateTrackerStatus(fromTracker);
  updateTrackerStatus(toTracker);

  const fromLat = fromTracker.lastLatitude;
  const fromLng = fromTracker.lastLongitude;
  const toLat   = toTracker.lastLatitude;
  const toLng   = toTracker.lastLongitude;

  const straightLineKm = calculateDistanceKm(fromLat, fromLng, toLat, toLng);
  const bearing        = calculateBearing(fromLat, fromLng, toLat, toLng);
  const direction      = bearingToDirection(bearing);

  const osrmUrl = `${OSRM_BASE_URL}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`;

  try {
    const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(8000) });
    if (!osrmRes.ok) throw new Error(`OSRM returned HTTP ${osrmRes.status}`);

    const osrmData = await osrmRes.json() as any;
    if (osrmData.code !== 'Ok' || !osrmData.routes || osrmData.routes.length === 0) {
      throw new Error(`OSRM could not find a route: ${osrmData.code}`);
    }

    const osrmRoute = osrmData.routes[0];
    const distanceKm      = Math.round((osrmRoute.distance / 1000) * 100) / 100;
    const durationMinutes = Math.round(osrmRoute.duration / 60);

    const formatDuration = (mins: number): string => {
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}min` : `${h}h`;
    };

    return res.json({
      success: true,
      data: {
        // Direct GeoJSON format matching frontend handover spec:
        type: 'LineString',
        coordinates: osrmRoute.geometry.coordinates,
        // Additional metadata:
        distanceKm,
        distanceFormatted: formatDistance(distanceKm),
        durationMinutes,
        durationFormatted: formatDuration(durationMinutes),
        straightLineKm,
        straightLineFormatted: formatDistance(straightLineKm),
        bearing,
        direction,
        from: {
          id: fromTracker.id,
          trackerCode: fromTracker.trackerCode,
          deviceName: fromTracker.deviceName,
          lat: fromLat, lng: fromLng
        },
        to: {
          id: toTracker.id,
          trackerCode: toTracker.trackerCode,
          deviceName: toTracker.deviceName,
          lat: toLat, lng: toLng
        }
      }
    });

  } catch (err: any) {
    console.warn(`[Route] OSRM unavailable: ${err.message}. Returning straight-line fallback.`);

    return res.json({
      success: true,
      warning: 'Road routing unavailable. Showing straight-line distance only.',
      data: {
        type: 'LineString',
        coordinates: [
          [fromLng, fromLat],
          [toLng, toLat]
        ],
        straightLineKm,
        straightLineFormatted: formatDistance(straightLineKm),
        bearing,
        direction
      }
    });
  }
});

export default router;
