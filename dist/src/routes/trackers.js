"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTrackerStatus = updateTrackerStatus;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const socket_1 = require("../socket"); // ← Clean import, no more circular require()
const router = (0, express_1.Router)();
// ── Zod Schemas ───────────────────────────────────────────────────────────────
const createTrackerSchema = zod_1.z.object({
    deviceName: zod_1.z.string().min(1, 'Device name is required').max(255),
    platform: zod_1.z.enum(['Android', 'iOS', 'Web Simulator']).optional()
});
// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Strip the apiKey before sending a tracker to the dashboard.
 * The apiKey is a device secret — only the device itself should know it.
 */
function safeTracker(tracker) {
    const { apiKey, ...rest } = tracker;
    return rest;
}
/**
 * Refresh tracker status based on lastSeen timestamp.
 * ONLINE < 30s, IDLE ≤ 120s, OFFLINE > 120s
 */
function updateTrackerStatus(tracker) {
    if (!tracker.lastSeen) {
        tracker.trackingStatus = 'OFFLINE';
        return tracker;
    }
    const diffSec = (Date.now() - new Date(tracker.lastSeen).getTime()) / 1000;
    if (diffSec < 30) {
        tracker.trackingStatus = 'ONLINE';
    }
    else if (diffSec <= 120) {
        tracker.trackingStatus = 'IDLE';
    }
    else {
        tracker.trackingStatus = 'OFFLINE';
    }
    return tracker;
}
// GET /api/v1/trackers
router.get('/', auth_1.authenticateToken, (req, res) => {
    const trackers = Array.from(db_1.db.trackers.values())
        .filter(t => t.organizationId === req.user.organizationId)
        .map(t => safeTracker(updateTrackerStatus(t)));
    res.json({ success: true, data: trackers });
});
// GET /api/v1/trackers/:id
router.get('/:id', auth_1.authenticateToken, (req, res) => {
    const id = req.params.id;
    const tracker = db_1.db.trackers.get(id);
    if (!tracker || tracker.organizationId !== req.user.organizationId) {
        return res.status(404).json({ success: false, error: 'Tracker not found' });
    }
    res.json({ success: true, data: safeTracker(updateTrackerStatus(tracker)) });
});
// POST /api/v1/trackers — Register a new tracker device
router.post('/', auth_1.authenticateToken, (req, res) => {
    const parsed = createTrackerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
    }
    const { deviceName, platform } = parsed.data;
    const trackerCode = `TRK-${Math.floor(100000 + Math.random() * 900000)}`;
    const id = `trk-${Date.now()}`;
    const apiKey = (0, db_1.generateDeviceApiKey)();
    const newTracker = {
        id,
        trackerCode,
        organizationId: req.user.organizationId,
        deviceName,
        platform: platform ?? 'iOS',
        batteryLevel: 100,
        trackingStatus: 'OFFLINE',
        lastLatitude: 28.6139, // Default initial center (New Delhi)
        lastLongitude: 77.2090,
        lastSpeed: 0,
        lastHeading: 0,
        lastAccuracy: 10,
        lastSeen: new Date().toISOString(),
        apiKey,
        createdAt: new Date().toISOString()
    };
    db_1.db.trackers.set(id, newTracker);
    db_1.db.saveToDisk();
    // Broadcast real-time event (apiKey excluded from broadcast)
    if (socket_1.io) {
        socket_1.io.emit('tracker:created', safeTracker(newTracker));
    }
    // Return the full tracker WITH apiKey — only on creation, so the device can save it
    res.status(201).json({
        success: true,
        message: 'Tracker registered. Save the apiKey — it will not be shown again.',
        data: newTracker // ← apiKey included here intentionally (first and only time)
    });
});
exports.default = router;
