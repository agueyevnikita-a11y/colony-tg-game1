-- v1.10: comfort, referral bonus receipts and technology-based feature access.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS max_comfort INT NOT NULL DEFAULT 0 CHECK(max_comfort BETWEEN 0 AND 100);

ALTER TABLE city_decor DROP CONSTRAINT IF EXISTS city_decor_type_check;
ALTER TABLE city_decor ADD CONSTRAINT city_decor_type_check CHECK(type IN ('road','tree','lamp','park','statue','bench','flowerbed','fountain','plaza'));

CREATE TABLE IF NOT EXISTS referral_bonus_claims (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_reward INT NOT NULL CHECK(credit_reward >= 0),
  crystal_reward INT NOT NULL CHECK(crystal_reward >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,invited_user_id)
);
CREATE INDEX IF NOT EXISTS referral_bonus_claims_invited_idx ON referral_bonus_claims(invited_user_id);

CREATE TABLE IF NOT EXISTS colony_feature_access (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL CHECK(feature_key IN ('market','expeditions')),
  source TEXT NOT NULL DEFAULT 'legacy_v1_10',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,feature_key)
);
CREATE TABLE IF NOT EXISTS colony_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Run this backfill once. Repeated db:init must not open features for new users.
DO $$
BEGIN
  INSERT INTO colony_migrations(migration_key) VALUES('v1_10_feature_access') ON CONFLICT DO NOTHING;
  IF FOUND THEN
    INSERT INTO colony_feature_access(user_id,feature_key)
    SELECT DISTINCT user_id,'market' FROM buildings WHERE type='trade_hub'
    UNION SELECT DISTINCT user_id,'market' FROM market_orders
    ON CONFLICT DO NOTHING;
    INSERT INTO colony_feature_access(user_id,feature_key)
    SELECT DISTINCT user_id,'expeditions' FROM buildings WHERE type='expedition_center'
    UNION SELECT DISTINCT user_id,'expeditions' FROM expeditions
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

INSERT INTO cosmetics(id,name,category,achievement_key,metadata)
VALUES('frame_garden','Рамка: Живая колония','frame','comfort_50','{"icon":"comfort","comfort":true}'::jsonb)
ON CONFLICT(id) DO NOTHING;
