import { Router, Response } from 'express';
import { z } from 'zod';
import { db, generateDeviceApiKey } from '../store/db.js';
import { validateGPSPoint, isPointInCircle, isPointInPolygon, calculateDistanceKm, formatDistance, calculateBearing, bearingToDirection } from '../utils/geo.js';
import { LocationPoint, Alert, Tracker } from '../types/index.js';
import { io } from '../socket.js'; // ← Clean import from socket.ts

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_HISTORY_POINTS = 5000; // Max location points kept per tracker in RAM

// ── Zod Schema ────────────────────────────────────────────────────────────────
const locationSchema = z.object({
  trackerCode: z.string().min(1).max(100),
  latitude:    z.number().min(-90).max(90),
  longitude:   z.number().min(-180).max(180),
  accuracy:    z.number().positive().max(500),
  speed:       z.number().min(0).max(600).optional(),
  heading:     z.number().min(0).max(360).optional(),
  altitude:    z.number().optional(),
  battery:     z.number().min(0).max(100).optional(),
  timestamp:   z.union([z.number(), z.string()]).optional()
});

// ── Proximity Snapshot ────────────────────────────────────────────────────────
/**
 * Build a real-time proximity snapshot: distances from sourceTracker to every other tracker.
 * Attached to every tracker:location WS event — frontend never needs to poll.
 */
