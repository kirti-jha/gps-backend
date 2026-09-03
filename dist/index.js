"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// Load .env FIRST — before any module that reads process.env (e.g. auth.ts)
dotenv_1.default.config();
const auth_1 = __importDefault(require("./routes/auth"));
const trackers_1 = __importStar(require("./routes/trackers"));
const locations_1 = __importDefault(require("./routes/locations"));
const history_1 = __importDefault(require("./routes/history"));
const geofences_1 = __importDefault(require("./routes/geofences"));
const alerts_1 = __importDefault(require("./routes/alerts"));
const reports_1 = __importDefault(require("./routes/reports"));
const trips_1 = __importDefault(require("./routes/trips"));
const proximity_1 = __importDefault(require("./routes/proximity"));
const route_1 = __importDefault(require("./routes/route"));
const db_1 = require("./store/db");
const socket_1 = require("./socket");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
// ── Initialize Socket.IO (must be before routes) ─────────────────────────────
exports.io = !process.env.VERCEL ? (0, socket_1.initSocket)(server) : null;
const PORT = process.env.PORT || 5000;
// ── CORS ─────────────────────────────────────────────────────────────────────
// Allows explicitly configured origins + any local development port (localhost/127.0.0.1)
const configuredOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) || ['http://localhost:3000', 'http://localhost:3001'];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow non-browser clients (Postman, mobile apps, curl)
        if (!origin)
            return callback(null, true);
        // Allow matching origins, any localhost/127.0.0.1 port, or any *.vercel.app deployment
        if (configuredOrigins.includes(origin) ||
            /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin) ||
            /\.vercel\.app$/.test(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key'],
    credentials: true
}));
// ── Body Parser ───────────────────────────────────────────────────────────────
app.use(express_1.default.json({ limit: '1mb' }));
// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Auth endpoints: max 10 attempts per minute per IP (brute-force protection)
const authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many login attempts. Please wait 1 minute.' }
});
// Location ingestion: max 120 requests per minute per IP
// (1 request every 0.5s — more than enough for any real device)
const locationRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Location ingestion rate limit exceeded.' }
});
// General API: max 300 requests per minute per IP
const generalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please slow down.' }
});
// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRateLimiter, auth_1.default);
app.use('/api/v1/locations', locationRateLimiter, locations_1.default);
app.use('/api/v1/trackers', generalRateLimiter, trackers_1.default);
app.use('/api/v1/trackers', generalRateLimiter, history_1.default);
app.use('/api/v1/geofences', generalRateLimiter, geofences_1.default);
app.use('/api/v1/alerts', generalRateLimiter, alerts_1.default);
app.use('/api/v1/reports', generalRateLimiter, reports_1.default);
app.use('/api/v1/trips', generalRateLimiter, trips_1.default);
app.use('/api/v1/proximity', generalRateLimiter, proximity_1.default);
app.use('/api/v1/route', generalRateLimiter, route_1.default);
// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'TrackX Real-Time Location Engine',
        timestamp: new Date().toISOString(),
        trackersCount: db_1.db.trackers.size,
        alertsCount: db_1.db.alerts.length
    });
});
// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        service: 'TrackX Real-Time Location Engine API',
        version: '1.0.0',
        endpoints: {
            health: '/api/v1/health',
            trackers: '/api/v1/trackers',
            locations: '/api/v1/locations',
            proximity: '/api/v1/proximity',
            route: '/api/v1/route'
        }
    });
});
// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});
// ── Global Error Handler ──────────────────────────────────────────────────────
// Catches any unhandled errors from route handlers.
// NEVER exposes stack traces — logs them server-side only.
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.path} —`, err.message);
    if (process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
});
// ── Socket.IO Connection Handler ──────────────────────────────────────────────
if (exports.io) {
    exports.io.on('connection', socket => {
        console.log(`[WebSocket] Dashboard Client connected: ${socket.id}`);
        // Send current trackers state on connect
        const currentTrackers = Array.from(db_1.db.trackers.values()).map(t => {
            const { apiKey, ...safeTracker } = t; // Never expose apiKey to dashboard
            return (0, trackers_1.updateTrackerStatus)(safeTracker);
        });
        socket.emit('trackers:init', currentTrackers);
        socket.on('disconnect', () => {
            console.log(`[WebSocket] Client disconnected: ${socket.id}`);
        });
    });
}
// ── Background Job & Standalone Server ────────────────────────────────────────
const isServerless = Boolean(process.env.VERCEL ||
    process.env.NOW_REGION ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.VERCEL_ENV ||
    process.env.AWS_EXECUTION_ENV);
if (!isServerless && process.env.NODE_ENV !== 'production') {
    if (exports.io) {
        setInterval(() => {
            db_1.db.trackers.forEach(tracker => {
                const prevStatus = tracker.trackingStatus;
                (0, trackers_1.updateTrackerStatus)(tracker);
                if (prevStatus !== tracker.trackingStatus && exports.io) {
                    exports.io.emit('tracker:status', {
                        trackerId: tracker.id,
                        trackerCode: tracker.trackerCode,
                        status: tracker.trackingStatus,
                        lastSeen: tracker.lastSeen
                    });
                }
            });
        }, 10000);
    }
    server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🚀 TrackX GPS Platform Backend running on port ${PORT}`);
        console.log(`📍 Ingestion API: http://localhost:${PORT}/api/v1/locations`);
        console.log(`⚡ WebSocket Engine initialized & listening`);
        console.log(`🔒 Security: JWT guard ✓  Rate limiting ✓  CORS ✓`);
        console.log(`====================================================`);
    });
}
exports.default = app;
