import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Geofence } from '../types/index.js';

const router = Router();

// ── Zod Schemas ───────────────────────────────────────────────────────────────
const circleCoordinatesSchema = z.object({
  center: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  radius: z.number().positive('Radius must be positive (meters)')
});

const polygonCoordinatesSchema = z.object({
  points: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })).min(3, 'Polygon must have at least 3 points')
});

const createGeofenceSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(255),
  type:        z.enum(['CIRCLE', 'POLYGON']),
  coordinates: z.union([circleCoordinatesSchema, polygonCoordinatesSchema]),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code (e.g. #3B82F6)').optional(),
  description: z.string().max(1000).optional()
});

// GET /api/v1/geofences
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const geofences = Array.from(db.geofences.values())
    .filter(g => g.organizationId === req.user!.organizationId);

  res.json({ success: true, data: geofences, total: geofences.length });
});

// POST /api/v1/geofences
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const parsed = createGeofenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    });
  }

  const { name, type, coordinates, color, description } = parsed.data;

  const id = `gf-${Date.now()}`;
  const newGeofence: Geofence = {
    id,
    organizationId: req.user!.organizationId,
    name,
    type,
    coordinates,
    color:       color ?? '#3B82F6',
    description,
    createdAt:   new Date().toISOString()
  };

  db.geofences.set(id, newGeofence);

  res.status(201).json({ success: true, data: newGeofence });
});

// DELETE /api/v1/geofences/:id
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const gf = db.geofences.get(id);
  if (!gf || gf.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ success: false, error: 'Geofence not found' });
  }

  db.geofences.delete(id);
  res.json({ success: true, message: 'Geofence deleted' });
});

export default router;
