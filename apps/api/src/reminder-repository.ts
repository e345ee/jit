import { createHash } from 'node:crypto';
import pg from 'pg';

export const REMINDERS_SCHEMA_SQL = `
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

export interface ReminderInput {
  chatId?: string;
  situationId: string;
  stepId: string;
  remindAt: string;
  text: string;
}

export interface ReminderRecord extends ReminderInput {
  id: string;
  status: 'pending' | 'sent' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRepository {
  upsert(input: ReminderInput): Promise<{ reminder: ReminderRecord; created: boolean }>;
  get(id: string): Promise<ReminderRecord | null>;
  cancel(id: string): Promise<boolean>;
}

function makeReminderId(input: ReminderInput) {
  return createHash('sha256')
    .update([normalizeChatId(input.chatId), input.situationId, input.stepId, input.remindAt].join('|'))
    .digest('hex')
    .slice(0, 32);
}

function normalizeChatId(chatId?: string) {
  return chatId?.trim() || 'local';
}

function mapRow(row: Record<string, unknown>): ReminderRecord {
  return {
    id: String(row.id),
    chatId: row.chat_id ? String(row.chat_id) : undefined,
    situationId: String(row.situation_id),
    stepId: String(row.step_id),
    remindAt: new Date(String(row.remind_at)).toISOString(),
    text: String(row.text),
    status: row.status as ReminderRecord['status'],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

export class PostgresReminderRepository implements ReminderRepository {
  private readonly pool: pg.Pool;
  private readonly ready: Promise<void>;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for postgres reminders');
    }

    this.pool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000
    });
    this.ready = this.ensureSchema();
  }

  private async ensureSchema() {
    await this.pool.query(REMINDERS_SCHEMA_SQL);
  }

  async upsert(input: ReminderInput) {
    await this.ready;
    const id = makeReminderId(input);
    const result = await this.pool.query(
      `
        INSERT INTO reminders (id, chat_id, situation_id, step_id, remind_at, text, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        ON CONFLICT (chat_id, situation_id, step_id, remind_at)
        DO UPDATE SET text = EXCLUDED.text, updated_at = now()
        RETURNING *, (xmax = 0) AS inserted
      `,
      [id, normalizeChatId(input.chatId), input.situationId, input.stepId, input.remindAt, input.text]
    );

    return {
      reminder: mapRow(result.rows[0]),
      created: Boolean(result.rows[0].inserted)
    };
  }

  async get(id: string) {
    await this.ready;
    const result = await this.pool.query('SELECT * FROM reminders WHERE id = $1', [id]);
    return result.rowCount ? mapRow(result.rows[0]) : null;
  }

  async cancel(id: string) {
    await this.ready;
    const result = await this.pool.query(
      "UPDATE reminders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status <> 'cancelled'",
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export class MemoryReminderRepository implements ReminderRepository {
  private readonly reminders = new Map<string, ReminderRecord>();

  async upsert(input: ReminderInput) {
    const id = makeReminderId(input);
    const now = new Date().toISOString();
    const existing = this.reminders.get(id);
    if (existing) {
      const reminder = { ...existing, text: input.text, updatedAt: now };
      this.reminders.set(id, reminder);
      return { reminder, created: false };
    }

    const reminder: ReminderRecord = {
      ...input,
      chatId: input.chatId,
      id,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    this.reminders.set(id, reminder);
    return { reminder, created: true };
  }

  async get(id: string) {
    return this.reminders.get(id) ?? null;
  }

  async cancel(id: string) {
    const existing = this.reminders.get(id);
    if (!existing) {
      return false;
    }
    this.reminders.set(id, { ...existing, status: 'cancelled', updatedAt: new Date().toISOString() });
    return true;
  }
}

export function createReminderRepository(): ReminderRepository {
  if (process.env.REMINDERS_STORAGE === 'memory' || !process.env.DATABASE_URL) {
    return new MemoryReminderRepository();
  }
  return new PostgresReminderRepository();
}
