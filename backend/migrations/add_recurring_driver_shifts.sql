BEGIN;

CREATE TABLE IF NOT EXISTS driver_dispatch_weekly_shifts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days smallint[] NOT NULL CHECK (cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  time_zone text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  CHECK (start_time <> end_time)
);
CREATE INDEX IF NOT EXISTS driver_dispatch_weekly_shifts_user ON driver_dispatch_weekly_shifts (user_id);

CREATE OR REPLACE FUNCTION driver_dispatch_shift_occurrences(
  window_start timestamptz, window_end timestamptz, driver_user uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, user_id uuid, starts_at timestamptz, ends_at timestamptz,
               latitude double precision, longitude double precision)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.user_id, s.starts_at, s.ends_at, s.latitude, s.longitude
  FROM driver_dispatch_shifts s
  WHERE (driver_user IS NULL OR s.user_id = driver_user)
    AND s.starts_at < window_end AND s.ends_at > window_start
  UNION ALL
  SELECT rule.id, rule.user_id, occurrence.starts_at, occurrence.ends_at, rule.latitude, rule.longitude
  FROM driver_dispatch_weekly_shifts rule
  CROSS JOIN LATERAL (
    SELECT (window_start AT TIME ZONE rule.time_zone)::date - 1 AS first_day,
           (window_end AT TIME ZONE rule.time_zone)::date AS last_day
  ) bounds
  CROSS JOIN LATERAL generate_series(0, bounds.last_day - bounds.first_day) AS day_offset(n)
  CROSS JOIN LATERAL (SELECT bounds.first_day + day_offset.n AS local_day) day
  CROSS JOIN LATERAL (
    SELECT (day.local_day + rule.start_time) AT TIME ZONE rule.time_zone AS starts_at,
           (day.local_day + CASE WHEN rule.end_time < rule.start_time THEN 1 ELSE 0 END + rule.end_time)
             AT TIME ZONE rule.time_zone AS ends_at
  ) occurrence
  WHERE (driver_user IS NULL OR rule.user_id = driver_user)
    AND EXTRACT(ISODOW FROM day.local_day)::smallint = ANY(rule.days)
    AND occurrence.starts_at < window_end AND occurrence.ends_at > window_start
    AND occurrence.ends_at > occurrence.starts_at
$$;

COMMIT;
