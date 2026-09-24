import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBotServer(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('../apps/bot/src/server.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.MAX_BOT_TOKEN;
  delete process.env.MAX_WEBHOOK_SECRET;
  delete process.env.MINI_APP_PUBLIC_URL;
  delete process.env.CONTENT_API_URL;
});

describe('max bot webhook', () => {
  it('rejects webhook requests with invalid secret', async () => {
    const { buildServer } = await loadBotServer({ MAX_WEBHOOK_SECRET: 'secret' });
    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-max-bot-api-secret': 'wrong' },
      payload: { update_type: 'message_created', message: { body: { text: '/start', mid: 'm1' } } }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'invalid_webhook_secret' });
    await app.close();
  });

  it('deduplicates repeated webhook updates', async () => {
    const { buildServer } = await loadBotServer({ MAX_WEBHOOK_SECRET: 'secret' });
    const app = buildServer();
    const payload = { update_type: 'message_created', message: { body: { text: 'МРТ', mid: 'same-mid' } } };

    const first = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-max-bot-api-secret': 'secret' },
      payload
    });
    const second = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-max-bot-api-secret': 'secret' },
      payload
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, skipped: 'missing_token' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, duplicate: true });
    await app.close();
  });

  it('sends welcome message with mini app button on start', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { buildServer } = await loadBotServer({
      MAX_BOT_TOKEN: 'token',
      MAX_WEBHOOK_SECRET: 'secret',
      MINI_APP_PUBLIC_URL: 'https://navigator.example.test'
    });
    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-max-bot-api-secret': 'secret' },
      payload: {
        update_type: 'message_created',
        chat_id: 123,
        message: { body: { text: '/start', mid: 'start-mid' } }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/messages?chat_id=123');
    expect(fetchMock.mock.calls[0][1]?.body).toContain('Открыть навигатор');
    await app.close();
  });
});
