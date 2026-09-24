import { z } from 'zod';

export const sourceRefSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  type: z.enum(['official', 'clinic', 'law', 'faq', 'synthetic']),
  actualOn: z.string().min(10)
});

export const decisionQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.literal('single'),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().min(1),
    note: z.string().optional()
  })).min(2)
});

export const situationStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  why: z.string().min(1),
  whereToGet: z.array(z.string().min(1)).min(1),
  validFor: z.string().optional(),
  commonMistakes: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).optional(),
  conditions: z.record(z.array(z.string())).optional()
});

export const situationCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  shortDescription: z.string().min(1),
  region: z.string().min(1),
  dataStatus: z.enum(['official', 'clinic', 'synthetic']),
  actualOn: z.string().min(10),
  reviewBefore: z.string().min(10),
  disclaimer: z.string().min(1),
  keywords: z.array(z.string().min(1)),
  decisionQuestions: z.array(decisionQuestionSchema),
  steps: z.array(situationStepSchema).min(1),
  knowledgeLinks: z.array(z.string()),
  sources: z.array(sourceRefSchema).min(1)
});

export const knowledgeCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)),
  sources: z.array(sourceRefSchema).min(1),
  actualOn: z.string().min(10),
  dataStatus: z.enum(['official', 'clinic', 'synthetic'])
});

