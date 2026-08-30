-- Keep profile playlist order independent from visual profile media order.
ALTER TABLE profile_media ADD COLUMN audio_sort_order INTEGER;

UPDATE profile_media AS current
SET audio_sort_order = (
  SELECT COUNT(*) - 1
  FROM profile_media AS ranked
  WHERE ranked.profile_id = current.profile_id
    AND ranked.media_type IN ('audio', 'voice')
    AND (
      ranked.sort_order < current.sort_order
      OR (
        ranked.sort_order = current.sort_order
        AND (
          ranked.created_at < current.created_at
          OR (ranked.created_at = current.created_at AND ranked.id <= current.id)
        )
      )
    )
)
WHERE current.media_type IN ('audio', 'voice');

CREATE INDEX idx_profile_media_audio_order
  ON profile_media(profile_id, media_type, audio_sort_order, created_at);
