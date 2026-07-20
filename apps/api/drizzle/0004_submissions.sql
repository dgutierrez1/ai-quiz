ALTER TABLE knowledge_categories ADD COLUMN correct_count integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_categories ADD COLUMN weighted_score numeric;
CREATE TABLE user_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES quiz_sessions(id), question_id uuid NOT NULL REFERENCES questions(id), selected jsonb NOT NULL, raw_score numeric NOT NULL, weight numeric NOT NULL, weighted_score numeric NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(), UNIQUE (session_id, question_id));
CREATE TABLE insights (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES quiz_sessions(id), kind text NOT NULL DEFAULT 'gap_analysis', payload jsonb NOT NULL, sources jsonb, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE user_responses ENABLE ROW LEVEL SECURITY; ALTER TABLE user_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY; ALTER TABLE insights FORCE ROW LEVEL SECURITY;
CREATE POLICY user_user_responses ON user_responses USING (EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.id=user_responses.session_id AND s.user_id=current_session_user_id())) WITH CHECK (EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.id=user_responses.session_id AND s.user_id=current_session_user_id()));
CREATE POLICY user_insights ON insights USING (EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.id=insights.session_id AND s.user_id=current_session_user_id())) WITH CHECK (EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.id=insights.session_id AND s.user_id=current_session_user_id()));
