import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ContentStore } from './content-store.js';
import { createReminderRepository, type ReminderRepository } from './reminder-repository.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const store = new ContentStore();

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

const FORBIDDEN_REMINDER_WORDS = [
  'диагноз',
  'анализ крови',
  'результат анализа',
  'онколог',
  'онкология',
  'рак',
  'вич',
  'спид',
  'беременность',
  'инвалидность',
  'операция',
  'лечение',
  'лекарство'
];

function isNeutralReminderText(text: string) {
  const normalized = text.toLowerCase();
  return !FORBIDDEN_REMINDER_WORDS.some((word) => normalized.includes(word));
}

const reminderSchema = z.object({
  chatId: z.string().optional(),
  situationId: z.string().min(1),
  stepId: z.string().min(1),
  remindAt: z.string().min(1),
  text: z.string().min(1).max(240)
    .refine(isNeutralReminderText, 'Reminder text must stay neutral and avoid medical details')
});

const maxSessionSchema = z.object({
  initData: z.string().min(1).max(8192)
});

function normalizeMaxTarget(value: string | undefined) {
  if (!value) return undefined;
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/^(chat|user)[:_-]([\w.-]+)$/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function getMaxSessionTarget(params: Map<string, string>) {
  const startTarget = normalizeMaxTarget(params.get('start_param'));
  if (startTarget) return startTarget;

  const chat = params.get('chat');
  if (chat) {
    try {
      const parsed = JSON.parse(chat) as { id?: string | number };
      if (parsed.id) return `chat:${parsed.id}`;
    } catch {
      return undefined;
    }
  }

  const user = params.get('user');
  if (user) {
    try {
      const parsed = JSON.parse(user) as { id?: string | number };
      if (parsed.id) return `user:${parsed.id}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function validateMaxInitData(initData: string, token: string) {
  const pairs = initData.split('&').map((item) => {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex < 0) return [item, ''] as const;
    return [item.slice(0, separatorIndex), item.slice(separatorIndex + 1)] as const;
  });

  const keys = new Set<string>();
  for (const [key] of pairs) {
    if (keys.has(key)) return null;
    keys.add(key);
  }

  const hashPair = pairs.find(([key]) => key === 'hash');
  if (!hashPair?.[1]) return null;

  const params = new Map<string, string>();
  for (const [key, value] of pairs) {
    params.set(key, decodeURIComponent(value));
  }

  const authDate = Number(params.get('auth_date'));
  const maxAgeSeconds = Number(process.env.MAX_INIT_DATA_MAX_AGE_SECONDS ?? 24 * 60 * 60);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const launchParams = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const expectedHash = createHmac('sha256', secretKey).update(launchParams).digest('hex');
  const originalHash = params.get('hash') ?? '';
  const expected = Buffer.from(expectedHash, 'hex');
  const original = Buffer.from(originalHash, 'hex');
  if (expected.length !== original.length || !timingSafeEqual(expected, original)) {
    return null;
  }

  return {
    target: getMaxSessionTarget(params),
    authDate,
    user: params.get('user') ? JSON.parse(params.get('user') as string) : undefined,
    chat: params.get('chat') ? JSON.parse(params.get('chat') as string) : undefined
  };
}

function publicError(error: unknown) {
  const maybeError = error as { statusCode?: number; message?: string };
  const statusCode = typeof maybeError.statusCode === 'number' ? maybeError.statusCode : 500;
  return {
    statusCode,
    message: typeof maybeError.message === 'string' ? maybeError.message : 'internal_error'
  };
}

export function buildServer(reminderRepository: ReminderRepository = createReminderRepository()) {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie']
    }
  });

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute'
  });

  app.register(cors, {
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    origin: (origin, callback) => {
      const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:8080')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed'), false);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ error }, 'request failed');
    if (error instanceof z.ZodError) {
      reply.code(400).send({ error: 'validation_error', issues: error.issues });
      return;
    }

    const publicErrorInfo = publicError(error);
    reply.code(publicErrorInfo.statusCode < 500 ? publicErrorInfo.statusCode : 500).send({
      error: publicErrorInfo.statusCode < 500 ? publicErrorInfo.message : 'internal_error'
    });
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'navigator-api'
  }));

  app.get('/ready', async (request, reply) => {
    try {
      const version = await store.getVersion();
      return {
        status: 'ready',
        service: 'navigator-api',
        content: version
      };
    } catch {
      return reply.code(503).send({
        status: 'not_ready',
        service: 'navigator-api',
        reason: 'content_unavailable'
      });
    }
  });

  app.get('/content/version', async () => ({
    ...(await store.getVersion()),
    commit: process.env.COMMIT_SHA ?? process.env.GIT_COMMIT ?? 'local'
  }));

  app.post('/max/session', async (request, reply) => {
    const token = readSecret('MAX_BOT_TOKEN');
    if (!token) {
      return reply.code(503).send({ ok: false, error: 'max_token_not_configured' });
    }

    const payload = maxSessionSchema.parse(request.body);
    const session = validateMaxInitData(payload.initData, token);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'invalid_max_session' });
    }

    return {
      ok: true,
      target: session.target,
      authDate: session.authDate
    };
  });

  app.get('/situations', async (request) => {
    const querySchema = z.object({ q: z.string().optional() });
    const query = querySchema.parse(request.query);
    return store.listSituations(query.q);
  });

  app.get('/situations/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const situation = await store.getSituation(params.id);
    if (!situation) {
      return reply.code(404).send({ error: 'situation_not_found' });
    }
    return situation;
  });

  app.get('/knowledge', async (request) => {
    const querySchema = z.object({ q: z.string().optional() });
    const query = querySchema.parse(request.query);
    return store.listKnowledge(query.q);
  });

  app.post('/reminders', async (request, reply) => {
    const payload = reminderSchema.parse(request.body);
    const result = await reminderRepository.upsert(payload);
    return reply.code(result.created ? 201 : 200).send(result.reminder);
  });

  app.get('/reminders/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const reminder = await reminderRepository.get(params.id);
    if (!reminder) {
      return reply.code(404).send({ error: 'reminder_not_found' });
    }
    return reminder;
  });

  app.delete('/reminders/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const deleted = await reminderRepository.cancel(params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'reminder_not_found' });
    }
    return { ok: true };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = buildServer();
  const close = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down api');
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
