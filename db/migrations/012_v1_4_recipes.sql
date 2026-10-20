-- Retain existing job prices, rewards and schedules; identify them as the original recipe.
ALTER TABLE foundry_jobs ADD COLUMN IF NOT EXISTS recipe_key TEXT NOT NULL DEFAULT 'standard_alloy';
