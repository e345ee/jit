export interface SendMessageOptions {
  chatId?: string | number;
  userId?: string | number;
  text: string;
  miniAppUrl?: string;
}

const DEFAULT_MAX_API_URL = 'https://platform-api2.max.ru';

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

    const body = {
      text: options.text,
      format: 'markdown',
      attachments: options.miniAppUrl
        ? [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [
                  [
                    {
                      type: 'link',
                      text: 'Открыть навигатор',
                      url: options.miniAppUrl
                    }
                  ]
                ]
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
