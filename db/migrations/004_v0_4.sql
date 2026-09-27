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
