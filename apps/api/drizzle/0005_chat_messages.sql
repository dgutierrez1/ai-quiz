-- Story 4.1 (chat persistence) + Story 4.4 (7-day scrub) delivered together:
-- `content`/`sources`/`tool_calls`/`thinking` are nullable from day one
-- (Story 4.1 design ruling — avoids a later ALTER COLUMN DROP NOT NULL just
-- to relax a constraint that was never load-bearing), and `scrubbed_at` is
-- added in this same migration rather than a follow-up one, since both
-- stories are implemented in this pass. No `question_id` column — chat is
-- fully decoupled from questions (Story 4.1 AC #1).
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES quiz_sessions(id),
  role text NOT NULL,
  content text,
  sources jsonb,
  tool_calls jsonb,
  model text,
  thinking jsonb,
  scrubbed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id_created_at ON chat_messages (session_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

-- Depth-1 policy (same shape as documents/questions) — chat_messages carries
-- session_id directly, reusing current_session_user_id() from migration 0001.
CREATE POLICY user_chat_messages ON chat_messages
  USING (
    EXISTS (
      SELECT 1 FROM quiz_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = current_session_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quiz_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = current_session_user_id()
    )
  );