function buildProximitySnapshot(sourceTracker: Tracker) {
  return Array.from(db.trackers.values())
    .filter(t => t.id !== sourceTracker.id && t.lastLatitude != null && t.lastLongitude != null)
    .map(t => {
      const distKm  = calculateDistanceKm(sourceTracker.lastLatitude, sourceTracker.lastLongitude, t.lastLatitude, t.lastLongitude);
      const bearing = calculateBearing(sourceTracker.lastLatitude, sourceTracker.lastLongitude, t.lastLatitude, t.lastLongitude);
      return {
        trackerId:         t.id,
        trackerCode:       t.trackerCode,
        deviceName:        t.deviceName,
        battery:           t.batteryLevel,
        status:            t.trackingStatus,
        trackingStatus:    t.trackingStatus,
        distanceKm:        distKm,
        distanceFormatted: formatDistance(distKm),
        bearing,
        direction:         bearingToDirection(bearing)
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm); // nearest first
}

// ── Core Location Processor ───────────────────────────────────────────────────
interface LocationIngestBody {
  trackerCode: string;
  latitude:    number;
  longitude:   number;
  accuracy:    number;
  speed?:      number;
  heading?:    number;
  altitude?:   number;
  battery?:    number;
  timestamp?:  number | string;
}

export function processSingleLocationPoint(
  data: LocationIngestBody,
  deviceKey?: string
): { success: boolean; error?: string; statusCode?: number; tracker?: Tracker; point?: LocationPoint; isNewTracker?: boolean } {

  const { trackerCode, latitude, longitude, accuracy, speed = 0, heading = 0, altitude = 0, battery = 100, timestamp } = data;

  if (!trackerCode || latitude === undefined || longitude === undefined) {
    return { success: false, statusCode: 400, error: 'Missing required parameters (trackerCode, latitude, longitude)' };
  }

  const recordedAtDate = timestamp ? new Date(timestamp) : new Date();
  const recordedAtMs   = recordedAtDate.getTime();

  // Find existing tracker by code or ID
  let tracker = Array.from(db.trackers.values()).find(
    t => t.trackerCode.toUpperCase() === trackerCode.toUpperCase() || t.id === trackerCode
  );
  let isNewTracker = false;

  if (tracker) {
    // ── Existing tracker: MUST provide a valid API key ──────────────────────
    if (!deviceKey || tracker.apiKey !== deviceKey) {
      return {
        success: false,
        statusCode: 401,
        error: 'Invalid or missing device API key. Include X-Device-Key header with your device key.'
      };
    }
  } else {
    // ── New tracker: auto-register and issue an API key ─────────────────────
    const isIphone = trackerCode.toLowerCase().includes('iphone') || trackerCode.toLowerCase().includes('ios');
    const newApiKey = generateDeviceApiKey();
    tracker = {
      id:             `trk-${Date.now()}`,
      trackerCode:    trackerCode.toUpperCase(),
      organizationId: 'org-abc-logistics',
      deviceName:     isIphone ? `Apple iPhone (${trackerCode.toUpperCase()})` : `Mobile Device (${trackerCode.toUpperCase()})`,
      platform:       isIphone ? 'iOS' : 'Android',
      batteryLevel:   battery ?? 100,
      trackingStatus: 'ONLINE',
      lastLatitude:   latitude,
      lastLongitude:  longitude,
      lastSpeed:      speed,
      lastHeading:    heading,
      lastAccuracy:   accuracy ?? 8,
      lastSeen:       recordedAtDate.toISOString(),
      apiKey:         newApiKey,
      createdAt:      new Date().toISOString()
    };
    db.trackers.set(tracker.id, tracker);
    isNewTracker = true;

    if (io) io.emit('tracker:created', (() => { const { apiKey, ...safe } = tracker!; return safe; })());
  }

  // ── GPS Validation ────────────────────────────────────────────────────────
  const lastPoint = tracker.lastLatitude ? {
    lat: tracker.lastLatitude, lng: tracker.lastLongitude,
    timestampMs: new Date(tracker.lastSeen).getTime()
  } : undefined;

  const validation = validateGPSPoint(latitude, longitude, accuracy ?? 10, recordedAtMs, lastPoint);
  if (!validation.valid) {
    console.warn(`[GPS Engine] Rejected point for ${trackerCode}: ${validation.reason}`);
    return { success: false, statusCode: 422, error: validation.reason };
  }

  // ── Create Location Record ────────────────────────────────────────────────
  const point: LocationPoint = {
    id:          `loc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    trackerId:   tracker.id,
    latitude, longitude,
    accuracy:    accuracy ?? 8,
    speed, heading, altitude,
    battery:     battery ?? 100,
    recordedAt:  recordedAtDate.toISOString(),
    createdAt:   new Date().toISOString()
  };

  // ── Store with Memory Cap ─────────────────────────────────────────────────
  const history = db.locations.get(tracker.id) ?? [];
  history.push(point);
  // Keep only last MAX_HISTORY_POINTS to prevent RAM overflow
  if (history.length > MAX_HISTORY_POINTS) {
    history.splice(0, history.length - MAX_HISTORY_POINTS);
  }
  db.locations.set(tracker.id, history);

  // ── Update Tracker State ──────────────────────────────────────────────────
  const prevLat = tracker.lastLatitude;
  const prevLng = tracker.lastLongitude;

  tracker.lastLatitude  = latitude;
  tracker.lastLongitude = longitude;
  tracker.lastSpeed     = speed;
  tracker.lastHeading   = heading;
  tracker.lastAccuracy  = accuracy ?? 8;
  tracker.batteryLevel  = battery ?? 100;
  tracker.lastSeen      = recordedAtDate.toISOString();
  tracker.trackingStatus = 'ONLINE';
  db.trackers.set(tracker.id, tracker);

  // ── Geofence Checks ───────────────────────────────────────────────────────
  const orgGeofences = Array.from(db.geofences.values()).filter(g => g.organizationId === tracker!.organizationId);

  orgGeofences.forEach(gf => {
    let wasInside = false;
    let isInside  = false;

    if (gf.type === 'CIRCLE') {
      const circle = gf.coordinates as any;
      if (prevLat && prevLng) wasInside = isPointInCircle(prevLat, prevLng, circle.center, circle.radius);
      isInside = isPointInCircle(latitude, longitude, circle.center, circle.radius);
    } else if (gf.type === 'POLYGON') {
      const polygon = gf.coordinates as any;
      if (prevLat && prevLng) wasInside = isPointInPolygon(prevLat, prevLng, polygon.points);
      isInside = isPointInPolygon(latitude, longitude, polygon.points);
    }

    if (!wasInside && isInside)  createAlert(tracker!, 'GEOFENCE_ENTER', `Entered geofence zone: "${gf.name}"`);
    if (wasInside  && !isInside) createAlert(tracker!, 'GEOFENCE_EXIT',  `Exited geofence zone: "${gf.name}"`);
  });

  // ── Speed & Battery Alerts ────────────────────────────────────────────────
  if (speed > 80) {
    createAlert(tracker, 'OVERSPEED', `Exceeded speed limit! Speed: ${Math.round(speed)} km/h`);
  }
  if ((battery ?? 100) < 20 && tracker.batteryLevel >= 20) {
    createAlert(tracker, 'LOW_BATTERY', `Battery low: ${battery}% remaining`);
  }

  // ── Broadcast WebSocket Event ─────────────────────────────────────────────
  if (io) {
    io.emit('tracker:location', {
      trackerId:        tracker.id,
      trackerCode:      tracker.trackerCode,
      deviceName:       tracker.deviceName,
      platform:         tracker.platform,
      latitude, longitude,
      accuracy:         accuracy ?? 8,
      speed, heading, altitude,
      battery,          // live battery %
      lastSeen:         tracker.lastSeen,
      status:           'ONLINE',
      proximitySnapshot: buildProximitySnapshot(tracker) // real-time distances to all other devices
    });
  }

  return { success: true, tracker, point, isNewTracker };
}

// ── Alert Helper with Deduplication ──────────────────────────────────────────
function createAlert(tracker: Tracker, type: string, message: string) {
  // Check cooldown — prevents spam alerts for same event type
  if (!db.canCreateAlert(tracker.id, type)) {
    return;
  }

  const alert: Alert = {
    id:             `alt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    organizationId: tracker.organizationId,
    trackerId:      tracker.id,
    trackerCode:    tracker.trackerCode,
    trackerName:    tracker.deviceName,
    type:           type as any,
    message,
    isRead:         false,
    createdAt:      new Date().toISOString()
  };

  db.alerts.unshift(alert);
  db.recordAlertTime(tracker.id, type); // Record time for dedup
  if (io) io.emit('alert:created', alert);
}

// ── POST /api/v1/locations — Single point ingestion ──────────────────────────
router.post('/', (req, res: Response) => {
  // Validate input with Zod
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    });
  }

  const deviceKey = req.headers['x-device-key'] as string | undefined;
  const result = processSingleLocationPoint(parsed.data, deviceKey);

  if (!result.success) {
    return res.status(result.statusCode ?? 400).json({ success: false, error: result.error });
  }

  const response: any = {
    success: true,
    message: 'Location point recorded',
    data: { point: result.point }
  };

  // On first registration, include the apiKey so the device can save it
  if (result.isNewTracker && result.tracker) {
    response.deviceRegistered = true;
    response.apiKey = result.tracker.apiKey;
    response.message = 'New device auto-registered. Save the apiKey — it is required for all future requests.';
  }

  res.json(response);
});

// ── POST /api/v1/locations/batch — Offline recovery queue ingestion ───────────
router.post('/batch', (req, res: Response) => {
  const batchSchema = z.object({
    points: z.array(locationSchema).min(1).max(500)
  });

  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    });
  }

  const deviceKey = req.headers['x-device-key'] as string | undefined;
  let processedCount = 0;
  const errors: string[] = [];

  parsed.data.points.forEach(pt => {
    const r = processSingleLocationPoint(pt, deviceKey);
    if (r.success) {
      processedCount++;
    } else if (r.error) {
      errors.push(r.error);
    }
  });

  res.json({
    success:      true,
    message:      `Batch processed: ${processedCount} points accepted`,
    processedCount,
    failedCount:  parsed.data.points.length - processedCount,
    errors:       errors.slice(0, 5)
  });
});

export default router;
