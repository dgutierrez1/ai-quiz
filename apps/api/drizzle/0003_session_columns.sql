ALTER TABLE quiz_sessions ADD COLUMN actual_count integer;
ALTER TABLE quiz_sessions ADD COLUMN selected_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
