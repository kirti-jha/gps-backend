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

// In-Memory Database Store
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
      name: 'Driver Asset',
      role: 'TRACKER_USER',
      passwordHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(trackerUser.id, trackerUser);

    // Clean initial state for live hardware testing:
    // No mock trackers, no mock route history, no mock geofences, no mock alerts.
  }
}

export const db = new MemoryStore();
