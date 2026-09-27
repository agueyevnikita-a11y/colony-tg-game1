-- COLONY v0.5: alliances, cooperative megaproject, social leaderboards
ALTER TABLE users ADD COLUMN IF NOT EXISTS alliance_left_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS alliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_limit INT NOT NULL DEFAULT 30 CHECK (member_limit BETWEEN 2 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alliances_created_idx ON alliances(created_at ASC);

CREATE TABLE IF NOT EXISTS alliance_members (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alliance_id UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','officer','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alliance_members_alliance_idx ON alliance_members(alliance_id, joined_at ASC);

CREATE TABLE IF NOT EXISTS alliance_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  stage INT NOT NULL DEFAULT 1 CHECK (stage > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  ore_contributed BIGINT NOT NULL DEFAULT 0 CHECK (ore_contributed >= 0),
  energy_contributed BIGINT NOT NULL DEFAULT 0 CHECK (energy_contributed >= 0),
  parts_contributed BIGINT NOT NULL DEFAULT 0 CHECK (parts_contributed >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alliance_id, project_key)
);

CREATE TABLE IF NOT EXISTS alliance_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES alliance_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage INT NOT NULL CHECK(stage > 0),
  resource TEXT NOT NULL CHECK(resource IN ('ore','energy','parts')),
  amount BIGINT NOT NULL CHECK(amount > 0),
  points BIGINT NOT NULL CHECK(points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alliance_contrib_project_user_idx ON alliance_contributions(project_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS alliance_season_points (
  alliance_id UUID NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0 CHECK(points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(alliance_id,season_id)
);
CREATE INDEX IF NOT EXISTS alliance_season_rank_idx ON alliance_season_points(season_id,points DESC);

INSERT INTO cosmetics(id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
('effect_alliance_signal','Эффект альянса: Общий сигнал','effect',NULL,NULL,7,'{"emoji":"📡","alliance":true,"stage":1}'::jsonb),
('frame_alliance_relay','Рамка альянса: Ретранслятор','frame',NULL,NULL,14,'{"emoji":"🛰️","alliance":true,"stage":2}'::jsonb),
('monument_alliance_relay','Монумент орбитального ретранслятора','building_skin',NULL,NULL,NULL,'{"emoji":"🗼","alliance":true,"stage":3}'::jsonb)
ON CONFLICT(id) DO NOTHING;
