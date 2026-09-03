import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import {
  User,
  Organization,
  Tracker,
  LocationPoint,
  Geofence,
  Alert,
  Trip
} from '../types/index.js';

// ─── File Persistence Configuration ──────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'storage.json');

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

// ─── Persistent Database Store ───────────────────────────────────────────────
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
    this.loadFromDisk();
  }

  // ── Persistence Helpers ───────────────────────────────────────────────────
  public saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const serialized = {
        trackers: Array.from(this.trackers.entries()),
        locations: Array.from(this.locations.entries()),
        geofences: Array.from(this.geofences.entries()),
        alerts: this.alerts,
        trips: Array.from(this.trips.entries())
      };

      fs.writeFileSync(STORAGE_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[DB Store] Error saving data to disk:', err.message);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
        const data = JSON.parse(raw);

        if (Array.isArray(data.trackers)) {
          data.trackers.forEach(([id, tracker]: [string, Tracker]) => {
            this.trackers.set(id, tracker);
          });
        }
        if (Array.isArray(data.locations)) {
          data.locations.forEach(([id, points]: [string, LocationPoint[]]) => {
            this.locations.set(id, points);
          });
        }
        if (Array.isArray(data.geofences)) {
          data.geofences.forEach(([id, gf]: [string, Geofence]) => {
            this.geofences.set(id, gf);
          });
        }
        if (Array.isArray(data.alerts)) {
          this.alerts = data.alerts;
        }
        if (Array.isArray(data.trips)) {
          data.trips.forEach(([id, tripList]: [string, Trip[]]) => {
            this.trips.set(id, tripList);
          });
        }

        console.log(`[DB Store] Loaded ${this.trackers.size} saved devices & history from disk storage`);
      }
    } catch (err: any) {
      console.error('[DB Store] Error loading data from disk:', err.message);
    }
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
    const adminPassword  = process.env.SEED_ADMIN_PASSWORD  ?? 'admin123';
    const kirtiPassword  = process.env.SEED_KIRTI_PASSWORD  ?? '836855';

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
  }
}

export const db = new MemoryStore();
