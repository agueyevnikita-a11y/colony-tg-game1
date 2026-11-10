-- These codes only link a support enquiry to an existing account.
-- They never authorize login, data export or deletion.
CREATE TABLE IF NOT EXISTS account_ownership_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  verified_by_telegram_id BIGINT,
  request_ref TEXT CHECK(request_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  CHECK(expires_at > issued_at),
  CHECK((consumed_at IS NULL AND verified_by_telegram_id IS NULL AND request_ref IS NULL)
     OR (consumed_at IS NOT NULL AND verified_by_telegram_id IS NOT NULL AND request_ref IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS account_ownership_proofs_active_user_idx
  ON account_ownership_proofs(user_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_ownership_proofs_issued_idx ON account_ownership_proofs(issued_at);
