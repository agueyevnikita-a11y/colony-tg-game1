-- Prize standings use new paid cooperative contributions, never legacy SP/AP.
CREATE TABLE IF NOT EXISTS alliance_competition_periods (
  id TEXT PRIMARY KEY, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ, CHECK(ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS alliance_competition_bindings (
  period_id TEXT NOT NULL REFERENCES alliance_competition_periods(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alliance_id UUID NOT NULL, alliance_name TEXT NOT NULL,
  PRIMARY KEY(period_id,user_id)
);
CREATE TABLE IF NOT EXISTS alliance_competition_entries (
  source_id UUID PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES alliance_competition_periods(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alliance_id UUID NOT NULL, alliance_name TEXT NOT NULL,
  points INT NOT NULL CHECK(points=10), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alliance_competition_entries_period_idx ON alliance_competition_entries(period_id,alliance_id,user_id);
CREATE TABLE IF NOT EXISTS alliance_competition_standings (
  period_id TEXT NOT NULL REFERENCES alliance_competition_periods(id),
  kind TEXT NOT NULL CHECK(kind IN ('personal','alliance')), entity_id UUID NOT NULL,
  name TEXT NOT NULL, points BIGINT NOT NULL CHECK(points>=0), rank INT CHECK(rank>0),
  PRIMARY KEY(period_id,kind,entity_id), UNIQUE(period_id,kind,rank)
);
CREATE TABLE IF NOT EXISTS alliance_competition_awards (
  period_id TEXT NOT NULL REFERENCES alliance_competition_periods(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('personal','alliance')), rank INT NOT NULL CHECK(rank>0),
  crystals INT NOT NULL CHECK(crystals>=0), cosmetic_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  alliance_name TEXT, claimed_at TIMESTAMPTZ,
  PRIMARY KEY(period_id,user_id,kind)
);
INSERT INTO cosmetics(id,name,category,metadata) VALUES
('badge_coop_champion','Знак чемпиона лунной лиги','badge','{"social":true}'::jsonb),
('frame_coop_orbit','Рамка лидера лунной лиги','frame','{"social":true}'::jsonb),
('frame_coop_team','Рамка ведущего альянса','frame','{"social":true}'::jsonb),
('title_coop_vanguard','Авангард лунной лиги','title','{"social":true}'::jsonb),
('title_coop_team','Первопроходец альянса','title','{"social":true}'::jsonb)
ON CONFLICT(id) DO NOTHING;
