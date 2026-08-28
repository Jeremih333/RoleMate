-- Every access to processed_telegram_updates goes through update_id, which is the
-- primary key: the claim, the completion, the state probe and both releases. This
-- index on (state, claim_expires_at) served no query, but it doubled the rows
-- written by the two hottest statements in the system — Telegram's webhook writes
-- one row to claim an update and one to complete it, and each of those also
-- rewrote an index entry.
--
-- On the D1 free plan those two statements alone accounted for roughly 61k of the
-- 100k daily row-write allowance.
DROP INDEX IF EXISTS idx_processed_telegram_updates_processing_lease;
