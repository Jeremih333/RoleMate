-- Broadcasts previously arrived as plain text, so a campaign could not send the
-- reader anywhere. An optional inline button carries a link with the message.
ALTER TABLE broadcasts ADD COLUMN button_text TEXT;
ALTER TABLE broadcasts ADD COLUMN button_url TEXT;
