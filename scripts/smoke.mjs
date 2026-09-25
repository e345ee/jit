const baseUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001';
const checks = [
  { id: 'health', path: '/health', expect: (json) => json.status === 'ok' },
  { id: 'ready', path: '/ready', expect: (json) => json.status === 'ready' },
  { id: 'version', path: '/content/version', expect: (json) => json.situations >= 72 && json.knowledge >= 145 },
  { id: 'mri-search', path: '/situations?q=%D0%9C%D0%A0%D0%A2', expect: (json) => json.some((item) => item.id === 'mri-contrast') },
  { id: 'oms-search', path: '/situations?q=%D0%BE%D0%BC%D1%81', expect: (json) => json.some((item) => item.id === 'oms-policy-update') },
  { id: 'snils-search', path: '/knowledge?q=%D0%A1%D0%9D%D0%98%D0%9B%D0%A1', expect: (json) => json.some((item) => item.id === 'snils') }
];

async function checkGet({ id, path, expect }) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${id} failed with HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!expect(json)) {
    throw new Error(`${id} returned unexpected payload`);
  }
  console.log(`ok ${id}`);
}

async function checkReminderGuard() {
  const response = await fetch(`${baseUrl}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      situationId: 'mri-contrast',
      stepId: 'creatinine',
      remindAt: '2026-09-26T09:00:00.000Z',
      text: 'Напоминание: проверьте диагноз.'
    })
  });
  if (response.status !== 400) {
    throw new Error(`reminder guard expected HTTP 400, got ${response.status}`);
  }
  console.log('ok reminder-guard');
}

for (const check of checks) {
  await checkGet(check);
}
await checkReminderGuard();
console.log('smoke checks passed');
