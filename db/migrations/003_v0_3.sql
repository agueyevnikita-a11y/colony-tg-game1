-- COLONY v0.3: spatial city + upgrade foundation + future P2P market schema

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
