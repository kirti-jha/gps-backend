import { Router, Response } from 'express';
import { db } from '../store/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Tracker, TrackingStatus } from '../types/index.js';

const router = Router();

// Helper to refresh tracker status based on lastSeen timestamp
export function updateTrackerStatus(tracker: Tracker): Tracker {
  if (!tracker.lastSeen) {
    tracker.trackingStatus = 'OFFLINE';
    return tracker;
  }
  const lastSeenMs = new Date(tracker.lastSeen).getTime();
  const diffSec = (Date.now() - lastSeenMs) / 1000;

  if (diffSec < 30) {
    tracker.trackingStatus = 'ONLINE';
  } else if (diffSec <= 120) {
    tracker.trackingStatus = 'IDLE';
  } else {
    tracker.trackingStatus = 'OFFLINE';
  }
  return tracker;
}

// GET /api/v1/trackers
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const trackers = Array.from(db.trackers.values())
    .filter(t => t.organizationId === req.user!.organizationId)
    .map(updateTrackerStatus);

  res.json({
    success: true,
    data: trackers
  });
});

// GET /api/v1/trackers/:id
router.get('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  const trackerId = req.params.id as string;
  const tracker = db.trackers.get(trackerId);
  if (!tracker || tracker.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ success: false, error: 'Tracker not found' });
  }

  res.json({
    success: true,
    data: updateTrackerStatus(tracker)
  });
});

// POST /api/v1/trackers (Register a new tracker device)
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const { deviceName, platform } = req.body;

  if (!deviceName) {
    return res.status(400).json({ success: false, error: 'Device name is required' });
  }

  const trackerCode = `TRK-${Math.floor(100000 + Math.random() * 900000)}`;
  const id = `trk-${Date.now()}`;

  const newTracker: Tracker = {
    id,
    trackerCode,
    organizationId: req.user?.organizationId || 'org-abc-logistics',
    deviceName,
    platform: platform || 'iOS',
    batteryLevel: 100,
    trackingStatus: 'OFFLINE',
    lastLatitude: 28.6139, // Default initial center
    lastLongitude: 77.2090,
    lastSpeed: 0,
    lastHeading: 0,
    lastAccuracy: 10,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  db.trackers.set(id, newTracker);

  // Broadcast WebSocket event for real-time dashboard update
  try {
    const { io } = require('../index.js');
    if (io) io.emit('tracker:created', newTracker);
  } catch (err) {
    // Silent catch if io circular ref
  }

  res.status(201).json({
    success: true,
    data: newTracker
  });
});

export default router;
