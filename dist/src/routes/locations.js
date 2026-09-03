"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSingleLocationPoint = processSingleLocationPoint;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../store/db");
const geo_1 = require("../utils/geo");
const socket_1 = require("../socket"); // ← Clean import from socket.ts
const router = (0, express_1.Router)();
// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_HISTORY_POINTS = 5000; // Max location points kept per tracker in RAM
// ── Zod Schema ────────────────────────────────────────────────────────────────
const locationSchema = zod_1.z.object({
    trackerCode: zod_1.z.string().min(1).max(100),
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    accuracy: zod_1.z.number().positive().max(500),
    speed: zod_1.z.number().min(0).max(600).optional(),
    heading: zod_1.z.number().min(0).max(360).optional(),
    altitude: zod_1.z.number().optional(),
    battery: zod_1.z.number().min(0).max(100).optional(),
    timestamp: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional()
});
// ── Proximity Snapshot ────────────────────────────────────────────────────────
/**
 * Build a real-time proximity snapshot: distances from sourceTracker to every other tracker.
 * Attached to every tracker:location WS event — frontend never needs to poll.
 */
function buildProximitySnapshot(sourceTracker) {
    return Array.from(db_1.db.trackers.values())
        .filter(t => t.id !== sourceTracker.id && t.lastLatitude != null && t.lastLongitude != null)
        .map(t => {
        const distKm = (0, geo_1.calculateDistanceKm)(sourceTracker.lastLatitude, sourceTracker.lastLongitude, t.lastLatitude, t.lastLongitude);
        const bearing = (0, geo_1.calculateBearing)(sourceTracker.lastLatitude, sourceTracker.lastLongitude, t.lastLatitude, t.lastLongitude);
        return {
            trackerId: t.id,
            trackerCode: t.trackerCode,
            deviceName: t.deviceName,
            battery: t.batteryLevel,
            status: t.trackingStatus,
            trackingStatus: t.trackingStatus,
            distanceKm: distKm,
            distanceFormatted: (0, geo_1.formatDistance)(distKm),
            bearing,
            direction: (0, geo_1.bearingToDirection)(bearing)
        };
    })
        .sort((a, b) => a.distanceKm - b.distanceKm); // nearest first
}
function processSingleLocationPoint(data, deviceKey) {
    const { trackerCode, latitude, longitude, accuracy, speed = 0, heading = 0, altitude = 0, battery = 100, timestamp } = data;
    if (!trackerCode || latitude === undefined || longitude === undefined) {
        return { success: false, statusCode: 400, error: 'Missing required parameters (trackerCode, latitude, longitude)' };
    }
    const recordedAtDate = timestamp ? new Date(timestamp) : new Date();
    const recordedAtMs = recordedAtDate.getTime();
    // Find existing tracker by code or ID
    let tracker = Array.from(db_1.db.trackers.values()).find(t => t.trackerCode.toUpperCase() === trackerCode.toUpperCase() || t.id === trackerCode);
    let isNewTracker = false;
    if (tracker) {
        // ── Existing tracker: validate API key only if explicitly provided ───────
        if (deviceKey && tracker.apiKey && tracker.apiKey !== deviceKey) {
            return {
                success: false,
                statusCode: 401,
                error: 'Invalid device API key.'
            };
        }
    }
    else {
        // ── New tracker: auto-register and issue an API key ─────────────────────
        const isIphone = trackerCode.toLowerCase().includes('iphone') || trackerCode.toLowerCase().includes('ios');
        const newApiKey = (0, db_1.generateDeviceApiKey)();
        tracker = {
            id: `trk-${Date.now()}`,
            trackerCode: trackerCode.toUpperCase(),
            organizationId: 'org-abc-logistics',
            deviceName: isIphone ? `Apple iPhone (${trackerCode.toUpperCase()})` : `Mobile Device (${trackerCode.toUpperCase()})`,
            platform: isIphone ? 'iOS' : 'Android',
            batteryLevel: battery ?? 100,
            trackingStatus: 'ONLINE',
            lastLatitude: latitude,
            lastLongitude: longitude,
            lastSpeed: speed,
            lastHeading: heading,
            lastAccuracy: accuracy ?? 8,
            lastSeen: recordedAtDate.toISOString(),
            apiKey: newApiKey,
            createdAt: new Date().toISOString()
        };
        db_1.db.trackers.set(tracker.id, tracker);
        isNewTracker = true;
        if (socket_1.io)
            socket_1.io.emit('tracker:created', (() => { const { apiKey, ...safe } = tracker; return safe; })());
    }
    // ── GPS Validation ────────────────────────────────────────────────────────
    const lastPoint = tracker.lastLatitude ? {
        lat: tracker.lastLatitude, lng: tracker.lastLongitude,
        timestampMs: new Date(tracker.lastSeen).getTime()
    } : undefined;
    const validation = (0, geo_1.validateGPSPoint)(latitude, longitude, accuracy ?? 10, recordedAtMs, lastPoint);
    if (!validation.valid) {
        console.warn(`[GPS Engine] Rejected point for ${trackerCode}: ${validation.reason}`);
        return { success: false, statusCode: 422, error: validation.reason };
    }
    // ── Create Location Record ────────────────────────────────────────────────
    const point = {
        id: `loc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        trackerId: tracker.id,
        latitude, longitude,
        accuracy: accuracy ?? 8,
        speed, heading, altitude,
        battery: battery ?? 100,
        recordedAt: recordedAtDate.toISOString(),
        createdAt: new Date().toISOString()
    };
    // ── Store with Memory Cap ─────────────────────────────────────────────────
    const history = db_1.db.locations.get(tracker.id) ?? [];
    history.push(point);
    // Keep only last MAX_HISTORY_POINTS to prevent RAM overflow
    if (history.length > MAX_HISTORY_POINTS) {
        history.splice(0, history.length - MAX_HISTORY_POINTS);
    }
    db_1.db.locations.set(tracker.id, history);
    // ── Update Tracker State ──────────────────────────────────────────────────
    const prevLat = tracker.lastLatitude;
    const prevLng = tracker.lastLongitude;
    tracker.lastLatitude = latitude;
    tracker.lastLongitude = longitude;
    tracker.lastSpeed = speed;
    tracker.lastHeading = heading;
    tracker.lastAccuracy = accuracy ?? 8;
    tracker.batteryLevel = battery ?? 100;
    tracker.lastSeen = recordedAtDate.toISOString();
    tracker.trackingStatus = 'ONLINE';
    db_1.db.trackers.set(tracker.id, tracker);
    // Persist to storage disk file
    db_1.db.saveToDisk();
    // ── Geofence Checks ───────────────────────────────────────────────────────
    const orgGeofences = Array.from(db_1.db.geofences.values()).filter(g => g.organizationId === tracker.organizationId);
    orgGeofences.forEach(gf => {
        let wasInside = false;
        let isInside = false;
        if (gf.type === 'CIRCLE') {
            const circle = gf.coordinates;
            if (prevLat && prevLng)
                wasInside = (0, geo_1.isPointInCircle)(prevLat, prevLng, circle.center, circle.radius);
            isInside = (0, geo_1.isPointInCircle)(latitude, longitude, circle.center, circle.radius);
        }
        else if (gf.type === 'POLYGON') {
            const polygon = gf.coordinates;
            if (prevLat && prevLng)
                wasInside = (0, geo_1.isPointInPolygon)(prevLat, prevLng, polygon.points);
            isInside = (0, geo_1.isPointInPolygon)(latitude, longitude, polygon.points);
        }
        if (!wasInside && isInside)
            createAlert(tracker, 'GEOFENCE_ENTER', `Entered geofence zone: "${gf.name}"`);
        if (wasInside && !isInside)
            createAlert(tracker, 'GEOFENCE_EXIT', `Exited geofence zone: "${gf.name}"`);
    });
    // ── Speed & Battery Alerts ────────────────────────────────────────────────
    if (speed > 80) {
        createAlert(tracker, 'OVERSPEED', `Exceeded speed limit! Speed: ${Math.round(speed)} km/h`);
    }
    if ((battery ?? 100) < 20 && tracker.batteryLevel >= 20) {
        createAlert(tracker, 'LOW_BATTERY', `Battery low: ${battery}% remaining`);
    }
    // ── Broadcast WebSocket Event ─────────────────────────────────────────────
    if (socket_1.io) {
        socket_1.io.emit('tracker:location', {
            trackerId: tracker.id,
            trackerCode: tracker.trackerCode,
            deviceName: tracker.deviceName,
            platform: tracker.platform,
            latitude, longitude,
            accuracy: accuracy ?? 8,
            speed, heading, altitude,
            battery, // live battery %
            lastSeen: tracker.lastSeen,
            status: 'ONLINE',
            proximitySnapshot: buildProximitySnapshot(tracker) // real-time distances to all other devices
        });
    }
    return { success: true, tracker, point, isNewTracker };
}
// ── Alert Helper with Deduplication ──────────────────────────────────────────
function createAlert(tracker, type, message) {
    // Check cooldown — prevents spam alerts for same event type
    if (!db_1.db.canCreateAlert(tracker.id, type)) {
        return;
    }
    const alert = {
        id: `alt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        organizationId: tracker.organizationId,
        trackerId: tracker.id,
        trackerCode: tracker.trackerCode,
        trackerName: tracker.deviceName,
        type: type,
        message,
        isRead: false,
        createdAt: new Date().toISOString()
    };
    db_1.db.alerts.unshift(alert);
    db_1.db.recordAlertTime(tracker.id, type); // Record time for dedup
    if (socket_1.io)
        socket_1.io.emit('alert:created', alert);
}
// ── POST /api/v1/locations — Single point ingestion ──────────────────────────
router.post('/', (req, res) => {
    // Validate input with Zod
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
    }
    const deviceKey = req.headers['x-device-key'];
    const result = processSingleLocationPoint(parsed.data, deviceKey);
    if (!result.success) {
        return res.status(result.statusCode ?? 400).json({ success: false, error: result.error });
    }
    const response = {
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
router.post('/batch', (req, res) => {
    const batchSchema = zod_1.z.object({
        points: zod_1.z.array(locationSchema).min(1).max(500)
    });
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
    }
    const deviceKey = req.headers['x-device-key'];
    let processedCount = 0;
    const errors = [];
    parsed.data.points.forEach(pt => {
        const r = processSingleLocationPoint(pt, deviceKey);
        if (r.success) {
            processedCount++;
        }
        else if (r.error) {
            errors.push(r.error);
        }
    });
    res.json({
        success: true,
        message: `Batch processed: ${processedCount} points accepted`,
        processedCount,
        failedCount: parsed.data.points.length - processedCount,
        errors: errors.slice(0, 5)
    });
});
exports.default = router;
