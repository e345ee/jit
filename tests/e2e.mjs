import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from '@playwright/test';

const API_PORT = 3201;
const WEB_PORT = 5174;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const rootDir = process.cwd();
const binDir = path.join(rootDir, 'node_modules', '.bin');

function start(command, args, env, cwd = process.cwd()) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const api = start(path.join(binDir, `tsx${binSuffix}`), ['apps/api/src/server.ts'], {
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    CORS_ORIGIN: WEB_URL,
    REMINDERS_STORAGE: 'memory',
    NODE_ENV: 'development'
  });
  const web = start(
    path.join(binDir, `vite${binSuffix}`),
    ['--host', '127.0.0.1', '--port', String(WEB_PORT)],
    { VITE_API_URL: API_URL },
    'apps/web'
  );

  try {
    await waitFor(`${API_URL}/health`);
    await waitFor(WEB_URL);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(WEB_URL);

    await page.getByPlaceholder('Документ, справка или ситуация').fill('СНИЛС');
    const snilsKnowledge = page.locator('.knowledgeItem').filter({ hasText: 'СНИЛС и где его получить' });
    await snilsKnowledge.waitFor();
    await snilsKnowledge.click();
    await page.getByRole('heading', { name: /СНИЛС/ }).waitFor();

    await page.getByPlaceholder('Документ, справка или ситуация').fill('МРТ');
    await page.getByRole('heading', { name: 'МРТ с контрастом' }).waitFor();
    await page.locator('.questions fieldset').nth(0).getByRole('button', { name: 'Да' }).click();
    await page.locator('.questions fieldset').nth(1).getByRole('button', { name: 'Нет' }).click();
    await page.getByRole('button', { name: 'Отметить шаг' }).first().click();
    await page.getByRole('button', { name: /Сдайте анализ на креатинин/ }).click();
    await page.getByRole('heading', { name: 'Где получить' }).waitFor();
    await page.getByRole('button', { name: 'Напомнить' }).first().click();
    await page.getByText('Напоминание создано без диагноза').waitFor();

    for (const query of ['полис', 'больничный', 'ребенок', 'переезд', 'льготы']) {
      await page.getByPlaceholder('Документ, справка или ситуация').fill(query);
      await page.locator('.resultItem, .knowledgeItem').first().waitFor();
    }

    await browser.close();
  } finally {
    api.kill('SIGTERM');
    web.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
