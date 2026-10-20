-- Pending events wait for the player without an offline penalty or expiry.
CREATE TABLE IF NOT EXISTS colony_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
  event_json JSONB NOT NULL CHECK(jsonb_typeof(event_json)='object'),
  choice_id TEXT,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CHECK (
    (status='pending' AND choice_id IS NULL AND result_json IS NULL AND resolved_at IS NULL)
    OR (status='resolved' AND choice_id IS NOT NULL AND result_json IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS colony_events_one_pending_idx ON colony_events(user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS colony_events_user_resolved_idx ON colony_events(user_id,resolved_at DESC) WHERE status='resolved';
