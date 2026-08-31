import bcrypt from 'bcryptjs';
import {
  User,
  Organization,
  Tracker,
  LocationPoint,
  Geofence,
  Alert,
  Trip
} from '../types/index.js';
import { calculateDistanceKm } from '../utils/geo.js';

// In-Memory Database Store with pre-seeded demo data
class MemoryStore {
  organizations: Map<string, Organization> = new Map();
  users: Map<string, User> = new Map();
  trackers: Map<string, Tracker> = new Map();
  locations: Map<string, LocationPoint[]> = new Map(); // trackerId -> array of points
  geofences: Map<string, Geofence> = new Map();
  alerts: Alert[] = [];
  trips: Map<string, Trip[]> = new Map();

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    const orgId = 'org-abc-logistics';
    const org: Organization = {
      id: orgId,
      name: 'ABC Logistics Pvt Ltd',
      code: 'ABC-LOGISTICS',
      createdAt: new Date().toISOString()
    };
    this.organizations.set(orgId, org);

    const passwordHash = bcrypt.hashSync('admin123', 10);
    const kirtiPasswordHash = bcrypt.hashSync('836855', 10);

    const kirtiUser: User = {
      id: 'usr-kirti-1',
      organizationId: orgId,
      email: 'kirti@trackx.com',
      name: 'Kirti Jha (Admin)',
      role: 'ORG_ADMIN',
      passwordHash: kirtiPasswordHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(kirtiUser.id, kirtiUser);

    const adminUser: User = {
      id: 'usr-admin-1',
      organizationId: orgId,
      email: 'admin@trackx.com',
      name: 'Rahul Sharma (Admin)',
      role: 'ORG_ADMIN',
      passwordHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(adminUser.id, adminUser);

    const trackerUser: User = {
      id: 'usr-driver-1',
      organizationId: orgId,
      email: 'driver@trackx.com',
      name: 'Amit Kumar (Driver)',
      role: 'TRACKER_USER',
      passwordHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(trackerUser.id, trackerUser);

    // Initial Trackers
    const now = new Date();
    const demoTrackers: Tracker[] = [
      {
        id: 'trk-101',
        trackerCode: 'TRK-928374',
        organizationId: orgId,
        userId: 'usr-driver-1',
        deviceName: 'Samsung Galaxy S24 (Rahul - Delivery Van)',
        platform: 'Android',
        batteryLevel: 84,
        trackingStatus: 'ONLINE',
        lastLatitude: 28.6139,
        lastLongitude: 77.2090,
        lastSpeed: 42.5,
        lastHeading: 140,
        lastAccuracy: 6,
        lastSeen: new Date(now.getTime() - 2000).toISOString(),
        createdAt: new Date().toISOString()
      },
      {
        id: 'trk-102',
        trackerCode: 'TRK-104928',
        organizationId: orgId,
        deviceName: 'iPhone 15 Pro (Amit - Cargo Express)',
        platform: 'iOS',
        batteryLevel: 68,
        trackingStatus: 'ONLINE',
        lastLatitude: 28.5355,
        lastLongitude: 77.3910,
        lastSpeed: 58.2,
        lastHeading: 85,
        lastAccuracy: 8,
        lastSeen: new Date(now.getTime() - 5000).toISOString(),
        createdAt: new Date().toISOString()
      },
      {
        id: 'trk-103',
        trackerCode: 'TRK-394821',
        organizationId: orgId,
        deviceName: 'Pixel 8 (Priya - City Courier)',
        platform: 'Android',
        batteryLevel: 19, // Low battery trigger
        trackingStatus: 'IDLE',
        lastLatitude: 28.7041,
        lastLongitude: 77.1025,
        lastSpeed: 0,
        lastHeading: 0,
        lastAccuracy: 12,
        lastSeen: new Date(now.getTime() - 45000).toISOString(),
        createdAt: new Date().toISOString()
      },
      {
        id: 'trk-104',
        trackerCode: 'TRK-882319',
        organizationId: orgId,
        deviceName: 'OnePlus 12 (Ravi - Logistics Heavy Truck)',
        platform: 'Android',
        batteryLevel: 45,
        trackingStatus: 'OFFLINE',
        lastLatitude: 28.4595,
        lastLongitude: 77.0266,
        lastSpeed: 0,
        lastHeading: 0,
        lastAccuracy: 15,
        lastSeen: new Date(now.getTime() - 300000).toISOString(),
        createdAt: new Date().toISOString()
      }
    ];

    demoTrackers.forEach(t => this.trackers.set(t.id, t));

    // Seed Route History for TRK-928374 (Rahul - Delivery Van)
    const historyPoints: LocationPoint[] = [];
    const baseTime = new Date(now.getTime() - 3600000 * 4); // 4 hours ago
    const startLat = 28.5355;
    const startLng = 77.3910;
    const endLat = 28.6139;
    const endLng = 77.2090;

    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const pointTime = new Date(baseTime.getTime() + progress * 3600000 * 3.5);
      const lat = startLat + (endLat - startLat) * progress + (Math.random() - 0.5) * 0.005;
      const lng = startLng + (endLng - startLng) * progress + (Math.random() - 0.5) * 0.005;
      const speed = i === 0 || i === steps ? 0 : Math.floor(30 + Math.random() * 35);

      historyPoints.push({
        id: `loc-${i}`,
        trackerId: 'trk-101',
        latitude: lat,
        longitude: lng,
        accuracy: 6 + Math.floor(Math.random() * 4),
        speed,
        heading: Math.floor(progress * 180),
        altitude: 210 + Math.floor(Math.random() * 15),
        battery: Math.floor(95 - progress * 15),
        recordedAt: pointTime.toISOString(),
        createdAt: pointTime.toISOString()
      });
    }
    this.locations.set('trk-101', historyPoints);

    // Initial Geofences
    const demoGeofences: Geofence[] = [
      {
        id: 'gf-1',
        organizationId: orgId,
        name: 'Delhi Connaught Place Hub',
        type: 'CIRCLE',
        coordinates: {
          center: { lat: 28.6315, lng: 77.2167 },
          radius: 1200 // meters
        },
        color: '#10B981',
        description: 'Central Delhi Operations & Sorting Office',
        createdAt: new Date().toISOString()
      },
      {
        id: 'gf-2',
        organizationId: orgId,
        name: 'Noida Sector 62 Warehouse',
        type: 'POLYGON',
        coordinates: {
          points: [
            { lat: 28.625, lng: 77.365 },
            { lat: 28.635, lng: 77.365 },
            { lat: 28.635, lng: 77.380 },
            { lat: 28.625, lng: 77.380 }
          ]
        },
        color: '#3B82F6',
        description: 'Primary Logistics Depot & Cargo Loading Station',
        createdAt: new Date().toISOString()
      }
    ];
    demoGeofences.forEach(g => this.geofences.set(g.id, g));

    // Initial Alerts
    this.alerts = [
      {
        id: 'alt-1',
        organizationId: orgId,
        trackerId: 'trk-103',
        trackerCode: 'TRK-394821',
        trackerName: 'Priya - City Courier',
        type: 'LOW_BATTERY',
        message: 'Device battery dropped below 20% (Currently 19%)',
        isRead: false,
        createdAt: new Date(now.getTime() - 120000).toISOString()
      },
      {
        id: 'alt-2',
        organizationId: orgId,
        trackerId: 'trk-102',
        trackerCode: 'TRK-104928',
        trackerName: 'Amit - Cargo Express',
        type: 'GEOFENCE_ENTER',
        message: 'Entered Noida Sector 62 Warehouse geofence zone',
        isRead: true,
        createdAt: new Date(now.getTime() - 600000).toISOString()
      }
    ];
  }
}

export const db = new MemoryStore();
