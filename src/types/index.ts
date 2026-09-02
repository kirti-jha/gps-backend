export type UserRole = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'TRACKER_USER' | 'VIEWER';

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export type TrackingStatus = 'ONLINE' | 'IDLE' | 'OFFLINE';

export interface Tracker {
  id: string;
  trackerCode: string; // e.g. TRK-928374
  organizationId: string;
  userId?: string;
  deviceName: string;
  platform: 'Android' | 'iOS' | 'Web Simulator';
  batteryLevel: number;
  trackingStatus: TrackingStatus;
  lastLatitude: number;
  lastLongitude: number;
  lastSpeed: number; // km/h
  lastHeading: number; // 0-360 degrees
  lastAccuracy: number; // meters
  lastSeen: string;
  apiKey: string; // Secret key for device-level location ingestion auth
  createdAt: string;
}

export interface LocationPoint {
  id: string;
  trackerId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number; // km/h
  heading: number;
  altitude: number;
  battery: number;
  recordedAt: string;
  createdAt: string;
}

export type GeofenceType = 'CIRCLE' | 'POLYGON';

export interface CircleGeofence {
  center: { lat: number; lng: number };
  radius: number; // in meters
}

export interface PolygonGeofence {
  points: { lat: number; lng: number }[];
}

export interface Geofence {
  id: string;
  organizationId: string;
  name: string;
  type: GeofenceType;
  coordinates: CircleGeofence | PolygonGeofence;
  color: string;
  description?: string;
  createdAt: string;
}

export type AlertType = 'GEOFENCE_ENTER' | 'GEOFENCE_EXIT' | 'OVERSPEED' | 'LOW_BATTERY' | 'OFFLINE';

export interface Alert {
  id: string;
  organizationId: string;
  trackerId: string;
  trackerCode: string;
  trackerName: string;
  type: AlertType;
  message: string;
  metadata?: any;
  isRead: boolean;
  createdAt: string;
}

export interface Trip {
  id: string;
  trackerId: string;
  startTime: string;
  endTime: string;
  startLocation: { lat: number; lng: number; address?: string };
  endLocation: { lat: number; lng: number; address?: string };
  distanceKm: number;
  durationMinutes: number;
  maxSpeedKm: number;
  avgSpeedKm: number;
  stopCount: number;
  points?: LocationPoint[];
}
