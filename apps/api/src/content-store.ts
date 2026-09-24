import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  knowledgeCardSchema,
  situationCardSchema,
  type KnowledgeCard,
  type SituationCard
} from '@navigator/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultContentDir() {
  return path.resolve(__dirname, '../../../content');
}

export class ContentStore {
  private readonly contentDir: string;
  private situationsCache: SituationCard[] | null = null;
  private knowledgeCache: KnowledgeCard[] | null = null;

  constructor(contentDir = process.env.CONTENT_DIR ?? defaultContentDir()) {
    this.contentDir = contentDir;
  }

  async listSituations(query?: string) {
    const situations = await this.loadSituations();
    const normalized = query?.trim().toLowerCase();
    if (!normalized) {
      return situations;
    }

    return situations.filter((item) => {
      const haystack = [
        item.title,
        item.shortDescription,
        item.category,
        ...item.keywords,
        ...item.steps.flatMap((step) => [step.title, step.summary, ...step.commonMistakes])
      ].join(' ').toLowerCase();

      return haystack.includes(normalized);
    });
  }

  async getSituation(id: string) {
    const situations = await this.loadSituations();
    return situations.find((item) => item.id === id) ?? null;
  }

  async listKnowledge(query?: string) {
    const cards = await this.loadKnowledge();
    const normalized = query?.trim().toLowerCase();
    if (!normalized) {
      return cards;
    }

    return cards.filter((item) => {
      const haystack = [item.title, item.summary, ...item.body, ...item.tags].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  }

  async getVersion() {
    const situations = await this.loadSituations();
    const knowledge = await this.loadKnowledge();
    const dates = [...situations.map((item) => item.actualOn), ...knowledge.map((item) => item.actualOn)];

    return {
      version: dates.sort().at(-1) ?? 'unknown',
      situations: situations.length,
      knowledge: knowledge.length,
      dataStatus: 'mixed'
    };
  }

  private async loadSituations() {
    if (this.situationsCache) {
      return this.situationsCache;
    }

    const dir = path.join(this.contentDir, 'situations');
    const files = await readdir(dir);
    const cards = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          const raw = await readFile(path.join(dir, file), 'utf8');
          return situationCardSchema.parse(JSON.parse(raw));
        })
    );

    this.situationsCache = cards;
    return cards;
  }

  private async loadKnowledge() {
    if (this.knowledgeCache) {
      return this.knowledgeCache;
    }

    const dir = path.join(this.contentDir, 'knowledge');
    const files = await readdir(dir);
    const cards = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          const raw = await readFile(path.join(dir, file), 'utf8');
          return knowledgeCardSchema.parse(JSON.parse(raw));
        })
    );

    this.knowledgeCache = cards;
    return cards;
  }
}

