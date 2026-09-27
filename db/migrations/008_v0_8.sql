-- COLONY v0.8: onboarding, notifications and closed-test admin telemetry
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS tutorial_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_write_allowed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  building_ready BOOLEAN NOT NULL DEFAULT true,
  research_ready BOOLEAN NOT NULL DEFAULT true,
  expedition_ready BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('building_ready','research_ready','expedition_ready')),
  dedupe_key TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  processing_at TIMESTAMPTZ,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS notification_jobs_due_idx
  ON notification_jobs(scheduled_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS tutorial_claims (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_index INT NOT NULL CHECK(step_index >= 0),
  step_key TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,step_index),
  UNIQUE(user_id,step_key)
);

INSERT INTO cosmetics(id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
  ('title_cadet','Титул: Выпускник колонии','title',NULL,NULL,NULL,'{"label":"Выпускник колонии","source":"tutorial"}'::jsonb)
ON CONFLICT(id) DO NOTHING;
