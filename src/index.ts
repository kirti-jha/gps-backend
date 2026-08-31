import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import trackerRoutes, { updateTrackerStatus } from './routes/trackers.js';
import locationRoutes from './routes/locations.js';
import historyRoutes from './routes/history.js';
import geofenceRoutes from './routes/geofences.js';
import alertRoutes from './routes/alerts.js';
import reportRoutes from './routes/reports.js';
import tripRoutes from './routes/trips.js';
import { db } from './store/db.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

export const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/trackers', trackerRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/trackers', historyRoutes);
app.use('/api/v1/geofences', geofenceRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/trips', tripRoutes);

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'TrackX Real-Time Location Engine',
    timestamp: new Date().toISOString(),
    trackersCount: db.trackers.size
  });
});

// Root route for Vercel landing check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'TrackX Real-Time Location Engine API',
    endpoints: {
      health: '/api/v1/health',
      trackers: '/api/v1/trackers',
      locations: '/api/v1/locations'
    }
  });
});

// Socket.IO connection handler
io.on('connection', socket => {
  console.log(`[WebSocket] Dashboard Client connected: ${socket.id}`);

  // Send current trackers state on connect
  const currentTrackers = Array.from(db.trackers.values()).map(updateTrackerStatus);
  socket.emit('trackers:init', currentTrackers);

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

// Background job: Periodically check and update online/idle/offline statuses
if (!process.env.VERCEL) {
  setInterval(() => {
    let changed = false;
    db.trackers.forEach(tracker => {
      const prevStatus = tracker.trackingStatus;
      updateTrackerStatus(tracker);
      if (prevStatus !== tracker.trackingStatus) {
        changed = true;
        if (io) {
          io.emit('tracker:status', {
            trackerId: tracker.id,
            trackerCode: tracker.trackerCode,
            status: tracker.trackingStatus,
            lastSeen: tracker.lastSeen
          });
        }
      }
    });
  }, 10000);

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 TrackX GPS Platform Backend running on port ${PORT}`);
    console.log(`📍 Ingestion API: http://localhost:${PORT}/api/v1/locations`);
    console.log(`⚡ WebSocket Engine initialized & listening`);
    console.log(`====================================================`);
  });
}

export default app;
