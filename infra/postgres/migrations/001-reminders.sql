CREATE TABLE IF NOT EXISTS reminders (
  id text PRIMARY KEY,
  chat_id text NOT NULL DEFAULT 'local',
  situation_id text NOT NULL,
  step_id text NOT NULL,
  remind_at timestamptz NOT NULL,
  text text NOT NULL CHECK (char_length(text) <= 240),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, situation_id, step_id, remind_at)
);

ALTER TABLE reminders
  ALTER COLUMN chat_id SET DEFAULT 'local';

UPDATE reminders
  SET chat_id = 'local'
  WHERE chat_id IS NULL;

ALTER TABLE reminders
  ALTER COLUMN chat_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (remind_at)
  WHERE status = 'pending';
