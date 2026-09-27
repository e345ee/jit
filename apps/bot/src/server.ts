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
const miniAppContactId = process.env.MAX_MINI_APP_CONTACT_ID;
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

function miniAppPayloadForTarget(target: { chatId?: string | number; userId?: string | number }) {
  if (target.chatId) {
    return `chat_${target.chatId}`;
  }
  if (target.userId) {
    return `user_${target.userId}`;
  }
  return undefined;
}

type BotDiagnostics = {
  webhookReceived: number;
  webhookAccepted: number;
  webhookRejected: number;
  webhookDuplicates: number;
  repliesSent: number;
  replyFailures: number;
  lastWebhookAt?: string;
  lastAcceptedAt?: string;
  lastRejectedAt?: string;
  lastReplySentAt?: string;
  lastReplyFailureAt?: string;
  lastUpdateType?: string;
  lastTargetType?: 'chat' | 'user';
  lastError?: string;
};

function isoNow() {
  return new Date().toISOString();
}

export function buildServer() {
  validateStartupConfig();
  const diagnostics: BotDiagnostics = {
    webhookReceived: 0,
    webhookAccepted: 0,
    webhookRejected: 0,
    webhookDuplicates: 0,
    repliesSent: 0,
    replyFailures: 0
  };

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
    if (request.url.startsWith('/webhook')) {
      diagnostics.webhookRejected += 1;
      diagnostics.lastRejectedAt = isoNow();
      diagnostics.lastError = error instanceof z.ZodError ? 'validation_error' : publicError(error).message;
    }
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
    maxTokenConfigured: Boolean(token),
    diagnostics
  }));

  app.get('/me', async (request, reply) => {
    if (!max) {
      return reply.code(500).send({ error: 'MAX_BOT_TOKEN is not configured' });
    }
    return max.getMe();
  });

  app.post('/webhook', async (request, reply) => {
    diagnostics.webhookReceived += 1;
    diagnostics.lastWebhookAt = isoNow();
    if (webhookSecret) {
      const receivedSecret = request.headers['x-max-bot-api-secret'];
      if (receivedSecret !== webhookSecret) {
        diagnostics.webhookRejected += 1;
        diagnostics.lastRejectedAt = isoNow();
        diagnostics.lastError = 'invalid_webhook_secret';
        request.log.warn('rejected webhook with invalid secret');
        return reply.code(401).send({ error: 'invalid_webhook_secret' });
      }
    }

    const update = maxUpdateSchema.parse(request.body);
    const dedupKey = getUpdateDedupKey(update);
    if (hasSeenUpdate(dedupKey)) {
      diagnostics.webhookDuplicates += 1;
      request.log.info({ dedupKey }, 'duplicate webhook update ignored');
      return { ok: true, duplicate: true };
    }

    if (!max) {
      diagnostics.webhookAccepted += 1;
      diagnostics.lastAcceptedAt = isoNow();
      diagnostics.lastUpdateType = update.update_type;
      diagnostics.lastError = 'missing_token';
      request.log.warn('MAX_BOT_TOKEN is not configured; update accepted but no reply sent');
      rememberUpdate(dedupKey);
      return { ok: true, skipped: 'missing_token' };
    }

    const target = getChatTarget(update);
    if (!target.chatId && !target.userId) {
      diagnostics.webhookRejected += 1;
      diagnostics.lastRejectedAt = isoNow();
      diagnostics.lastUpdateType = update.update_type;
      diagnostics.lastError = 'chat_or_user_id_required';
      return reply.code(400).send({ error: 'chat_or_user_id_required' });
    }
    diagnostics.webhookAccepted += 1;
    diagnostics.lastAcceptedAt = isoNow();
    diagnostics.lastUpdateType = update.update_type;
    diagnostics.lastTargetType = target.chatId ? 'chat' : 'user';
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
      try {
        await max.sendMessage({
          ...target,
          miniAppNativeRef,
          miniAppContactId,
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
        diagnostics.repliesSent += 1;
        diagnostics.lastReplySentAt = isoNow();
        delete diagnostics.lastError;
      } catch (error) {
        diagnostics.replyFailures += 1;
        diagnostics.lastReplyFailureAt = isoNow();
        diagnostics.lastError = publicError(error).message;
        throw error;
      }
      rememberUpdate(dedupKey);
      return { ok: true };
    }

    const messageText = getMessageText(update);
    if (messageText) {
      try {
        await max.sendMessage({
          ...target,
          miniAppNativeRef,
          miniAppContactId,
          miniAppPayload: miniAppPayloadForTarget(target),
          text: await contentAdvisor.replyTo(messageText)
        });
        diagnostics.repliesSent += 1;
        diagnostics.lastReplySentAt = isoNow();
        delete diagnostics.lastError;
      } catch (error) {
        diagnostics.replyFailures += 1;
        diagnostics.lastReplyFailureAt = isoNow();
        diagnostics.lastError = publicError(error).message;
        throw error;
      }
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
