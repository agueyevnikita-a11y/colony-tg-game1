-- COLONY v0.7: research, expeditions, events and artifacts
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS science BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS research_completed BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS expeditions_started BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS expeditions_completed BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS artifacts_found BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS unique_artifacts_found BIGINT NOT NULL DEFAULT 0;
ALTER TABLE economy_daily_snapshots ADD COLUMN IF NOT EXISTS science BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_research (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  research_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'researching' CHECK(status IN ('researching','completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completes_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(user_id,research_key)
);
CREATE INDEX IF NOT EXISTS user_research_active_idx ON user_research(user_id,completes_at) WHERE status='researching';

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK(rarity IN ('common','uncommon','rare','epic')),
  description TEXT NOT NULL DEFAULT ''
);
INSERT INTO artifacts(id,name,emoji,rarity,description) VALUES
  ('signal_fragment','Фрагмент сигнала','📶','common','Кристаллическая структура с повторяющейся информационной последовательностью.'),
  ('alloy_core','Неизвестный сплав','🔩','uncommon','Композит, не совпадающий с материалами колонии.'),
  ('stellar_map','Звёздная карта','🗺️','rare','Фрагмент навигационной схемы с неизвестной системой координат.'),
  ('quantum_lens','Квантовая линза','🔮','epic','Оптический узел, свойства которого пока невозможно полностью объяснить.')
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_artifacts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  count INT NOT NULL DEFAULT 1 CHECK(count>0),
  first_found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,artifact_id)
);

CREATE TABLE IF NOT EXISTS expeditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expedition_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ready','event','claimed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completes_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  reward_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward_claimed BOOLEAN NOT NULL DEFAULT false,
  event_key TEXT,
  event_choice TEXT,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expeditions_user_status_idx ON expeditions(user_id,status,completes_at);

INSERT INTO cosmetics(id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
  ('frame_researcher','Рамка исследователя','frame',NULL,'research_10',NULL,'{"emoji":"🧬","source":"research"}'::jsonb),
  ('frame_pathfinder','Рамка первопроходца','frame',NULL,'artifact_4',NULL,'{"emoji":"🧭","source":"artifacts"}'::jsonb)
ON CONFLICT(id) DO NOTHING;
