import 'dotenv/config';
import { readFileSync } from 'node:fs';
import formBody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { z } from 'zod';
import { createContentAdvisor } from './content-advisor.js';
import { MaxClient } from './max-client.js';
import { getChatTarget, getMessageText, getUpdateDedupKey, maxUpdateSchema, shouldWelcome } from './update-parser.js';

const port = Number(process.env.BOT_PORT ?? process.env.PORT ?? 3002);
const host = process.env.HOST ?? '0.0.0.0';

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

const token = readSecret('MAX_BOT_TOKEN');
const miniAppUrl = process.env.MINI_APP_PUBLIC_URL ?? 'http://localhost:5173';
const miniAppNativeRef = process.env.MAX_MINI_APP_WEB_APP;
const webhookSecret = readSecret('MAX_WEBHOOK_SECRET');
const dedupTtlMs = Number(process.env.BOT_DEDUP_TTL_MS ?? 10 * 60 * 1000);
const seenUpdates = new Map<string, number>();

function validateStartupConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const problems = [];
  if (!token) problems.push('MAX_BOT_TOKEN is required in production');
  if (!webhookSecret) problems.push('MAX_WEBHOOK_SECRET is required in production');
  if (!miniAppUrl.startsWith('https://')) problems.push('MINI_APP_PUBLIC_URL must be HTTPS in production');
  if (miniAppUrl.includes('replace_with_') || miniAppUrl.includes('example.')) {
    problems.push('MINI_APP_PUBLIC_URL must not use a placeholder');
  }

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
}

function pruneSeenUpdates() {
  const now = Date.now();
  for (const [seenKey, seenAt] of seenUpdates) {
    if (now - seenAt > dedupTtlMs) {
      seenUpdates.delete(seenKey);
    }
  }
}

function hasSeenUpdate(key: string) {
  pruneSeenUpdates();
  return seenUpdates.has(key);
}

function rememberUpdate(key: string) {
  pruneSeenUpdates();
  seenUpdates.set(key, Date.now());
}

function publicError(error: unknown) {
  const maybeError = error as { statusCode?: number; message?: string };
  const statusCode = typeof maybeError.statusCode === 'number' ? maybeError.statusCode : 500;
  return {
    statusCode,
    message: typeof maybeError.message === 'string' ? maybeError.message : 'internal_error'
  };
}

function miniAppUrlForTarget(target: { chatId?: string | number; userId?: string | number }) {
  const url = new URL(miniAppUrl);
  if (target.chatId) {
    url.searchParams.set('maxTarget', `chat:${target.chatId}`);
  } else if (target.userId) {
    url.searchParams.set('maxTarget', `user:${target.userId}`);
  }
  return url.toString();
}

function miniAppPayloadForTarget(target: { chatId?: string | number; userId?: string | number }) {
  if (target.chatId) {
    return `chat:${target.chatId}`;
  }
  if (target.userId) {
    return `user:${target.userId}`;
  }
  return undefined;
}

export function buildServer() {
  validateStartupConfig();

  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.x-max-bot-api-secret']
    }
  });

  app.register(formBody);
  app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });
  app.register(rateLimit, {
    max: Number(process.env.BOT_RATE_LIMIT_MAX ?? 60),
    timeWindow: process.env.BOT_RATE_LIMIT_WINDOW ?? '1 minute'
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error }, 'bot request failed');
    if (error instanceof z.ZodError) {
      reply.code(400).send({ error: 'validation_error', issues: error.issues });
      return;
    }
    const publicErrorInfo = publicError(error);
    reply.code(publicErrorInfo.statusCode < 500 ? publicErrorInfo.statusCode : 500).send({
      error: publicErrorInfo.statusCode < 500 ? publicErrorInfo.message : 'internal_error'
    });
  });

  const max = token ? new MaxClient(token) : null;
  const contentAdvisor = createContentAdvisor();

  app.get('/health', async () => ({
    status: 'ok',
    service: 'navigator-bot',
    maxTokenConfigured: Boolean(token)
  }));

  app.get('/me', async (request, reply) => {
    if (!max) {
      return reply.code(500).send({ error: 'MAX_BOT_TOKEN is not configured' });
    }
    return max.getMe();
  });

  app.post('/webhook', async (request, reply) => {
    if (webhookSecret) {
      const receivedSecret = request.headers['x-max-bot-api-secret'];
      if (receivedSecret !== webhookSecret) {
        request.log.warn('rejected webhook with invalid secret');
        return reply.code(401).send({ error: 'invalid_webhook_secret' });
      }
    }

    const update = maxUpdateSchema.parse(request.body);
    const dedupKey = getUpdateDedupKey(update);
    if (hasSeenUpdate(dedupKey)) {
      request.log.info({ dedupKey }, 'duplicate webhook update ignored');
      return { ok: true, duplicate: true };
    }

    if (!max) {
      request.log.warn('MAX_BOT_TOKEN is not configured; update accepted but no reply sent');
      rememberUpdate(dedupKey);
      return { ok: true, skipped: 'missing_token' };
    }

    const target = getChatTarget(update);
    if (!target.chatId && !target.userId) {
      return reply.code(400).send({ error: 'chat_or_user_id_required' });
    }
    request.log.info(
      {
        updateType: update.update_type,
        dedupKey,
        targetType: target.chatId ? 'chat' : 'user',
        hasMessageText: Boolean(getMessageText(update))
      },
      'webhook update parsed'
    );

    if (shouldWelcome(update)) {
      await max.sendMessage({
        ...target,
        miniAppUrl: miniAppUrlForTarget(target),
        miniAppNativeRef,
        miniAppPayload: miniAppPayloadForTarget(target),
        text: [
          '**Навигатор для пациента**',
          '',
          'Помогу быстро собрать шаги, документы и сроки для медицинского маршрута.',
          'Напишите прямо в чат: МРТ, МСЭ, вычет, госпитализация или льготные лекарства.',
          'Для подробного маршрута откройте mini app.',
          '',
          'Я не ставлю диагнозы и не заменяю врача.'
        ].join('\n')
      });
      rememberUpdate(dedupKey);
      return { ok: true };
    }

    const messageText = getMessageText(update);
    if (messageText) {
      await max.sendMessage({
        ...target,
        miniAppUrl: miniAppUrlForTarget(target),
        miniAppNativeRef,
        miniAppPayload: miniAppPayloadForTarget(target),
        text: await contentAdvisor.replyTo(messageText)
      });
    }

    rememberUpdate(dedupKey);
    return { ok: true };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = buildServer();
  const close = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down bot');
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  app.listen({ port, host }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
