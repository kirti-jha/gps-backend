"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.ALERT_COOLDOWNS = void 0;
exports.generateDeviceApiKey = generateDeviceApiKey;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── File Persistence Configuration ──────────────────────────────────────────
const DATA_DIR = process.env.VERCEL ? '/tmp' : path_1.default.join(process.cwd(), 'data');
const STORAGE_FILE = path_1.default.join(DATA_DIR, 'storage.json');
// ─── Alert Deduplication Cooldowns (ms) ────────────────────────────────────
exports.ALERT_COOLDOWNS = {
    OVERSPEED: 5 * 60 * 1000, // 5 minutes
    LOW_BATTERY: 30 * 60 * 1000, // 30 minutes
    GEOFENCE_ENTER: 2 * 60 * 1000, // 2 minutes
    GEOFENCE_EXIT: 2 * 60 * 1000, // 2 minutes
    OFFLINE: 10 * 60 * 1000 // 10 minutes
};
// ─── API Key Generator ───────────────────────────────────────────────────────
function generateDeviceApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'trk_';
    for (let i = 0; i < 32; i++) {
        key += chars[Math.floor(Math.random() * chars.length)];
    }
    return key;
}
// ─── Persistent Database Store ───────────────────────────────────────────────
class MemoryStore {
    organizations = new Map();
    users = new Map();
    trackers = new Map();
    locations = new Map(); // trackerId → array of points
    geofences = new Map();
    alerts = [];
    trips = new Map();
    // Alert deduplication: trackerId → alertType → last alert timestamp (ms)
    lastAlertTime = new Map();
    constructor() {
        this.seedInitialData();
        this.loadFromDisk();
    }
    // ── Persistence Helpers ───────────────────────────────────────────────────
    saveToDisk() {
        try {
            if (!fs_1.default.existsSync(DATA_DIR)) {
                fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
            }
            const serialized = {
                trackers: Array.from(this.trackers.entries()),
                locations: Array.from(this.locations.entries()),
                geofences: Array.from(this.geofences.entries()),
                alerts: this.alerts,
                trips: Array.from(this.trips.entries())
            };
            fs_1.default.writeFileSync(STORAGE_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[DB Store] Error saving data to disk:', err.message);
        }
    }
    loadFromDisk() {
        try {
            if (fs_1.default.existsSync(STORAGE_FILE)) {
                const raw = fs_1.default.readFileSync(STORAGE_FILE, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data.trackers)) {
                    data.trackers.forEach(([id, tracker]) => {
                        this.trackers.set(id, tracker);
                    });
                }
                if (Array.isArray(data.locations)) {
                    data.locations.forEach(([id, points]) => {
                        this.locations.set(id, points);
                    });
                }
                if (Array.isArray(data.geofences)) {
                    data.geofences.forEach(([id, gf]) => {
                        this.geofences.set(id, gf);
                    });
                }
                if (Array.isArray(data.alerts)) {
                    this.alerts = data.alerts;
                }
                if (Array.isArray(data.trips)) {
                    data.trips.forEach(([id, tripList]) => {
                        this.trips.set(id, tripList);
                    });
                }
                console.log(`[DB Store] Loaded ${this.trackers.size} saved devices & history from disk storage`);
            }
        }
        catch (err) {
            console.error('[DB Store] Error loading data from disk:', err.message);
        }
    }
    // ── Alert Dedup Helpers ───────────────────────────────────────────────────
    canCreateAlert(trackerId, alertType) {
        const trackerAlerts = this.lastAlertTime.get(trackerId);
        if (!trackerAlerts)
            return true;
        const lastTime = trackerAlerts.get(alertType) || 0;
        const cooldown = exports.ALERT_COOLDOWNS[alertType] ?? 5 * 60 * 1000;
        return (Date.now() - lastTime) > cooldown;
    }
    recordAlertTime(trackerId, alertType) {
        const trackerAlerts = this.lastAlertTime.get(trackerId) ?? new Map();
        trackerAlerts.set(alertType, Date.now());
        this.lastAlertTime.set(trackerId, trackerAlerts);
    }
    // ── Seed Data ─────────────────────────────────────────────────────────────
    seedInitialData() {
        const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
        const kirtiPassword = process.env.SEED_KIRTI_PASSWORD ?? '836855';
        const orgId = 'org-abc-logistics';
        const org = {
            id: orgId,
            name: 'ABC Logistics Pvt Ltd',
            code: 'ABC-LOGISTICS',
            createdAt: new Date().toISOString()
        };
        this.organizations.set(orgId, org);
        const adminHash = adminPassword === 'admin123'
            ? '$2a$10$hzT6BBfZfjhox0EcQ2B1A.WvVV9PDuXvdtGd6SBle3BEaN2U0wJ1i'
            : bcryptjs_1.default.hashSync(adminPassword, 10);
        const kirtiHash = kirtiPassword === '836855'
            ? '$2a$10$l0BpDVJVidjGCJrCK4ySsudk2s5rpJSSmtw.5TAd86ij.ndvC3XKy'
            : bcryptjs_1.default.hashSync(kirtiPassword, 10);
        const kirtiUser = {
            id: 'usr-kirti-1',
            organizationId: orgId,
            email: 'kirti@trackx.com',
            name: 'Kirti Jha (Admin)',
            role: 'ORG_ADMIN',
            passwordHash: kirtiHash,
            createdAt: new Date().toISOString()
        };
        this.users.set(kirtiUser.id, kirtiUser);
        const adminUser = {
            id: 'usr-admin-1',
            organizationId: orgId,
            email: 'admin@trackx.com',
            name: 'Rahul Sharma (Admin)',
            role: 'ORG_ADMIN',
            passwordHash: adminHash,
            createdAt: new Date().toISOString()
        };
        this.users.set(adminUser.id, adminUser);
        const trackerUser = {
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
exports.db = new MemoryStore();
