import { Router, Response } from 'express';
import { db } from '../store/db.js';
import { validateGPSPoint, isPointInCircle, isPointInPolygon } from '../utils/geo.js';
import { LocationPoint, Alert, Tracker } from '../types/index.js';
import { io } from '../index.js';

const router = Router();

interface LocationIngestBody {
  trackerCode: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  battery?: number;
  timestamp?: number | string;
}

export function processSingleLocationPoint(data: LocationIngestBody): { success: boolean; error?: string; tracker?: Tracker; point?: LocationPoint } {
  const { trackerCode, latitude, longitude, accuracy, speed = 0, heading = 0, altitude = 0, battery = 100, timestamp } = data;

  if (!trackerCode || latitude === undefined || longitude === undefined) {
    return { success: false, error: 'Missing required parameters (trackerCode, latitude, longitude)' };
  }

  // Find tracker by code or ID
  const tracker = Array.from(db.trackers.values()).find(
    t => t.trackerCode === trackerCode || t.id === trackerCode
  );

  if (!tracker) {
    return { success: false, error: `Tracker with code ${trackerCode} not found` };
  }

  const recordedAtDate = timestamp ? new Date(timestamp) : new Date();
  const recordedAtMs = recordedAtDate.getTime();

  // Validate GPS Point
  const lastPoint = tracker.lastLatitude ? {
    lat: tracker.lastLatitude,
    lng: tracker.lastLongitude,
    timestampMs: new Date(tracker.lastSeen).getTime()
  } : undefined;

  const validation = validateGPSPoint(latitude, longitude, accuracy || 10, recordedAtMs, lastPoint);

  if (!validation.valid) {
    console.warn(`[GPS Engine] Rejected point for ${trackerCode}: ${validation.reason}`);
    return { success: false, error: validation.reason };
  }

  // Create Location Record
  const point: LocationPoint = {
    id: `loc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    trackerId: tracker.id,
    latitude,
    longitude,
    accuracy: accuracy || 8,
    speed,
    heading,
    altitude,
    battery,
    recordedAt: recordedAtDate.toISOString(),
    createdAt: new Date().toISOString()
  };

  // Add to historical database
  const history = db.locations.get(tracker.id) || [];
  history.push(point);
  db.locations.set(tracker.id, history);

  // Update Tracker Current State
  const prevLat = tracker.lastLatitude;
  const prevLng = tracker.lastLongitude;

  tracker.lastLatitude = latitude;
  tracker.lastLongitude = longitude;
  tracker.lastSpeed = speed;
  tracker.lastHeading = heading;
  tracker.lastAccuracy = accuracy || 8;
  tracker.batteryLevel = battery;
  tracker.lastSeen = recordedAtDate.toISOString();
  tracker.trackingStatus = 'ONLINE';

  db.trackers.set(tracker.id, tracker);

  // Check Geofences
  const orgGeofences = Array.from(db.geofences.values()).filter(g => g.organizationId === tracker.organizationId);

  orgGeofences.forEach(gf => {
    let wasInside = false;
    let isInside = false;

    if (gf.type === 'CIRCLE') {
      const circle = gf.coordinates as any;
      if (prevLat && prevLng) {
        wasInside = isPointInCircle(prevLat, prevLng, circle.center, circle.radius);
      }
      isInside = isPointInCircle(latitude, longitude, circle.center, circle.radius);
    } else if (gf.type === 'POLYGON') {
      const polygon = gf.coordinates as any;
      if (prevLat && prevLng) {
        wasInside = isPointInPolygon(prevLat, prevLng, polygon.points);
      }
      isInside = isPointInPolygon(latitude, longitude, polygon.points);
    }

    // Geofence Enter Alert
    if (!wasInside && isInside) {
      const alert: Alert = {
        id: `alt-${Date.now()}`,
        organizationId: tracker.organizationId,
        trackerId: tracker.id,
        trackerCode: tracker.trackerCode,
        trackerName: tracker.deviceName,
        type: 'GEOFENCE_ENTER',
        message: `Entered geofence zone: "${gf.name}"`,
        isRead: false,
        createdAt: new Date().toISOString()
      };
      db.alerts.unshift(alert);
      if (io) io.emit('alert:created', alert);
    }

    // Geofence Exit Alert
    if (wasInside && !isInside) {
      const alert: Alert = {
        id: `alt-${Date.now()}`,
        organizationId: tracker.organizationId,
        trackerId: tracker.id,
        trackerCode: tracker.trackerCode,
        trackerName: tracker.deviceName,
        type: 'GEOFENCE_EXIT',
        message: `Exited geofence zone: "${gf.name}"`,
        isRead: false,
        createdAt: new Date().toISOString()
      };
      db.alerts.unshift(alert);
      if (io) io.emit('alert:created', alert);
    }
  });

  // Overspeed Alert (> 80 km/h)
  if (speed > 80) {
    const alert: Alert = {
      id: `alt-speed-${Date.now()}`,
      organizationId: tracker.organizationId,
      trackerId: tracker.id,
      trackerCode: tracker.trackerCode,
      trackerName: tracker.deviceName,
      type: 'OVERSPEED',
      message: `Exceeded speed limit! Speed: ${Math.round(speed)} km/h`,
      isRead: false,
      createdAt: new Date().toISOString()
    };
    db.alerts.unshift(alert);
    if (io) io.emit('alert:created', alert);
  }

  // Low battery alert (< 20%)
  if (battery < 20 && tracker.batteryLevel >= 20) {
    const alert: Alert = {
      id: `alt-bat-${Date.now()}`,
      organizationId: tracker.organizationId,
      trackerId: tracker.id,
      trackerCode: tracker.trackerCode,
      trackerName: tracker.deviceName,
      type: 'LOW_BATTERY',
      message: `Battery low: ${battery}% remaining`,
      isRead: false,
      createdAt: new Date().toISOString()
    };
    db.alerts.unshift(alert);
    if (io) io.emit('alert:created', alert);
  }

  // Broadcast WebSocket event
  if (io) {
    io.emit('tracker:location', {
      trackerId: tracker.id,
      trackerCode: tracker.trackerCode,
      deviceName: tracker.deviceName,
      latitude,
      longitude,
      accuracy: accuracy || 8,
      speed,
      heading,
      altitude,
      battery,
      lastSeen: tracker.lastSeen,
      status: 'ONLINE'
    });
  }

  return { success: true, tracker, point };
}

// POST /api/v1/locations (Single point ingestion)
router.post('/', (req, res: Response) => {
  const result = processSingleLocationPoint(req.body);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }

  res.json({
    success: true,
    message: 'Location point recorded',
    data: {
      tracker: result.tracker,
      point: result.point
    }
  });
});

// POST /api/v1/locations/batch (Offline recovery queue ingestion)
router.post('/batch', (req, res: Response) => {
  const { points } = req.body;

  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ success: false, error: 'Points array required' });
  }

  let processedCount = 0;
  const errors: string[] = [];

  points.forEach((pt: LocationIngestBody) => {
    const res = processSingleLocationPoint(pt);
    if (res.success) {
      processedCount++;
    } else if (res.error) {
      errors.push(res.error);
    }
  });

  res.json({
    success: true,
    message: `Batch processed: ${processedCount} points accepted`,
    processedCount,
    failedCount: points.length - processedCount,
    errors: errors.slice(0, 5)
  });
});

export default router;
