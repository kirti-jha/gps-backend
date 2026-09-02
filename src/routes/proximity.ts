import { Router, Response } from 'express';
import { db } from '../store/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { calculateDistanceKm, formatDistance, calculateBearing, bearingToDirection } from '../utils/geo.js';
import { updateTrackerStatus } from './trackers.js';

const router = Router();

/**
 * GET /api/v1/proximity
 * 
 * Returns real-time distance from a reference tracker to ALL other trackers
 * in the same organization. Sorted by nearest first.
 * 
 * Query params:
 *   ?referenceTrackerId=trk-xxx   ← the "my device" tracker id
 * 
 * Response includes:
 *  - straightLineKm  (Haversine, instant, no external API)
 *  - bearing         (compass degrees 0-360)
 *  - direction       (N / NE / E / SE / S / SW / W / NW)
 *  - battery         (live battery %)
 *  - status          (ONLINE / IDLE / OFFLINE)
 */
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const { referenceTrackerId } = req.query;

  if (!referenceTrackerId || typeof referenceTrackerId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Query param "referenceTrackerId" is required'
    });
  }

  // Look up the reference tracker
  const refTracker = db.trackers.get(referenceTrackerId);
  if (!refTracker || refTracker.organizationId !== req.user!.organizationId) {
    return res.status(404).json({
      success: false,
      error: 'Reference tracker not found or not in your organization'
    });
  }

  if (refTracker.lastLatitude == null || refTracker.lastLongitude == null) {
    return res.status(422).json({
      success: false,
      error: 'Reference tracker has no location data yet. Please send a GPS point first.'
    });
  }

  updateTrackerStatus(refTracker);

  // Build distances to all other org trackers
  const devices = Array.from(db.trackers.values())
    .filter(t =>
      t.id !== referenceTrackerId &&
      t.organizationId === req.user!.organizationId &&
      t.lastLatitude != null &&
      t.lastLongitude != null
    )
    .map(t => {
      updateTrackerStatus(t);
      const distKm = calculateDistanceKm(
        refTracker.lastLatitude, refTracker.lastLongitude,
        t.lastLatitude, t.lastLongitude
      );
      const bearing = calculateBearing(
        refTracker.lastLatitude, refTracker.lastLongitude,
        t.lastLatitude, t.lastLongitude
      );
      return {
        id: t.id,
        trackerCode: t.trackerCode,
        deviceName: t.deviceName,
        platform: t.platform,
        battery: t.batteryLevel,
        status: t.trackingStatus,
        lastSeen: t.lastSeen,
        lat: t.lastLatitude,
        lng: t.lastLongitude,
        speed: t.lastSpeed,
        straightLineKm: distKm,
        straightLineFormatted: formatDistance(distKm),
        bearing,
        direction: bearingToDirection(bearing)
      };
    })
    .sort((a, b) => a.straightLineKm - b.straightLineKm); // nearest first

  res.json({
    success: true,
    data: {
      reference: {
        id: refTracker.id,
        trackerCode: refTracker.trackerCode,
        deviceName: refTracker.deviceName,
        platform: refTracker.platform,
        battery: refTracker.batteryLevel,
        status: refTracker.trackingStatus,
        lat: refTracker.lastLatitude,
        lng: refTracker.lastLongitude,
        lastSeen: refTracker.lastSeen
      },
      totalDevices: devices.length,
      devices
    }
  });
});

export default router;
