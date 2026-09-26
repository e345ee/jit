import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildServer } from '../apps/api/src/server.js';
import { MemoryReminderRepository } from '../apps/api/src/reminder-repository.js';

let app: FastifyInstance | null = null;

function createApp() {
  app = buildServer(new MemoryReminderRepository());
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  delete process.env.MAX_BOT_TOKEN;
  delete process.env.MAX_INIT_DATA_MAX_AGE_SECONDS;
});

function createMaxInitData(token: string, values: Record<string, string>) {
  const launchParams = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(launchParams).digest('hex');
  return new URLSearchParams({ ...values, hash }).toString();
}

describe('navigator api', () => {
  it('returns health and content version', async () => {
    const server = createApp();

    const health = await server.inject('/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', service: 'navigator-api' });

    const ready = await server.inject('/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', service: 'navigator-api' });

    const version = await server.inject('/content/version');
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ dataStatus: 'mixed', situations: 72, knowledge: 146 });
  });

  it('searches situations and knowledge', async () => {
    const server = createApp();

    const situations = await server.inject('/situations?q=%D0%9C%D0%A0%D0%A2');
    expect(situations.statusCode).toBe(200);
    expect(situations.json().map((item: { id: string }) => item.id)).toContain('mri-contrast');

    const knowledge = await server.inject('/knowledge?q=%D0%9C%D0%A1%D0%AD');
    expect(knowledge.statusCode).toBe(200);
    expect(knowledge.json().length).toBeGreaterThan(0);

    const oms = await server.inject('/situations?q=%D0%BE%D0%BC%D1%81');
    expect(oms.statusCode).toBe(200);
    expect(oms.json().map((item: { id: string }) => item.id)).toContain('oms-policy-update');
  });

  it('creates idempotent neutral reminders', async () => {
    const server = createApp();
    const payload = {
      situationId: 'mri-contrast',
      stepId: 'creatinine',
      remindAt: '2026-09-26T09:00:00.000Z',
      text: 'Напоминание: проверьте срок документа.'
    };

    const created = await server.inject({
      method: 'POST',
      url: '/reminders',
      payload
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ situationId: 'mri-contrast', stepId: 'creatinine', status: 'pending' });

    const duplicated = await server.inject({
      method: 'POST',
      url: '/reminders',
      payload
    });
    expect(duplicated.statusCode).toBe(200);
    expect(duplicated.json().id).toBe(created.json().id);

    const fetched = await server.inject(`/reminders/${created.json().id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().text).toBe(payload.text);

    const cancelled = await server.inject({
      method: 'DELETE',
      url: `/reminders/${created.json().id}`
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ ok: true });
  });

  it('returns predictable errors for missing cards and unsafe reminders', async () => {
    const server = createApp();

    const missing = await server.inject('/situations/not-found');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'situation_not_found' });

    const invalidReminder = await server.inject({
      method: 'POST',
      url: '/reminders',
      payload: {
        situationId: 'mri-contrast',
        stepId: 'creatinine',
        remindAt: '2026-09-26T09:00:00.000Z',
        text: 'Напоминание: проверьте диагноз.'
      }
    });
    expect(invalidReminder.statusCode).toBe(400);
    expect(invalidReminder.json()).toMatchObject({ error: 'validation_error' });
  });

  it('validates signed MAX mini app sessions', async () => {
    process.env.MAX_BOT_TOKEN = 'test-token';
    process.env.MAX_INIT_DATA_MAX_AGE_SECONDS = String(365 * 24 * 60 * 60);
    const server = createApp();
    const initData = createMaxInitData('test-token', {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'query-1',
      start_param: 'chat_123',
      user: JSON.stringify({ id: 456, first_name: 'Max', last_name: 'User' })
    });

    const valid = await server.inject({
      method: 'POST',
      url: '/max/session',
      payload: { initData }
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({ ok: true, target: 'chat:123' });

    const invalid = await server.inject({
      method: 'POST',
      url: '/max/session',
      payload: { initData: initData.replace('chat_123', 'chat_999') }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({ ok: false, error: 'invalid_max_session' });
  });
});
