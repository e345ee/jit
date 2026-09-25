import { readFileSync } from 'node:fs';
import pg from 'pg';
import { runMigrations } from './migrations.js';

const connectionString = process.env.DATABASE_URL;
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30_000);
const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 20);
const maxApiUrl = (process.env.MAX_API_URL ?? 'https://platform-api2.max.ru').replace(/\/$/, '');

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

export interface DueReminder {
  id: string;
  chat_id: string;
  situation_id: string;
  step_id: string;
  remind_at: Date;
  text: string;
}

export interface DeliveryResult {
  status: 'sent' | 'skipped';
  targetType?: 'chat' | 'user';
  reason?: string;
}

export type ReminderDelivery = (reminder: DueReminder) => Promise<DeliveryResult>;

function readSecret(name: string) {
  const directValue = process.env[name];
  if (directValue) {
    return directValue;
  }

  const filePath = process.env[`${name}_FILE`];
  if (!filePath) {
    return undefined;
  }

  return readFileSync(filePath, 'utf8').trim();
}

export async function ensureSchema(db: pg.Pool = requirePool()) {
  await runMigrations(db);
}

function parseTarget(rawTarget: string) {
  if (!rawTarget || rawTarget === 'local') {
    return null;
  }

  if (rawTarget.startsWith('user:')) {
    return {
      targetType: 'user' as const,
      query: `user_id=${encodeURIComponent(rawTarget.slice('user:'.length))}`
    };
  }

  const chatId = rawTarget.startsWith('chat:') ? rawTarget.slice('chat:'.length) : rawTarget;
  return {
    targetType: 'chat' as const,
    query: `chat_id=${encodeURIComponent(chatId)}`
  };
}

export function createMaxReminderDelivery(token = readSecret('MAX_BOT_TOKEN')): ReminderDelivery {
  return async (reminder) => {
    const target = parseTarget(reminder.chat_id);
    if (!target) {
      return { status: 'skipped', reason: 'local reminder without MAX target' };
    }

    if (!token) {
      throw new Error('MAX_BOT_TOKEN is required to deliver MAX reminders');
    }

    const response = await fetch(`${maxApiUrl}/messages?${target.query}`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: reminder.text,
        format: 'markdown'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MAX reminder delivery failed with ${response.status}: ${errorText}`);
    }

    return { status: 'sent', targetType: target.targetType };
  };
}

export async function processDueReminders(
  db: pg.Pool = requirePool(),
  limit = batchSize,
  deliverReminder: ReminderDelivery = createMaxReminderDelivery()
) {
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
      const delivery = await deliverReminder(reminder as DueReminder);
      console.info(
        {
          reminderId: reminder.id,
          target: delivery.targetType ?? delivery.reason ?? 'unknown',
          situationId: reminder.situation_id,
          stepId: reminder.step_id,
          remindAt: reminder.remind_at
        },
        delivery.status === 'sent' ? 'reminder delivered to MAX' : 'local reminder completed without MAX delivery'
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
