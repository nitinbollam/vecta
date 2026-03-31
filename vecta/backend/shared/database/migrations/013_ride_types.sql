-- =============================================================================
-- 013_ride_types.sql — Priority vs carpool rides, carpool sessions & stops
-- =============================================================================

-- Carpool sessions first (referenced by rides.carpool_session_id)
CREATE TABLE carpool_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             UUID NOT NULL REFERENCES driver_profiles(id),

  driver_origin_lat     NUMERIC(10,7) NOT NULL,
  driver_origin_lng     NUMERIC(10,7) NOT NULL,
  driver_dest_lat       NUMERIC(10,7) NOT NULL,
  driver_dest_lng       NUMERIC(10,7) NOT NULL,

  max_riders            INT NOT NULL DEFAULT 3,
  current_riders        INT NOT NULL DEFAULT 0,
  price_per_mile_cents  INT NOT NULL DEFAULT 60,

  status                TEXT NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN (
                            'OPEN',
                            'FULL',
                            'IN_PROGRESS',
                            'COMPLETED',
                            'CANCELLED'
                          )),

  departure_time        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS ride_type TEXT NOT NULL DEFAULT 'PRIORITY'
    CHECK (ride_type IN ('PRIORITY', 'CARPOOL')),
  ADD COLUMN IF NOT EXISTS carpool_session_id UUID REFERENCES carpool_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_passengers INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_passengers INT NOT NULL DEFAULT 1;

CREATE TABLE carpool_stops (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES carpool_sessions(id) ON DELETE CASCADE,
  ride_id           UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rider_student_id  UUID NOT NULL REFERENCES students(id),

  pickup_lat        NUMERIC(10,7) NOT NULL,
  pickup_lng        NUMERIC(10,7) NOT NULL,
  pickup_address    TEXT NOT NULL,
  dropoff_lat       NUMERIC(10,7) NOT NULL,
  dropoff_lng       NUMERIC(10,7) NOT NULL,
  dropoff_address   TEXT NOT NULL,

  pickup_order      INT NOT NULL DEFAULT 0,
  dropoff_order     INT NOT NULL DEFAULT 0,

  rider_miles       NUMERIC(6,2),
  rider_fare_cents  INT,

  status            TEXT NOT NULL DEFAULT 'WAITING'
                      CHECK (status IN (
                        'WAITING',
                        'PICKED_UP',
                        'DROPPED_OFF',
                        'CANCELLED'
                      )),

  picked_up_at      TIMESTAMPTZ,
  dropped_off_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carpool_sessions_status
  ON carpool_sessions(status)
  WHERE status = 'OPEN';
