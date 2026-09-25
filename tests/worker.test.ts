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
  it('delivers and marks due reminders as sent after processing', async () => {
    const fake = createFakePool([
      {
        id: 'r1',
        chat_id: 'chat:123',
        situation_id: 'mri-contrast',
        step_id: 'creatinine',
        remind_at: new Date('2026-09-26T09:00:00.000Z'),
        text: 'Напоминание: проверьте срок документа.'
      }
    ]);
    const deliver = vi.fn(async () => ({ status: 'sent' as const, targetType: 'chat' as const }));

    await processDueReminders(fake.pool as never, 10, deliver);

    expect(fake.pool.connect).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', chat_id: 'chat:123' }));
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'));
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE reminders SET status = 'sent'"), ['r1']);
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it('does not update anything when no reminders are due', async () => {
    const fake = createFakePool([]);
    const deliver = vi.fn(async () => ({ status: 'sent' as const, targetType: 'chat' as const }));
    await processDueReminders(fake.pool as never, 10, deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(fake.calls.filter((sql) => sql.includes("UPDATE reminders SET status = 'sent'"))).toHaveLength(0);
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
  });

  it('keeps due reminders pending when delivery fails', async () => {
    const fake = createFakePool([
      {
        id: 'r1',
        chat_id: 'chat:123',
        situation_id: 'mri-contrast',
        step_id: 'creatinine',
        remind_at: new Date('2026-09-26T09:00:00.000Z'),
        text: 'Напоминание: проверьте срок документа.'
      }
    ]);
    const deliver = vi.fn(async () => {
      throw new Error('MAX unavailable');
    });

    await processDueReminders(fake.pool as never, 10, deliver);

    expect(fake.calls.filter((sql) => sql.includes("UPDATE reminders SET status = 'sent'"))).toHaveLength(0);
    expect(fake.client.query).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
  });
});
