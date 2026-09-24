import { readFile } from 'node:fs/promises';

const requiredDockerIgnore = ['.env', '.env.*', 'secrets', 'node_modules', '.git'];
const dockerignore = await readFile('.dockerignore', 'utf8');
const missingDockerIgnore = requiredDockerIgnore.filter((entry) => !dockerignore.split(/\r?\n/).includes(entry));
if (missingDockerIgnore.length > 0) {
  throw new Error(`.dockerignore misses: ${missingDockerIgnore.join(', ')}`);
}

const nginx = await readFile('apps/web/nginx.conf', 'utf8');
const requiredHeaders = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy'
];
const missingHeaders = requiredHeaders.filter((header) => !nginx.includes(header));
if (missingHeaders.length > 0) {
  throw new Error(`nginx.conf misses headers: ${missingHeaders.join(', ')}`);
}

const envExample = await readFile('.env.example', 'utf8');
if (envExample.includes('MAX_BOT_TOKEN=') && !envExample.includes('replace_with_hackathon_token_locally')) {
  throw new Error('.env.example should contain placeholders only');
}

const openapi = await readFile('openapi.yaml', 'utf8');
for (const path of ['/health', '/ready', '/content/version', '/situations', '/knowledge', '/reminders']) {
  if (!openapi.includes(path)) {
    throw new Error(`openapi.yaml misses ${path}`);
  }
}

console.log('project audit passed');
