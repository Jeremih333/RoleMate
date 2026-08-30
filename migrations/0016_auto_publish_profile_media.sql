-- Existing media that waited for pre-publication review becomes visible immediately.
-- Rejected media remains rejected and moderation history is preserved.
UPDATE profile_media
SET moderation_status = 'approved'
WHERE moderation_status = 'pending';
