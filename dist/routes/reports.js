"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const geo_1 = require("../utils/geo");
const trackers_1 = require("./trackers");
const router = (0, express_1.Router)();
// GET /api/v1/reports/summary
router.get('/summary', auth_1.authenticateToken, (req, res) => {
    const trackers = Array.from(db_1.db.trackers.values())
        .filter(t => t.organizationId === req.user.organizationId)
        .map(trackers_1.updateTrackerStatus);
    const totalTrackers = trackers.length;
    const onlineCount = trackers.filter(t => t.trackingStatus === 'ONLINE').length;
    const idleCount = trackers.filter(t => t.trackingStatus === 'IDLE').length;
    const offlineCount = trackers.filter(t => t.trackingStatus === 'OFFLINE').length;
    const movingCount = trackers.filter(t => t.trackingStatus === 'ONLINE' && t.lastSpeed > 5).length;
    const stoppedCount = totalTrackers - movingCount;
    // Total Fleet Distance Today
    let fleetDistanceTodayKm = 0;
    trackers.forEach(t => {
        const points = db_1.db.locations.get(t.id) || [];
        for (let i = 1; i < points.length; i++) {
            fleetDistanceTodayKm += (0, geo_1.calculateDistanceKm)(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
        }
    });
    const alerts = db_1.db.alerts.filter(a => a.organizationId === req.user.organizationId);
    const unreadAlertsCount = alerts.filter(a => !a.isRead).length;
    res.json({
        success: true,
        data: {
            totalTrackers,
            onlineCount,
            idleCount,
            offlineCount,
            movingCount,
            stoppedCount,
            fleetDistanceTodayKm: Math.round(fleetDistanceTodayKm * 10) / 10,
            totalAlerts: alerts.length,
            unreadAlertsCount,
            totalGeofences: db_1.db.geofences.size
        }
    });
});
exports.default = router;
