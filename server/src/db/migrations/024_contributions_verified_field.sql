-- Add verified flag so we can track which contributions have been confirmed on Horizon
ALTER TABLE scholarship_contributions
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

-- Prevent double-recording of the same on-chain transaction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scholarship_contributions_tx_hash_key'
      AND conrelid = 'scholarship_contributions'::regclass
  ) THEN
    ALTER TABLE scholarship_contributions
      ADD CONSTRAINT scholarship_contributions_tx_hash_key UNIQUE (tx_hash);
  END IF;
END $$;

-- Efficient funding-progress look-up per proposal
CREATE INDEX IF NOT EXISTS idx_contributions_proposal
  ON scholarship_contributions (proposal_id);

-- Efficient donor history look-up
CREATE INDEX IF NOT EXISTS idx_contributions_donor
  ON scholarship_contributions (donor_address);
