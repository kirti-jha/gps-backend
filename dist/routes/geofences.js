"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── Zod Schemas ───────────────────────────────────────────────────────────────
const circleCoordinatesSchema = zod_1.z.object({
    center: zod_1.z.object({
        lat: zod_1.z.number().min(-90).max(90),
        lng: zod_1.z.number().min(-180).max(180)
    }),
    radius: zod_1.z.number().positive('Radius must be positive (meters)')
});
const polygonCoordinatesSchema = zod_1.z.object({
    points: zod_1.z.array(zod_1.z.object({
        lat: zod_1.z.number().min(-90).max(90),
        lng: zod_1.z.number().min(-180).max(180)
    })).min(3, 'Polygon must have at least 3 points')
});
const createGeofenceSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Name is required').max(255),
    type: zod_1.z.enum(['CIRCLE', 'POLYGON']),
    coordinates: zod_1.z.union([circleCoordinatesSchema, polygonCoordinatesSchema]),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code (e.g. #3B82F6)').optional(),
    description: zod_1.z.string().max(1000).optional()
});
// GET /api/v1/geofences
router.get('/', auth_1.authenticateToken, (req, res) => {
    const geofences = Array.from(db_1.db.geofences.values())
        .filter(g => g.organizationId === req.user.organizationId);
    res.json({ success: true, data: geofences, total: geofences.length });
});
// POST /api/v1/geofences
router.post('/', auth_1.authenticateToken, (req, res) => {
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
    const newGeofence = {
        id,
        organizationId: req.user.organizationId,
        name,
        type,
        coordinates,
        color: color ?? '#3B82F6',
        description,
        createdAt: new Date().toISOString()
    };
    db_1.db.geofences.set(id, newGeofence);
    res.status(201).json({ success: true, data: newGeofence });
});
// DELETE /api/v1/geofences/:id
router.delete('/:id', auth_1.authenticateToken, (req, res) => {
    const id = req.params.id;
    const gf = db_1.db.geofences.get(id);
    if (!gf || gf.organizationId !== req.user.organizationId) {
        return res.status(404).json({ success: false, error: 'Geofence not found' });
    }
    db_1.db.geofences.delete(id);
    res.json({ success: true, message: 'Geofence deleted' });
});
exports.default = router;
