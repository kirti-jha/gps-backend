import { Router, Response } from 'express';
import { db } from '../store/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { calculateDistanceKm } from '../utils/geo';
import { updateTrackerStatus } from './trackers';

const router = Router();

// GET /api/v1/reports/summary
router.get('/summary', authenticateToken, (req: AuthRequest, res: Response) => {
  const trackers = Array.from(db.trackers.values())
    .filter(t => t.organizationId === req.user!.organizationId)
    .map(updateTrackerStatus);

  const totalTrackers = trackers.length;
  const onlineCount = trackers.filter(t => t.trackingStatus === 'ONLINE').length;
  const idleCount = trackers.filter(t => t.trackingStatus === 'IDLE').length;
  const offlineCount = trackers.filter(t => t.trackingStatus === 'OFFLINE').length;
  const movingCount = trackers.filter(t => t.trackingStatus === 'ONLINE' && t.lastSpeed > 5).length;
  const stoppedCount = totalTrackers - movingCount;

  // Total Fleet Distance Today
  let fleetDistanceTodayKm = 0;
  trackers.forEach(t => {
    const points = db.locations.get(t.id) || [];
    for (let i = 1; i < points.length; i++) {
      fleetDistanceTodayKm += calculateDistanceKm(
        points[i - 1].latitude,
        points[i - 1].longitude,
        points[i].latitude,
        points[i].longitude
      );
    }
  });

  const alerts = db.alerts.filter(a => a.organizationId === req.user!.organizationId);
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
      totalGeofences: db.geofences.size
    }
  });
});

export default router;
