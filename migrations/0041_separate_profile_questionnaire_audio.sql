-- Preserve every historical profile-audio copy before removing it from questionnaire media.
-- Recovery: reinsert the backed-up rows into questionnaire_media by matching all columns.
CREATE TABLE migration_0041_profile_audio_questionnaire_backup AS
SELECT qm.*
FROM questionnaire_media qm
JOIN profile_media pm ON pm.id = qm.id
WHERE qm.media_type IN ('audio', 'voice');

DELETE FROM questionnaire_media
WHERE media_type IN ('audio', 'voice')
  AND id IN (SELECT id FROM profile_media);
