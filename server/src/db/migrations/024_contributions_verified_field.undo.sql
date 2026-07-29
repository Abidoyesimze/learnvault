DROP INDEX IF EXISTS idx_contributions_donor;
DROP INDEX IF EXISTS idx_contributions_proposal;

ALTER TABLE scholarship_contributions
  DROP CONSTRAINT IF EXISTS scholarship_contributions_tx_hash_key;

ALTER TABLE scholarship_contributions
  DROP COLUMN IF EXISTS verified;
