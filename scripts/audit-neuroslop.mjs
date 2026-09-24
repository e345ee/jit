import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const extensions = new Set(['.md', '.json', '.ts', '.tsx', '.js', '.mjs', '.css', '.yaml', '.yml']);

const banned = [
  {
    id: 'fake-ngrok-placeholder',
    pattern: /example\.ngrok-free\.app/i,
    message: 'Use replace_with_* or a real URL; fake ngrok values look operational.'
  },
  {
    id: 'todo-final-demo',
    pattern: /TODO before final demo/i,
    message: 'Use an explicit checklist/status instead of TODO phrasing.'
  },
  {
    id: 'pretend-reminder-send',
    pattern: /would send reminder/i,
    message: 'Demo delivery must be named as disabled, not as pretend sending.'
  },
  {
    id: 'generic-ai-transition',
    pattern: /важно отметить|следует отметить|стоит отметить|in today'?s rapidly evolving landscape/i,
    message: 'Remove generic transition filler.'
  }
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const findings = [];
for (const file of await walk('.')) {
  if (file === 'scripts/audit-neuroslop.mjs') continue;
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of banned) {
      if (rule.pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          rule: rule.id,
          message: rule.message
        });
      }
    }
  });
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.rule} - ${finding.message}`);
  }
  process.exit(1);
}

console.log('neuroslop audit passed');
