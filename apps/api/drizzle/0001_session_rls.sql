CREATE OR REPLACE FUNCTION current_session_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT current_setting('app.user_id', true)::uuid $$;
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY user_owns_session ON quiz_sessions USING (user_id = current_session_user_id()) WITH CHECK (user_id = current_session_user_id());
