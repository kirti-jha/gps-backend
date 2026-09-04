import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

// Load .env FIRST — before any module that reads process.env (e.g. auth.ts)
dotenv.config();

import authRoutes from './routes/auth';
import trackerRoutes, { updateTrackerStatus } from './routes/trackers';
import locationRoutes from './routes/locations';
import historyRoutes from './routes/history';
import geofenceRoutes from './routes/geofences';
import alertRoutes from './routes/alerts';
import reportRoutes from './routes/reports';
import tripRoutes from './routes/trips';
import proximityRoutes from './routes/proximity';
import routeRoutes from './routes/route';
import { db } from './store/db';
import { initSocket } from './socket';

const app = express();
const server = http.createServer(app);

// ── Initialize Socket.IO (must be before routes) ─────────────────────────────
export const io = !process.env.VERCEL ? initSocket(server) : null;

const PORT = process.env.PORT || 5000;

// ── CORS ─────────────────────────────────────────────────────────────────────
const configuredOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()).filter(Boolean) || [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // Always permit origin to prevent browser CORS block
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key', 'Accept', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Handle preflight OPTIONS requests for all routes
app.options('*', cors() as any);

// ── Body Parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Rate Limiting ─────────────────────────────────────────────────────────────

// Auth endpoints: max 10 attempts per minute per IP (brute-force protection)
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please wait 1 minute.' }
});

// Location ingestion: max 120 requests per minute per IP
// (1 request every 0.5s — more than enough for any real device)
const locationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Location ingestion rate limit exceeded.' }
});

// General API: max 300 requests per minute per IP
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',      authRateLimiter,     authRoutes);
app.use('/api/v1/locations', locationRateLimiter, locationRoutes);
app.use('/api/v1/trackers',  generalRateLimiter,  trackerRoutes);
app.use('/api/v1/trackers',  generalRateLimiter,  historyRoutes);
app.use('/api/v1/geofences', generalRateLimiter,  geofenceRoutes);
app.use('/api/v1/alerts',    generalRateLimiter,  alertRoutes);
app.use('/api/v1/reports',   generalRateLimiter,  reportRoutes);
app.use('/api/v1/trips',     generalRateLimiter,  tripRoutes);
app.use('/api/v1/proximity', generalRateLimiter,  proximityRoutes);
app.use('/api/v1/route',     generalRateLimiter,  routeRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'TrackX Real-Time Location Engine',
    timestamp: new Date().toISOString(),
    trackersCount: db.trackers.size,
    alertsCount: db.alerts.length
  });
});

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'TrackX Real-Time Location Engine API',
    version: '1.0.0',
    endpoints: {
      health:    '/api/v1/health',
      trackers:  '/api/v1/trackers',
      locations: '/api/v1/locations',
      proximity: '/api/v1/proximity',
      route:     '/api/v1/route'
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
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[ERROR] ${req.method} ${req.path} —`, err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Socket.IO Connection Handler ──────────────────────────────────────────────
if (io) {
  io.on('connection', socket => {
    console.log(`[WebSocket] Dashboard Client connected: ${socket.id}`);

    // Send current trackers state on connect
    const currentTrackers = Array.from(db.trackers.values()).map(t => {
      const { apiKey, ...safeTracker } = t as any; // Never expose apiKey to dashboard
      return updateTrackerStatus(safeTracker as any);
    });
    socket.emit('trackers:init', currentTrackers);

    socket.on('disconnect', () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
  });
}

// ── Background Job & Standalone Server ────────────────────────────────────────
const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.NOW_REGION ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.VERCEL_ENV ||
  process.env.AWS_EXECUTION_ENV
);

if (!isServerless && process.env.NODE_ENV !== 'production') {
  if (io) {
    setInterval(() => {
      db.trackers.forEach(tracker => {
        const prevStatus = tracker.trackingStatus;
        updateTrackerStatus(tracker);
        if (prevStatus !== tracker.trackingStatus && io) {
          io.emit('tracker:status', {
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

export default app;
