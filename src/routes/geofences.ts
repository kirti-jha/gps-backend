import { Router, Response } from 'express';
import { db } from '../store/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Geofence } from '../types/index.js';

const router = Router();

// GET /api/v1/geofences
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const geofences = Array.from(db.geofences.values())
    .filter(g => g.organizationId === req.user!.organizationId);

  res.json({
    success: true,
    data: geofences
  });
});

// POST /api/v1/geofences
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const { name, type, coordinates, color, description } = req.body;

  if (!name || !type || !coordinates) {
    return res.status(400).json({ success: false, error: 'Name, type, and coordinates are required' });
  }

  const id = `gf-${Date.now()}`;
  const newGeofence: Geofence = {
    id,
    organizationId: req.user!.organizationId,
    name,
    type,
    coordinates,
    color: color || '#3B82F6',
    description,
    createdAt: new Date().toISOString()
  };

  db.geofences.set(id, newGeofence);

  res.status(201).json({
    success: true,
    data: newGeofence
  });
});

// DELETE /api/v1/geofences/:id
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  const geofenceId = req.params.id as string;
  const gf = db.geofences.get(geofenceId);
  if (!gf || gf.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ success: false, error: 'Geofence not found' });
  }

  db.geofences.delete(geofenceId);

  res.json({
    success: true,
    message: 'Geofence deleted'
  });
});

export default router;
