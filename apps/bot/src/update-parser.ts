import { z } from 'zod';

const userSchema = z.object({
  user_id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  username: z.string().optional()
}).passthrough();

const recipientSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  chat_type: z.string().optional()
}).passthrough();

export const maxUpdateSchema = z.object({
  update_type: z.string(),
  timestamp: z.number().optional(),
  chat_id: z.union([z.string(), z.number()]).optional(),
  user: userSchema.optional(),
  payload: z.string().nullable().optional(),
  message: z.object({
    sender: userSchema.optional(),
    recipient: recipientSchema.optional(),
    body: z.object({
      text: z.string().optional(),
      mid: z.string().optional()
    }).passthrough().optional()
  }).passthrough().optional()
}).passthrough();

export type MaxUpdate = z.infer<typeof maxUpdateSchema>;

export function shouldWelcome(update: MaxUpdate) {
  const text = update.message?.body?.text?.trim().toLowerCase();
  return update.update_type === 'bot_started' || text === 'старт' || text?.startsWith('/start');
}

export function getMessageText(update: MaxUpdate) {
  return update.message?.body?.text?.trim() ?? '';
}

export function getChatTarget(update: MaxUpdate) {
  const recipient = update.message?.recipient;
  const sender = update.message?.sender;
  const chatId = update.chat_id ?? recipient?.chat_id;
  const userId = recipient?.chat_type === 'dialog' ? sender?.user_id : update.user?.user_id ?? sender?.user_id;

  return {
    chatId,
    userId
  };
}

export function getUpdateDedupKey(update: MaxUpdate) {
  const messageId = update.message?.body?.mid;
  if (messageId) {
    return `message:${messageId}`;
  }

  return [
    update.update_type,
    update.timestamp ?? 'no-ts',
    update.chat_id ?? update.user?.user_id ?? 'no-target',
    update.payload ?? '',
    update.message?.body?.text ?? ''
  ].join('|');
}
