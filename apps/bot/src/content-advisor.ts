interface SituationStep {
  title: string;
  summary: string;
}

interface SituationCard {
  title: string;
  shortDescription: string;
  actualOn: string;
  dataStatus: string;
  disclaimer: string;
  steps: SituationStep[];
}

interface KnowledgeCard {
  title: string;
  summary: string;
  body: string[];
  actualOn: string;
  dataStatus: string;
}

const DEFAULT_CONTENT_API_URL = 'http://localhost:3001';

function normalizeQuery(text: string) {
  return text
    .replace(/^\/\w+\s*/u, '')
    .trim()
    .slice(0, 80);
}

function isHelpQuery(text: string) {
  const normalized = text.trim().toLowerCase();
  return normalized === '/help' || normalized === 'помощь' || normalized === 'что умеешь';
}

function fallbackText() {
  return [
    '**Навигатор для пациента**',
    '',
    'Напишите ситуацию или документ: МРТ, КТ, МСЭ, вычет, госпитализация, льготные лекарства.',
    'Я верну короткий маршрут, сроки и ссылку на подробную карточку.',
    '',
    'Я не ставлю диагнозы, не интерпретирую анализы и не заменяю врача.'
  ].join('\n');
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Content API failed with ${response.status}`);
    }
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export class ContentAdvisor {
  private readonly apiUrl: string;

  constructor(apiUrl = process.env.CONTENT_API_URL ?? process.env.API_PUBLIC_URL ?? DEFAULT_CONTENT_API_URL) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async replyTo(rawText: string) {
    if (isHelpQuery(rawText)) {
      return fallbackText();
    }

    const query = normalizeQuery(rawText);
    if (query.length < 2) {
      return fallbackText();
    }

    const encoded = encodeURIComponent(query);
    try {
      const [situations, knowledge] = await Promise.all([
        fetchJson<SituationCard[]>(`${this.apiUrl}/situations?q=${encoded}`),
        fetchJson<KnowledgeCard[]>(`${this.apiUrl}/knowledge?q=${encoded}`)
      ]);

      if (situations[0]) {
        return this.formatSituation(situations[0], situations.slice(1, 4));
      }

      if (knowledge[0]) {
        return this.formatKnowledge(knowledge[0]);
      }

      return [
        'Пока не нашел точную карточку.',
        '',
        'Попробуйте: МРТ с контрастом, КТ, МСЭ, налоговый вычет, госпитализация, льготные лекарства.',
        '',
        'В mini app можно открыть весь справочник и поиск.'
      ].join('\n');
    } catch {
      return [
        'Не смог быстро получить справочник из API.',
        '',
        'Mini app остается доступным по кнопке ниже. Там можно открыть карточки и локальный чек-лист.'
      ].join('\n');
    }
  }

  private formatSituation(card: SituationCard, more: SituationCard[]) {
    const steps = card.steps
      .slice(0, 5)
      .map((step, index) => `${index + 1}. ${step.title} — ${step.summary}`)
      .join('\n');
    const moreLine = more.length ? `\n\nЕще рядом: ${more.map((item) => item.title).join(', ')}.` : '';

    return [
      `**${card.title}**`,
      card.shortDescription,
      '',
      '**Что сделать:**',
      steps,
      '',
      `Актуально: ${card.actualOn}. Статус данных: ${card.dataStatus}.`,
      card.disclaimer,
      moreLine,
      '',
      'Подробности, вопросы и чек-лист — в mini app.'
    ].join('\n');
  }

  private formatKnowledge(card: KnowledgeCard) {
    return [
      `**${card.title}**`,
      card.summary,
      '',
      ...card.body.slice(0, 3),
      '',
      `Актуально: ${card.actualOn}. Статус данных: ${card.dataStatus}.`
    ].join('\n');
  }
}

export function createContentAdvisor() {
  return new ContentAdvisor();
}
