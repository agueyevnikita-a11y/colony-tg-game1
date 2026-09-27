-- COLONY v0.9: closed beta profile, daily streak, inbox, feature flags and error telemetry
ALTER TABLE users ADD COLUMN IF NOT EXISTS colony_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS daily_login_streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INT NOT NULL DEFAULT 0 CHECK(current_streak >= 0),
  longest_streak INT NOT NULL DEFAULT 0 CHECK(longest_streak >= 0),
  last_login_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_login_rewards (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_date DATE NOT NULL DEFAULT CURRENT_DATE,
  streak_number INT NOT NULL CHECK(streak_number > 0),
  cycle_day INT NOT NULL CHECK(cycle_day BETWEEN 1 AND 7),
  credit_reward INT NOT NULL DEFAULT 0 CHECK(credit_reward >= 0),
  crystal_reward INT NOT NULL DEFAULT 0 CHECK(crystal_reward >= 0),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,reward_date)
);

CREATE TABLE IF NOT EXISTS game_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'system',
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS game_inbox_user_idx ON game_inbox(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rollout_percent INT NOT NULL DEFAULT 100 CHECK(rollout_percent BETWEEN 0 AND 100),
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL REFERENCES feature_flags(flag_key) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY(user_id,flag_key)
);

INSERT INTO feature_flags(flag_key,enabled,rollout_percent,description) VALUES
  ('market',true,100,'P2P market'),
  ('alliances',true,100,'Alliances and megaprojects'),
  ('expeditions',true,100,'Research expeditions'),
  ('stars_shop',true,100,'Telegram Stars shop'),
  ('notifications',true,100,'Telegram completion notifications'),
  ('closed_beta_banner',true,100,'Closed beta banner')
ON CONFLICT(flag_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_events_time_idx ON error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS error_events_user_time_idx ON error_events(user_id,created_at DESC);
