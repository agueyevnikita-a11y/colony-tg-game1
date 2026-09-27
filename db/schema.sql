CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  language_code TEXT,
  referred_by UUID REFERENCES users(id),
  referral_qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_states (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hq_level INT NOT NULL DEFAULT 1,
  player_level INT NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  ore BIGINT NOT NULL DEFAULT 1100,
  energy BIGINT NOT NULL DEFAULT 300,
  parts BIGINT NOT NULL DEFAULT 0,
  credits BIGINT NOT NULL DEFAULT 700,
  crystals BIGINT NOT NULL DEFAULT 20,
  premium_until TIMESTAMPTZ,
  last_tick_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  passive_carry JSONB NOT NULL DEFAULT '{}'::jsonb,
  tutorial_step INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1,
  x INT NOT NULL DEFAULT 0,
  y INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','building','upgrading')),
  target_level INT,
  completes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buildings_user_idx ON buildings(user_id);

CREATE TABLE IF NOT EXISTS foundry_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  ore_spent BIGINT NOT NULL,
  energy_spent BIGINT NOT NULL,
  parts_reward BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completes_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cosmetics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  star_price INT,
  crystal_price INT,
  achievement_key TEXT,
  temporary_days INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id),
  source TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  equipped BOOLEAN NOT NULL DEFAULT false,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id, acquired_at)
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  stars_paid INT NOT NULL,
  telegram_payment_charge_id TEXT UNIQUE,
  invoice_payload TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','refunded','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS daily_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  target INT NOT NULL,
  crystal_reward INT NOT NULL DEFAULT 0,
  credit_reward INT NOT NULL DEFAULT 0,
  quest_date DATE NOT NULL DEFAULT CURRENT_DATE,
  claimed_at TIMESTAMPTZ,
  UNIQUE(user_id, quest_key, quest_date)
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone INT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, milestone)
);

CREATE TABLE IF NOT EXISTS npc_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('ore','parts')),
  amount BIGINT NOT NULL,
  credit_reward BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

INSERT INTO cosmetics (id,name,category,star_price,achievement_key,temporary_days) VALUES
  ('theme_neon','Неоновый город','theme',149,'build_100',7),
  ('weather_aurora','Северное сияние','weather',99,'expedition_25',7),
  ('frame_orbit','Орбитальная рамка','frame',79,'trade_100',14),
  ('founder_badge','Знак основателя','badge',NULL,NULL,NULL),
  ('founder_monument','Монумент основателя','building_skin',NULL,NULL,NULL),
  ('founder_frame','Рамка основателя','frame',NULL,NULL,NULL),
  ('founder_sky','Небо основателя','weather',NULL,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- v0.2 progression / retention layer
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

-- v0.3 spatial city + future market foundation
CREATE INDEX IF NOT EXISTS buildings_user_xy_idx ON buildings(user_id, x, y);

CREATE TABLE IF NOT EXISTS market_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('ore','energy','parts')),
  amount_total BIGINT NOT NULL CHECK (amount_total > 0),
  amount_remaining BIGINT NOT NULL CHECK (amount_remaining >= 0),
  unit_price BIGINT NOT NULL CHECK (unit_price > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS market_orders_book_idx ON market_orders(resource, unit_price, created_at) WHERE status='open';
CREATE INDEX IF NOT EXISTS market_orders_user_idx ON market_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES market_orders(id) ON DELETE RESTRICT,
  seller_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource TEXT NOT NULL CHECK (resource IN ('ore','energy','parts')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price > 0),
  fee_credits BIGINT NOT NULL DEFAULT 0 CHECK (fee_credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_trades_resource_time_idx ON market_trades(resource, created_at DESC);
-- COLONY v0.4: P2P market, Season 1 and economy telemetry
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS market_orders_created BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS market_trades_bought BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS market_trades_sold BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS seasons(id TEXT PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(ends_at>starts_at));
INSERT INTO seasons(id,title,subtitle,starts_at,ends_at) VALUES('s1_first_signal','Первый сигнал','Первый 30-дневный сезон COLONY',now(),now()+interval '30 days') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS season_progress(user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,points BIGINT NOT NULL DEFAULT 0 CHECK(points>=0),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,season_id));
CREATE TABLE IF NOT EXISTS season_claims(user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,level INT NOT NULL CHECK(level>0),claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,season_id,level));
CREATE TABLE IF NOT EXISTS economy_daily_snapshots(user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,hq_level INT NOT NULL,buildings_count INT NOT NULL,ore BIGINT NOT NULL,energy BIGINT NOT NULL,parts BIGINT NOT NULL,credits BIGINT NOT NULL,crystals BIGINT NOT NULL,open_market_orders INT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,snapshot_date));
CREATE INDEX IF NOT EXISTS economy_snapshots_date_idx ON economy_daily_snapshots(snapshot_date DESC);
INSERT INTO cosmetics(id,name,category,star_price,achievement_key,temporary_days,metadata) VALUES
('weather_signal_storm','Сигнальная буря','weather',NULL,NULL,7,'{"emoji":"🌩️","season":"s1"}'::jsonb),
('frame_first_signal','Рамка Первого сигнала','frame',NULL,NULL,14,'{"emoji":"📶","season":"s1"}'::jsonb),
('theme_first_signal','Тема Первого сигнала','theme',NULL,NULL,14,'{"emoji":"🛰️","season":"s1"}'::jsonb),
('badge_pioneer_s1','Пионер I сезона','badge',NULL,NULL,NULL,'{"emoji":"🏅","season":"s1"}'::jsonb),
('frame_exchange','Биржевая рамка','frame',NULL,'market_25',7,'{"emoji":"📊"}'::jsonb)
ON CONFLICT(id) DO NOTHING;
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

-- v1.0.1: keep sub-unit income when sessions refresh more often than production.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS passive_carry JSONB NOT NULL DEFAULT '{}'::jsonb;
