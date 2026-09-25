import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
});

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
});
