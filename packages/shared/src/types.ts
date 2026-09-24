export type DataStatus = 'official' | 'clinic' | 'synthetic';

export interface SourceRef {
  title: string;
  url?: string;
  type: 'official' | 'clinic' | 'law' | 'faq' | 'synthetic';
  actualOn: string;
}

export interface DecisionQuestion {
  id: string;
  text: string;
  type: 'single';
  options: Array<{
    value: string;
    label: string;
    note?: string;
  }>;
}

export interface SituationStep {
  id: string;
  title: string;
  summary: string;
  why: string;
  whereToGet: string[];
  validFor?: string;
  commonMistakes: string[];
  sourceIds: string[];
  tags?: string[];
  conditions?: Record<string, string[]>;
}

export interface SituationCard {
  id: string;
  title: string;
  category: string;
  shortDescription: string;
  region: string;
  dataStatus: DataStatus;
  actualOn: string;
  reviewBefore: string;
  disclaimer: string;
  keywords: string[];
  decisionQuestions: DecisionQuestion[];
  steps: SituationStep[];
  knowledgeLinks: string[];
  sources: SourceRef[];
}

export interface KnowledgeCard {
  id: string;
  title: string;
  summary: string;
  body: string[];
  tags: string[];
  sourceIds: string[];
  sources: SourceRef[];
  actualOn: string;
  dataStatus: DataStatus;
}

export interface ReminderRequest {
  chatId?: string;
  situationId: string;
  stepId: string;
  remindAt: string;
  text: string;
}

