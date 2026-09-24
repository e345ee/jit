import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30_000);
const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 20);

if (!connectionString && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL is required for reminder worker');
}

const pool = connectionString
  ? new pg.Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000
    })
  : null;

const REMINDERS_SCHEMA_SQL = `
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
`;

export async function ensureSchema(db: pg.Pool = requirePool()) {
  await db.query(REMINDERS_SCHEMA_SQL);
}

export async function processDueReminders(db: pg.Pool = requirePool(), limit = batchSize) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `
        SELECT id, chat_id, situation_id, step_id, remind_at, text
        FROM reminders
        WHERE status = 'pending' AND remind_at <= now()
        ORDER BY remind_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      [limit]
    );

    for (const reminder of due.rows) {
      console.info(
        {
          reminderId: reminder.id,
          chatId: reminder.chat_id ? 'configured' : 'local',
          situationId: reminder.situation_id,
          stepId: reminder.step_id,
          remindAt: reminder.remind_at
        },
        'reminder delivery disabled in demo mode'
      );
      await client.query("UPDATE reminders SET status = 'sent', updated_at = now() WHERE id = $1", [reminder.id]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error({ error }, 'worker cycle failed');
  } finally {
    client.release();
  }
}

function requirePool() {
  if (!pool) {
    throw new Error('DATABASE_URL is required for reminder worker');
  }
  return pool;
}

export async function main() {
  const db = requirePool();
  await ensureSchema(db);
  console.info({ pollIntervalMs, batchSize }, 'reminder worker started');
  await processDueReminders(db);
  const interval = setInterval(() => {
    processDueReminders(db).catch((error) => {
      console.error({ error }, 'worker scheduled cycle failed');
    });
  }, pollIntervalMs);

  const close = async (signal: NodeJS.Signals) => {
    console.info({ signal }, 'shutting down reminder worker');
    clearInterval(interval);
    await db.end();
    process.exit(0);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error({ error }, 'reminder worker failed to start');
    process.exit(1);
  });
}
