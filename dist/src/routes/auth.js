"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── Zod Schemas ───────────────────────────────────────────────────────────────
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().min(1, 'Email is required').max(255),
    password: zod_1.z.string().min(1, 'Password is required').max(128)
});
// POST /api/v1/auth/login
router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
    }
    const { email, password } = parsed.data;
    // Find user by email or username prefix (e.g. "admin" → "admin@trackx.com")
    const user = Array.from(db_1.db.users.values()).find(u => u.email.toLowerCase() === email.toLowerCase() ||
        u.email.split('@')[0].toLowerCase() === email.toLowerCase());
    if (!user || !bcryptjs_1.default.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const token = (0, auth_1.generateToken)({
        id: user.id,
        email: user.email,
        organizationId: user.organizationId,
        role: user.role,
        name: user.name
    });
    const org = db_1.db.organizations.get(user.organizationId);
    res.json({
        success: true,
        data: {
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                organizationId: user.organizationId,
                organizationName: org?.name ?? 'Organization'
            }
        }
    });
});
// GET /api/v1/auth/me
router.get('/me', auth_1.authenticateToken, (req, res) => {
    const user = db_1.db.users.get(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    const org = db_1.db.organizations.get(user.organizationId);
    res.json({
        success: true,
        data: {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                organizationId: user.organizationId,
                organizationName: org?.name ?? 'Organization'
            }
        }
    });
});
exports.default = router;
