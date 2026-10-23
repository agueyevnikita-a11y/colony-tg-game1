-- Cooperative rewards survive leaving, removal and deletion of their alliance.
CREATE TABLE IF NOT EXISTS alliance_cooperation_progress (
  alliance_id UUID PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  shared_science BIGINT NOT NULL DEFAULT 0 CHECK(shared_science >= 0),
  drilling_level INT NOT NULL DEFAULT 0 CHECK(drilling_level BETWEEN 0 AND 3),
  analysis_level INT NOT NULL DEFAULT 0 CHECK(analysis_level BETWEEN 0 AND 3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alliance_cooperation_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately no alliance FK: deletion cannot destroy paid personal rewards.
  alliance_id UUID NOT NULL,
  alliance_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  drilling_level INT NOT NULL DEFAULT 0 CHECK(drilling_level BETWEEN 0 AND 3),
  analysis_level INT NOT NULL DEFAULT 0 CHECK(analysis_level BETWEEN 0 AND 3),
  team_bonus_percent INT NOT NULL DEFAULT 0 CHECK(team_bonus_percent IN (0,10,20)),
  shared_science_awarded BIGINT NOT NULL DEFAULT 0 CHECK(shared_science_awarded >= 0),
  settled_at TIMESTAMPTZ,
  CHECK(ends_at > started_at),
  CHECK((status='active' AND settled_at IS NULL) OR (status='settled' AND settled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS alliance_cooperation_one_active_idx ON alliance_cooperation_operations(alliance_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS alliance_cooperation_operations_alliance_idx ON alliance_cooperation_operations(alliance_id,started_at DESC);

CREATE TABLE IF NOT EXISTS alliance_cooperation_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES alliance_cooperation_operations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('drilling','power','analysis')),
  cost_json JSONB NOT NULL CHECK(jsonb_typeof(cost_json)='object'),
  reward_json JSONB NOT NULL CHECK(jsonb_typeof(reward_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alliance_cooperation_contributions_operation_idx ON alliance_cooperation_contributions(operation_id,user_id);
CREATE INDEX IF NOT EXISTS alliance_cooperation_pending_user_idx ON alliance_cooperation_contributions(user_id,operation_id) WHERE claimed_at IS NULL;

CREATE TABLE IF NOT EXISTS alliance_cooperation_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
