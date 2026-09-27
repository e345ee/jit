export interface SendMessageOptions {
  chatId?: string | number;
  userId?: string | number;
  text: string;
  miniAppNativeRef?: string;
  miniAppPayload?: string;
}

const DEFAULT_MAX_API_URL = 'https://platform-api2.max.ru';
const MAX_LINK_PREFIX = 'https://max.ru/';

function normalizeMaxBotLink(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^https:\/\/max\.ru\//i.test(trimmed)) return trimmed.replace(/\?.*$/, '');
  if (/^https?:\/\//i.test(trimmed)) return undefined;
  return `${MAX_LINK_PREFIX}${trimmed.replace(/^@/, '')}`;
}

function appendStartAppPayload(botLink: string, payload?: string) {
  const suffix = payload ? `=${encodeURIComponent(payload)}` : '';
  return `${botLink}?startapp${suffix}`;
}

export class MaxClient {
  private readonly token: string;
  private readonly apiUrl: string;

  constructor(token: string, apiUrl = process.env.MAX_API_URL ?? DEFAULT_MAX_API_URL) {
    this.token = token;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async getMe() {
    const response = await fetch(`${this.apiUrl}/me`, {
      headers: this.headers()
    });

    if (!response.ok) {
      throw new Error(`MAX /me failed with ${response.status}`);
    }

    return response.json();
  }

  async sendMessage(options: SendMessageOptions) {
    const target = options.chatId
      ? `chat_id=${encodeURIComponent(String(options.chatId))}`
      : `user_id=${encodeURIComponent(String(options.userId))}`;
    const miniAppBotLink = normalizeMaxBotLink(options.miniAppNativeRef);
    const miniAppButtons = options.miniAppNativeRef || options.miniAppPayload
      ? [
          [
            {
              type: 'open_app',
              text: 'Открыть в MAX',
              ...(miniAppBotLink ? { web_app: miniAppBotLink } : {}),
              ...(options.miniAppPayload ? { payload: options.miniAppPayload } : {})
            }
          ],
          ...(miniAppBotLink
            ? [
                [
                  {
                    type: 'link',
                    text: 'Открыть ссылкой',
                    url: appendStartAppPayload(miniAppBotLink, options.miniAppPayload)
                  }
                ]
              ]
            : [])
        ]
      : undefined;

    const body = {
      text: options.text,
      format: 'markdown',
      attachments: miniAppButtons
        ? [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: miniAppButtons
              }
            }
          ]
        : undefined
    };

    const response = await fetch(`${this.apiUrl}/messages?${target}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MAX /messages failed with ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  private headers() {
    return {
      Authorization: this.token
    };
  }
}
