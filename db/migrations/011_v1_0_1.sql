-- Preserve fractional passive/science income across frequent Mini App refreshes.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS passive_carry JSONB NOT NULL DEFAULT '{}'::jsonb;
