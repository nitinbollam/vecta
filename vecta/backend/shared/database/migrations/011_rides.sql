-- =============================================================================
-- 011_rides.sql — Peer rides marketplace (PostGIS matching, driver profiles)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Driver profiles (OPT/EAD/CPT/US citizens ONLY)
CREATE TABLE driver_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               UUID NOT NULL UNIQUE REFERENCES students(id),
  work_auth_type           TEXT NOT NULL CHECK (work_auth_type IN (
                             'OPT','CPT','EAD','US_CITIZEN','PERMANENT_RESIDENT')),
  work_auth_doc_url        TEXT NOT NULL,
  work_auth_expiry         DATE NOT NULL,
  license_number_enc       TEXT NOT NULL,
  license_state            TEXT NOT NULL,
  license_expiry           DATE NOT NULL,
  license_doc_url          TEXT NOT NULL,
  insurance_doc_url        TEXT NOT NULL,
  insurance_expiry         DATE NOT NULL,
  vehicle_vin              TEXT,
  vehicle_make             TEXT,
  vehicle_model            TEXT,
  vehicle_year             INT,
  vehicle_color            TEXT,
  vehicle_plate            TEXT,
  vehicle_capacity         INT NOT NULL DEFAULT 4,
  status                   TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                             CHECK (status IN (
                               'PENDING_REVIEW','APPROVED',
                               'SUSPENDED','REJECTED')),
  rating                   NUMERIC(3,2) DEFAULT 5.0,
  total_rides              INT DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_profiles_status ON driver_profiles (status);

-- Real-time driver location
CREATE TABLE driver_locations (
  driver_id    UUID PRIMARY KEY REFERENCES driver_profiles(id) ON DELETE CASCADE,
  lat          NUMERIC(10,7) NOT NULL,
  lng          NUMERIC(10,7) NOT NULL,
  heading      INT,
  is_online    BOOLEAN NOT NULL DEFAULT FALSE,
  location     GEOGRAPHY(POINT, 4326),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_location_geo ON driver_locations USING GIST (location);

CREATE OR REPLACE FUNCTION sync_driver_location()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326)::geography;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_driver_location
  BEFORE INSERT OR UPDATE ON driver_locations
  FOR EACH ROW EXECUTE FUNCTION sync_driver_location();

-- Rides table
CREATE TABLE rides (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_student_id         UUID NOT NULL REFERENCES students(id),
  driver_id                UUID REFERENCES driver_profiles(id),
  fleet_vehicle_id         UUID REFERENCES vehicle_leases(id),

  pickup_lat               NUMERIC(10,7) NOT NULL,
  pickup_lng               NUMERIC(10,7) NOT NULL,
  pickup_address           TEXT NOT NULL,
  dropoff_lat              NUMERIC(10,7) NOT NULL,
  dropoff_lng              NUMERIC(10,7) NOT NULL,
  dropoff_address          TEXT NOT NULL,

  estimated_miles          NUMERIC(6,2),
  actual_miles             NUMERIC(6,2),
  price_per_mile_cents     INT NOT NULL DEFAULT 100,
  estimated_fare_cents     INT,
  actual_fare_cents        INT,
  platform_fee_cents       INT,
  driver_payout_cents      INT,
  fleet_owner_payout_cents INT,

  status                   TEXT NOT NULL DEFAULT 'REQUESTED'
                             CHECK (status IN (
                               'REQUESTED','MATCHED','DRIVER_ACCEPTED',
                               'DRIVER_ARRIVING','IN_PROGRESS',
                               'COMPLETED','CANCELLED','NO_DRIVER_FOUND')),

  requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at               TIMESTAMPTZ,
  driver_accepted_at       TIMESTAMPTZ,
  pickup_at                TIMESTAMPTZ,
  dropoff_at               TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_reason            TEXT,

  rider_rating             INT CHECK (rider_rating BETWEEN 1 AND 5),
  driver_rating            INT CHECK (driver_rating BETWEEN 1 AND 5),
  rider_review             TEXT,
  driver_review            TEXT
);

CREATE INDEX idx_rides_rider ON rides (rider_student_id, requested_at DESC);
CREATE INDEX idx_rides_driver ON rides (driver_id, status);

-- Append-only ride audit log
CREATE TABLE ride_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id),
  event       TEXT NOT NULL,
  actor       TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ride_audit_ride ON ride_audit_log (ride_id, created_at DESC);

CREATE RULE no_update_ride_audit AS ON UPDATE TO ride_audit_log
  DO INSTEAD NOTHING;
CREATE RULE no_delete_ride_audit AS ON DELETE TO ride_audit_log
  DO INSTEAD NOTHING;

CREATE TABLE driver_push_tokens (
  driver_id    UUID PRIMARY KEY REFERENCES driver_profiles(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
