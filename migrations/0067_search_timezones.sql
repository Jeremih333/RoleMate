-- People asked to look for partners in their own part of the world, so the
-- saved search gains a timezone list alongside the other multi-value filters.
-- It is stored as a JSON array for consistency with genres and fandoms.
-- Saved filter sets keep their filters in a JSON blob and need no column.
ALTER TABLE search_preferences ADD COLUMN timezones TEXT NOT NULL DEFAULT '[]';
