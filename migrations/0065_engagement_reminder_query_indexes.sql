-- Engagement reminders are sparse, but the due-candidate query checks recent
-- notification history for every candidate. Without this covering prefix D1
-- scans the notification table repeatedly and charges hundreds of thousands
-- of rows for one empty campaign poll.
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent_source
  ON notifications(user_id, created_at DESC, source_key);

-- The approved-questionnaire existence check starts with the owner and then
-- narrows by moderation state. Keep that lookup indexable as the catalogue grows.
CREATE INDEX IF NOT EXISTS idx_questionnaires_owner_moderation
  ON questionnaires(user_id, moderation_status);
