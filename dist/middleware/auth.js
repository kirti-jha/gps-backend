"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.generateToken = generateToken;
exports.authenticateToken = authenticateToken;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env early — auth.ts may be imported before index.ts calls dotenv.config()
dotenv_1.default.config();
// ── JWT Secret Guard ──────────────────────────────────────────────────────────
exports.JWT_SECRET = process.env.JWT_SECRET || 'trackx_secure_production_jwt_secret_key_836855_admin_key_2026';
function generateToken(payload) {
    return jsonwebtoken_1.default.sign(payload, exports.JWT_SECRET, { expiresIn: '7d' });
}
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
}
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        }
        next();
    };
}
