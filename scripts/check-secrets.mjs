import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((file) => file !== '.env.example');

const secretPatterns = [
  {
    name: 'real MAX_BOT_TOKEN assignment',
    regex: /MAX_BOT_TOKEN\s*=\s*(?!CHANGE_ME|your[-_]|placeholder|example)[A-Za-z0-9_-]{20,}/i
  },
  {
    name: 'real MAX webhook secret assignment',
    regex: /MAX_WEBHOOK_SECRET\s*=\s*(?!CHANGE_ME|your[-_]|placeholder|example)[A-Za-z0-9_-]{20,}/i
  }
];

let failed = false;

for (const file of files) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const pattern of secretPatterns) {
    if (pattern.regex.test(text)) {
      failed = true;
      console.error(`${file}: potential ${pattern.name}`);
    }
  }
}

if (failed) {
  console.error('Potential secret found in repository files.');
  process.exit(1);
}

console.log('No repository secrets detected.');
