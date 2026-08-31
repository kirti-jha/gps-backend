-- ====================================================================
-- TrackX / GeoTrack Production Database Schema (PostgreSQL + PostGIS)
-- ====================================================================

-- Enable PostGIS spatial extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organizations (Multi-Tenant Isolation)
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users & RBAC
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organization_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ORG_ADMIN', 'TRACKER_USER', 'VIEWER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Hardware Trackers / Mobile Devices
CREATE TABLE IF NOT EXISTS trackers (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tracker_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. TRK-928374
    organization_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    device_name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) DEFAULT 'Android',
    battery_level INT DEFAULT 100,
    tracking_status VARCHAR(50) DEFAULT 'OFFLINE' CHECK (tracking_status IN ('ONLINE', 'IDLE', 'OFFLINE')),
    last_latitude DOUBLE PRECISION,
    last_longitude DOUBLE PRECISION,
    last_speed DOUBLE PRECISION DEFAULT 0,
    last_heading DOUBLE PRECISION DEFAULT 0,
    last_accuracy DOUBLE PRECISION DEFAULT 10,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Historical Location Vector Data (PostGIS Geography)
CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    tracker_id VARCHAR(36) REFERENCES trackers(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL,
    speed DOUBLE PRECISION DEFAULT 0,
    heading DOUBLE PRECISION DEFAULT 0,
    altitude DOUBLE PRECISION DEFAULT 0,
    battery INT,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    location_geom GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED
);

-- Spatial & Composite Performance Indexes
CREATE INDEX IF NOT EXISTS idx_locations_tracker_recorded ON locations(tracker_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST(location_geom);

-- 5. Geofence Zones (Circle / Polygon)
CREATE TABLE IF NOT EXISTS geofences (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organization_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('CIRCLE', 'POLYGON')),
    coordinates JSONB NOT NULL,
    color VARCHAR(20) DEFAULT '#3B82F6',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Alerts & Geofence Breaches
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    organization_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE,
    tracker_id VARCHAR(36) REFERENCES trackers(id) ON DELETE CASCADE,
    tracker_code VARCHAR(50) NOT NULL,
    tracker_name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'OVERSPEED', 'LOW_BATTERY', 'OFFLINE')),
    message TEXT NOT NULL,
    metadata JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(organization_id, created_at DESC);

-- 7. Segmented Trips
CREATE TABLE IF NOT EXISTS trips (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    tracker_id VARCHAR(36) REFERENCES trackers(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    start_latitude DOUBLE PRECISION NOT NULL,
    start_longitude DOUBLE PRECISION NOT NULL,
    end_latitude DOUBLE PRECISION NOT NULL,
    end_longitude DOUBLE PRECISION NOT NULL,
    distance_km DOUBLE PRECISION NOT NULL,
    duration_minutes INT NOT NULL,
    max_speed_km DOUBLE PRECISION DEFAULT 0,
    avg_speed_km DOUBLE PRECISION DEFAULT 0,
    stop_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
