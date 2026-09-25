import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { knowledgeCardSchema, situationCardSchema } from '../packages/shared/src/schemas.js';

const contentDir = path.resolve('content');

async function readJsonFiles<T>(folder: string, parse: (value: unknown) => T) {
  const dir = path.join(contentDir, folder);
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  const parsed = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(dir, file), 'utf8');
      return parse(JSON.parse(raw));
    })
  );
  return { files, parsed };
}

describe('content catalog', () => {
  it('validates all situation cards and required source metadata', async () => {
    const { files, parsed } = await readJsonFiles('situations', (value) => situationCardSchema.parse(value));
    const knowledge = await readJsonFiles('knowledge', (value) => knowledgeCardSchema.parse(value));
    const knowledgeIds = new Set(knowledge.parsed.map((card) => card.id));

    expect(files.length).toBeGreaterThanOrEqual(72);
    expect(parsed.some((card) => card.id === 'mri-contrast')).toBe(true);

    for (const card of parsed) {
      expect(card.sources.length).toBeGreaterThan(0);
      expect(card.actualOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(card.reviewBefore).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(card.reviewBefore >= card.actualOn).toBe(true);
      expect(card.disclaimer.toLowerCase()).toContain('не заменяет');
      expect(card.steps.length).toBeGreaterThanOrEqual(3);
      for (const link of card.knowledgeLinks) {
        expect(knowledgeIds.has(link), `${card.id} links missing knowledge card ${link}`).toBe(true);
      }
      for (const source of card.sources) {
        if (source.url) {
          expect(() => new URL(source.url)).not.toThrow();
        }
      }

      for (const step of card.steps) {
        expect(step.why.length).toBeGreaterThan(20);
        expect(step.commonMistakes.length).toBeGreaterThan(0);
        expect(step.sourceIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('validates all knowledge cards', async () => {
    const { files, parsed } = await readJsonFiles('knowledge', (value) => knowledgeCardSchema.parse(value));

    expect(files.length).toBeGreaterThanOrEqual(146);
    expect(parsed.some((card) => card.id === 'oms-dms')).toBe(true);
    expect(parsed.some((card) => card.id === 'snils')).toBe(true);
    expect(parsed.some((card) => card.id === 'electronic-sick-leave')).toBe(true);
    expect(parsed.some((card) => card.id === 'medical-tax-certificate')).toBe(true);

    for (const card of parsed) {
      expect(card.sources.length).toBeGreaterThan(0);
      expect(card.body.length).toBeGreaterThan(0);
      expect(card.actualOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const source of card.sources) {
        if (source.url) {
          expect(() => new URL(source.url)).not.toThrow();
        }
      }
    }
  });
});
