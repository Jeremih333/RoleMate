-- A profile avatar belongs to the normalized profile/user identity, never to a mutable username.
ALTER TABLE profiles ADD COLUMN avatar_media_id TEXT;
ALTER TABLE profiles ADD COLUMN avatar_render_mode TEXT
  CHECK (avatar_render_mode IS NULL OR avatar_render_mode IN ('photo', 'animation'));

-- Telegram media metadata lets the API enforce safe GIF-like video-avatar limits.
ALTER TABLE profile_media ADD COLUMN file_size_bytes INTEGER;
ALTER TABLE profile_media ADD COLUMN duration_seconds INTEGER;
ALTER TABLE profile_media ADD COLUMN width INTEGER;
ALTER TABLE profile_media ADD COLUMN height INTEGER;

CREATE INDEX idx_profiles_avatar_media ON profiles(avatar_media_id);
