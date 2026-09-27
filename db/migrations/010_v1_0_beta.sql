-- COLONY v1.0 Beta: operational safety, beta access, rate limits, feedback and payment recovery

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings(setting_key,value) VALUES
  ('maintenance', '{"enabled":false,"message":"COLONY на коротком техническом обслуживании. Прогресс сохранён."}'::jsonb),
  ('beta_required', '{"enabled":false}'::jsonb)
ON CONFLICT(setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS beta_invite_codes (
  code_hash TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'beta',
  max_uses INT NOT NULL DEFAULT 1 CHECK(max_uses > 0),
  uses INT NOT NULL DEFAULT 0 CHECK(uses >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_access (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'code',
  invite_code_hash TEXT REFERENCES beta_invite_codes(code_hash) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('general','bug','balance','idea','payment')),
  message TEXT NOT NULL,
  client_version TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_feedback_status_time_idx ON player_feedback(status,created_at DESC);
CREATE INDEX IF NOT EXISTS player_feedback_user_time_idx ON player_feedback(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_rate_limits_updated_idx ON api_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS payment_recovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_transactions INT NOT NULL DEFAULT 0,
  recovered_purchases INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_recovery_user_time_idx ON payment_recovery_runs(user_id,created_at DESC);
