"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTripsForTracker = detectTripsForTracker;
const express_1 = require("express");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const geo_1 = require("../utils/geo");
const router = (0, express_1.Router)();
// Function to automatically segment continuous location points into discrete trips
function detectTripsForTracker(trackerId) {
    const points = db_1.db.locations.get(trackerId) || [];
    if (points.length < 2)
        return [];
    // Sort chronologically
    const sortedPoints = [...points].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    const trips = [];
    let currentTripPoints = [];
    for (let i = 0; i < sortedPoints.length; i++) {
        const pt = sortedPoints[i];
        if (currentTripPoints.length === 0) {
            if (pt.speed > 3) {
                currentTripPoints.push(pt);
            }
        }
        else {
            const prev = currentTripPoints[currentTripPoints.length - 1];
            const timeDeltaMs = new Date(pt.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
            // If gap > 10 minutes or prolonged stop, finalize current trip
            if (timeDeltaMs > 600000 || (pt.speed === 0 && timeDeltaMs > 300000)) {
                if (currentTripPoints.length > 3) {
                    trips.push(buildTripObject(trackerId, trips.length + 1, currentTripPoints));
                }
                currentTripPoints = pt.speed > 3 ? [pt] : [];
            }
            else {
                currentTripPoints.push(pt);
            }
        }
    }
    if (currentTripPoints.length > 3) {
        trips.push(buildTripObject(trackerId, trips.length + 1, currentTripPoints));
    }
    return trips;
}
function buildTripObject(trackerId, tripIndex, points) {
    const startPt = points[0];
    const endPt = points[points.length - 1];
    let distanceKm = 0;
    let maxSpeedKm = 0;
    let speedSum = 0;
    let stopCount = 0;
    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (pt.speed > maxSpeedKm)
            maxSpeedKm = pt.speed;
        speedSum += pt.speed;
        if (pt.speed === 0)
            stopCount++;
        if (i > 0) {
            distanceKm += (0, geo_1.calculateDistanceKm)(points[i - 1].latitude, points[i - 1].longitude, pt.latitude, pt.longitude);
        }
    }
    const durationMs = new Date(endPt.recordedAt).getTime() - new Date(startPt.recordedAt).getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    const avgSpeedKm = Math.round((speedSum / points.length) * 10) / 10;
    return {
        id: `trip-${trackerId}-${tripIndex}`,
        trackerId,
        startTime: startPt.recordedAt,
        endTime: endPt.recordedAt,
        startLocation: { lat: startPt.latitude, lng: startPt.longitude, address: `Origin (${startPt.latitude.toFixed(3)}, ${startPt.longitude.toFixed(3)})` },
        endLocation: { lat: endPt.latitude, lng: endPt.longitude, address: `Destination (${endPt.latitude.toFixed(3)}, ${endPt.longitude.toFixed(3)})` },
        distanceKm: Math.round(distanceKm * 100) / 100,
        durationMinutes,
        maxSpeedKm: Math.round(maxSpeedKm),
        avgSpeedKm,
        stopCount,
        points
    };
}
// GET /api/v1/trips/:trackerId
router.get('/:trackerId', auth_1.authenticateToken, (req, res) => {
    const trackerId = req.params.trackerId;
    const tracker = db_1.db.trackers.get(trackerId);
    if (!tracker || tracker.organizationId !== req.user.organizationId) {
        return res.status(404).json({ success: false, error: 'Tracker not found' });
    }
    const trips = detectTripsForTracker(trackerId);
    res.json({
        success: true,
        data: trips
    });
});
exports.default = router;
