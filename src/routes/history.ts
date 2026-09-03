import { Router, Response } from 'express';
import { db } from '../store/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { calculateDistanceKm } from '../utils/geo';

const router = Router();

// GET /api/v1/trackers/:id/history
router.get('/:id/history', authenticateToken, (req: AuthRequest, res: Response) => {
  const trackerId = req.params.id as string;
  const { startTime, endTime } = req.query;

  const tracker = db.trackers.get(trackerId);
  if (!tracker || tracker.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ success: false, error: 'Tracker not found' });
  }

  let points = db.locations.get(trackerId) || [];

  // Filter by time range if provided
  if (startTime) {
    const startMs = new Date(startTime as string).getTime();
    points = points.filter(p => new Date(p.recordedAt).getTime() >= startMs);
  }
  if (endTime) {
    const endMs = new Date(endTime as string).getTime();
    points = points.filter(p => new Date(p.recordedAt).getTime() <= endMs);
  }

  // Sort chronologically
  points.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  // Calculate Route Stats
  let totalDistanceKm = 0;
  let maxSpeed = 0;
  let speedSum = 0;
  let stopCount = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed > maxSpeed) maxSpeed = p.speed;
    speedSum += p.speed;
    if (p.speed === 0) stopCount++;

    if (i > 0) {
      const prev = points[i - 1];
      const dist = calculateDistanceKm(prev.latitude, prev.longitude, p.latitude, p.longitude);
      totalDistanceKm += dist;
    }
  }

  const durationMs = points.length > 1
    ? new Date(points[points.length - 1].recordedAt).getTime() - new Date(points[0].recordedAt).getTime()
    : 0;

  const durationMinutes = Math.round(durationMs / 60000);
  const avgSpeed = points.length > 0 ? Math.round((speedSum / points.length) * 10) / 10 : 0;

  res.json({
    success: true,
    data: {
      tracker: {
        id: tracker.id,
        trackerCode: tracker.trackerCode,
        deviceName: tracker.deviceName
      },
      stats: {
        totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
        durationMinutes,
        maxSpeedKm: Math.round(maxSpeed),
        avgSpeedKm: avgSpeed,
        pointCount: points.length,
        stopCount
      },
      points
    }
  });
});

// GET /api/v1/trackers/:id/at-time ("Where was this person at X time?")
router.get('/:id/at-time', authenticateToken, (req: AuthRequest, res: Response) => {
  const trackerId = req.params.id as string;
  const { time } = req.query;

  if (!time) {
    return res.status(400).json({ success: false, error: 'Target time parameter is required' });
  }

  const tracker = db.trackers.get(trackerId);
  if (!tracker || tracker.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ success: false, error: 'Tracker not found' });
  }

  const points = db.locations.get(trackerId) || [];
  if (points.length === 0) {
    return res.status(404).json({ success: false, error: 'No location records found for this tracker' });
  }

  const targetMs = new Date(time as string).getTime();

  // Find nearest location point chronologically
  let closestPoint = points[0];
  let minDiff = Math.abs(new Date(points[0].recordedAt).getTime() - targetMs);

  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(new Date(points[i].recordedAt).getTime() - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestPoint = points[i];
    }
  }

  res.json({
    success: true,
    data: {
      targetTime: new Date(time as string).toISOString(),
      closestPoint,
      timeDifferenceSeconds: Math.round(minDiff / 1000)
    }
  });
});

export default router;
