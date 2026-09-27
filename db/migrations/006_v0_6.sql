-- COLONY v0.6: city score, decor, alliance management, daily goals, repeatable megaprojects
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS city_score BIGINT NOT NULL DEFAULT 0 CHECK(city_score >= 0);
ALTER TABLE alliances ADD COLUMN IF NOT EXISTS prestige BIGINT NOT NULL DEFAULT 0 CHECK(prestige >= 0);
ALTER TABLE alliance_projects ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1 CHECK(cycle > 0);
ALTER TABLE alliance_projects DROP CONSTRAINT IF EXISTS alliance_projects_alliance_id_project_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS alliance_projects_cycle_uq ON alliance_projects(alliance_id,project_key,cycle);
CREATE INDEX IF NOT EXISTS alliance_projects_active_idx ON alliance_projects(alliance_id,status,cycle DESC);

CREATE TABLE IF NOT EXISTS alliance_daily_goals (
  alliance_id UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  goal_date DATE NOT NULL DEFAULT CURRENT_DATE,
  goal_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  target BIGINT NOT NULL CHECK(target > 0),
  progress BIGINT NOT NULL DEFAULT 0 CHECK(progress >= 0),
  reward_crystals BIGINT NOT NULL DEFAULT 0 CHECK(reward_crystals >= 0),
  reward_credits BIGINT NOT NULL DEFAULT 0 CHECK(reward_credits >= 0),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(alliance_id,goal_date,goal_key)
);

CREATE TABLE IF NOT EXISTS alliance_daily_goal_members (
  alliance_id UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  goal_date DATE NOT NULL,
  goal_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contribution BIGINT NOT NULL DEFAULT 0 CHECK(contribution >= 0),
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY(alliance_id,goal_date,goal_key,user_id),
  FOREIGN KEY(alliance_id,goal_date,goal_key)
    REFERENCES alliance_daily_goals(alliance_id,goal_date,goal_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS alliance_daily_goal_members_user_idx ON alliance_daily_goal_members(user_id,goal_date DESC);

CREATE TABLE IF NOT EXISTS city_decor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('road','tree','lamp','park','statue')),
  x INT NOT NULL CHECK(x >= 0),
  y INT NOT NULL CHECK(y >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,x,y)
);
CREATE INDEX IF NOT EXISTS city_decor_user_idx ON city_decor(user_id);

INSERT INTO cosmetics(id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
('effect_relay_veteran','Импульс ветерана ретранслятора','effect',NULL,NULL,14,'{"emoji":"📡","alliance":true,"repeatable":true}'::jsonb)
ON CONFLICT(id) DO NOTHING;
