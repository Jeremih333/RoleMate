-- Closing a conversation has been taken out of the product: it removed the
-- composer with no way back, and blocking already does the job properly. Three
-- code paths used to close chats — tidying a match, the courteous goodbye, and
-- the stale-match sweep — which left people unable to write in conversations
-- holding dozens of messages.
--
-- This restores every conversation that is closed without a block behind it.
-- A chat closed because somebody was blocked stays closed; unblocking reopens it.
UPDATE conversations
SET status = 'active', closed_at = NULL
WHERE status = 'closed'
  AND NOT EXISTS (
    SELECT 1
    FROM conversation_participants cp1
    JOIN conversation_participants cp2
      ON cp2.conversation_id = cp1.conversation_id AND cp2.user_id <> cp1.user_id
    JOIN blocks b
      ON (b.blocker_user_id = cp1.user_id AND b.blocked_user_id = cp2.user_id)
    WHERE cp1.conversation_id = conversations.id
  );

-- The people in those conversations were marked as having left when the chat was
-- closed, which keeps them out of their own conversation.
UPDATE conversation_participants
SET left_at = NULL
WHERE left_at IS NOT NULL
  AND conversation_id IN (SELECT id FROM conversations WHERE status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM conversation_participants other
    JOIN blocks b
      ON (b.blocker_user_id = conversation_participants.user_id AND b.blocked_user_id = other.user_id)
       OR (b.blocker_user_id = other.user_id AND b.blocked_user_id = conversation_participants.user_id)
    WHERE other.conversation_id = conversation_participants.conversation_id
      AND other.user_id <> conversation_participants.user_id
  );

-- A match closed only because its chat was tidied away comes back with it, so the
-- pair still see each other where they expect to.
UPDATE matches
SET status = 'active', closed_at = NULL, closed_by_user_id = NULL, close_reason = NULL
WHERE status = 'closed'
  AND close_reason = 'user_request'
  AND EXISTS (
    SELECT 1 FROM conversations c
    JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.match_id = matches.id AND c.status = 'active'
  );
