import { describe, expect, it, vi } from 'vitest';
import { processDueReminders } from '../apps/worker/src/worker.js';

function createFakePool(rows: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT id, chat_id')) {
        return { rows };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn()
  };

  return {
    calls,
    client,
    pool: {
      connect: vi.fn(async () => client)
    }
  };
}

describe('reminder worker', () => {
  it('marks due reminders as sent after processing', async () => {
    const fake = createFakePool([
      {
        id: 'r1',
        chat_id: 'local',
        situation_id: 'mri-contrast',
        step_id: 'creatinine',
        remind_at: new Date('2026-09-26T09:00:00.000Z'),
        text: 'Напоминание: проверьте срок документа.'
      }
    ]);

    await processDueReminders(fake.pool as never, 10);

    expect(fake.pool.connect).toHaveBeenCalledOnce();
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'));
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE reminders SET status = 'sent'"), ['r1']);
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it('does not update anything when no reminders are due', async () => {
    const fake = createFakePool([]);
    await processDueReminders(fake.pool as never, 10);

    expect(fake.calls.filter((sql) => sql.includes("UPDATE reminders SET status = 'sent'"))).toHaveLength(0);
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
  });
});
