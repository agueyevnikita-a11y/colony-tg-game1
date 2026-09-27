CREATE TABLE IF NOT EXISTS player_stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sessions BIGINT NOT NULL DEFAULT 0,
  buildings_started BIGINT NOT NULL DEFAULT 0,
  foundry_jobs_started BIGINT NOT NULL DEFAULT 0,
  contracts_completed BIGINT NOT NULL DEFAULT 0,
  qualified_referrals BIGINT NOT NULL DEFAULT 0,
  last_session_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  target INT NOT NULL,
  crystal_reward INT NOT NULL DEFAULT 0,
  credit_reward INT NOT NULL DEFAULT 0,
  week_start DATE NOT NULL,
  claimed_at TIMESTAMPTZ,
  UNIQUE(user_id, quest_key, week_start)
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, achievement_key)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_user_time_idx ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events(event_name, created_at DESC);

ALTER TABLE npc_contracts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS npc_contracts_user_active_idx ON npc_contracts(user_id, expires_at DESC) WHERE completed_at IS NULL;

INSERT INTO cosmetics (id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
  ('effect_signal','Эффект: Радиосигнал','effect',NULL,'network_1',7,'{"emoji":"📡"}'::jsonb),
  ('title_connector','Титул: Связной','title',NULL,'network_5',NULL,'{"label":"Связной"}'::jsonb),
  ('frame_connector','Рамка: Сеть','frame',NULL,'network_50',30,'{"emoji":"🕸️"}'::jsonb),
  ('monument_network','Монумент сети','building_skin',NULL,NULL,NULL,'{"emoji":"🗼"}'::jsonb),
  ('relay_legend','Легендарный ретранслятор','building_skin',NULL,NULL,NULL,'{"emoji":"📡"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
