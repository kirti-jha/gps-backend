import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

// Load .env FIRST — before any module that reads process.env (e.g. auth.ts)
dotenv.config();

import authRoutes from './routes/auth.js';
import trackerRoutes, { updateTrackerStatus } from './routes/trackers.js';
import locationRoutes from './routes/locations.js';
import historyRoutes from './routes/history.js';
import geofenceRoutes from './routes/geofences.js';
import alertRoutes from './routes/alerts.js';
import reportRoutes from './routes/reports.js';
import tripRoutes from './routes/trips.js';
import proximityRoutes from './routes/proximity.js';
import routeRoutes from './routes/route.js';
import { db } from './store/db.js';
import { initSocket } from './socket.js';

const app = express();
const server = http.createServer(app);

// ── Initialize Socket.IO (must be before routes) ─────────────────────────────
export const io = initSocket(server);

const PORT = process.env.PORT || 5000;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only allow explicitly configured origins — not the entire internet
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) ?? ['http://localhost:3000'];
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key']
}));

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

// ── Background Job: Tracker Status Polling ────────────────────────────────────
if (!process.env.VERCEL) {
  setInterval(() => {
    db.trackers.forEach(tracker => {
      const prevStatus = tracker.trackingStatus;
      updateTrackerStatus(tracker);
      if (prevStatus !== tracker.trackingStatus) {
        io.emit('tracker:status', {
          trackerId: tracker.id,
          trackerCode: tracker.trackerCode,
          status: tracker.trackingStatus,
          lastSeen: tracker.lastSeen
        });
      }
    });
  }, 10000);

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
