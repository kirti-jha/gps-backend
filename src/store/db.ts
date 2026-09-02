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

// ─── Alert Deduplication Cooldowns (ms) ────────────────────────────────────
export const ALERT_COOLDOWNS: Record<string, number> = {
  OVERSPEED:     5  * 60 * 1000, // 5 minutes
  LOW_BATTERY:   30 * 60 * 1000, // 30 minutes
  GEOFENCE_ENTER: 2 * 60 * 1000, // 2 minutes
  GEOFENCE_EXIT:  2 * 60 * 1000, // 2 minutes
  OFFLINE:       10 * 60 * 1000  // 10 minutes
};

// ─── API Key Generator ───────────────────────────────────────────────────────
export function generateDeviceApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'trk_';
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

// ─── In-Memory Database Store ────────────────────────────────────────────────
class MemoryStore {
  organizations: Map<string, Organization> = new Map();
  users:         Map<string, User>         = new Map();
  trackers:      Map<string, Tracker>      = new Map();
  locations:     Map<string, LocationPoint[]> = new Map(); // trackerId → array of points
  geofences:     Map<string, Geofence>     = new Map();
  alerts:        Alert[]                   = [];
  trips:         Map<string, Trip[]>       = new Map();

  // Alert deduplication: trackerId → alertType → last alert timestamp (ms)
  lastAlertTime: Map<string, Map<string, number>> = new Map();

  constructor() {
    this.seedInitialData();
  }

  // ── Alert Dedup Helpers ───────────────────────────────────────────────────
  canCreateAlert(trackerId: string, alertType: string): boolean {
    const trackerAlerts = this.lastAlertTime.get(trackerId);
    if (!trackerAlerts) return true;
    const lastTime = trackerAlerts.get(alertType) || 0;
    const cooldown = ALERT_COOLDOWNS[alertType] ?? 5 * 60 * 1000;
    return (Date.now() - lastTime) > cooldown;
  }

  recordAlertTime(trackerId: string, alertType: string): void {
    const trackerAlerts = this.lastAlertTime.get(trackerId) ?? new Map<string, number>();
    trackerAlerts.set(alertType, Date.now());
    this.lastAlertTime.set(trackerId, trackerAlerts);
  }

  // ── Seed Data ─────────────────────────────────────────────────────────────
  private seedInitialData() {
    // Read passwords from env — NEVER hardcode real passwords in source
    const adminPassword  = process.env.SEED_ADMIN_PASSWORD  ?? 'admin123';
    const kirtiPassword  = process.env.SEED_KIRTI_PASSWORD  ?? 'changeme123';

    const orgId = 'org-abc-logistics';
    const org: Organization = {
      id: orgId,
      name: 'ABC Logistics Pvt Ltd',
      code: 'ABC-LOGISTICS',
      createdAt: new Date().toISOString()
    };
    this.organizations.set(orgId, org);

    const adminHash = bcrypt.hashSync(adminPassword, 10);
    const kirtiHash = bcrypt.hashSync(kirtiPassword, 10);

    const kirtiUser: User = {
      id: 'usr-kirti-1',
      organizationId: orgId,
      email: 'kirti@trackx.com',
      name: 'Kirti Jha (Admin)',
      role: 'ORG_ADMIN',
      passwordHash: kirtiHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(kirtiUser.id, kirtiUser);

    const adminUser: User = {
      id: 'usr-admin-1',
      organizationId: orgId,
      email: 'admin@trackx.com',
      name: 'Rahul Sharma (Admin)',
      role: 'ORG_ADMIN',
      passwordHash: adminHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(adminUser.id, adminUser);

    const trackerUser: User = {
      id: 'usr-driver-1',
      organizationId: orgId,
      email: 'driver@trackx.com',
      name: 'Driver Asset',
      role: 'TRACKER_USER',
      passwordHash: adminHash,
      createdAt: new Date().toISOString()
    };
    this.users.set(trackerUser.id, trackerUser);

    // Clean initial state for live hardware testing:
    // No mock trackers, no mock route history, no mock geofences, no mock alerts.
  }
}

export const db = new MemoryStore();
