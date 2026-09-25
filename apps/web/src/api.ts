import type { KnowledgeCard, SituationCard } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const RETRY_DELAYS_MS = [150, 450];

function readCache<T>(cacheKey?: string) {
  if (!cacheKey) return null;
  try {
    const raw = localStorage.getItem(cacheKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(cacheKey: string | undefined, value: T) {
  if (!cacheKey) return;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(value));
  } catch {
    // Cache is best-effort only.
  }
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, cacheKey?: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}${path}`);
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      const data = (await response.json()) as T;
      writeCache(cacheKey, data);
      return data;
    } catch (error) {
      lastError = error;
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (delayMs) {
        await delay(delayMs);
      }
    }
  }

  const cached = readCache<T>(cacheKey);
  if (cached) {
    return cached;
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export function loadSituations(query = '') {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return request<SituationCard[]>(`/situations${params}`, `navigator:cache:situations:${query}`);
}

export function loadKnowledge(query = '') {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return request<KnowledgeCard[]>(`/knowledge${params}`, `navigator:cache:knowledge:${query}`);
}

export async function createReminder(payload: {
  chatId?: string;
  situationId: string;
  stepId: string;
  remindAt: string;
  text: string;
}) {
  const response = await fetch(`${API_URL}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Reminder failed: ${response.status}`);
  }

  return response.json();
}

export async function cancelReminder(id: string) {
  const response = await fetch(`${API_URL}/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Reminder cancel failed: ${response.status}`);
  }

  return response.json();
}
