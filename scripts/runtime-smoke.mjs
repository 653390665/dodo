import fs from 'node:fs';

const baseUrl = process.env.INKFLOW_BASE_URL || 'http://localhost:3000';

/** Sync lines so `npm run smoke:runtime` does not look stuck when stdout is fully buffered. */
function out(line) {
  try {
    fs.writeSync(1, `${line}\n`);
  } catch {
    console.log(line);
  }
}

function err(line) {
  try {
    fs.writeSync(2, `${line}\n`);
  } catch {
    console.error(line);
  }
}

function formatErr(error) {
  if (!(error instanceof Error)) return String(error);
  const bits = [error.message];
  if ('cause' in error && error.cause) {
    const c = error.cause;
    bits.push(c instanceof Error ? `cause: ${c.message}` : `cause: ${String(c)}`);
  }
  if (error.name === 'AbortError' || /aborted|abort/i.test(error.message)) {
    bits.push(
      'hint: SSE step aborts after 1.5s if headers are not ready (see scripts/runtime-smoke.mjs)',
    );
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
    bits.push(
      `hint: is InkFlow running and INKFLOW_BASE_URL correct? (current: ${baseUrl})`,
    );
  }
  return bits.join(' | ');
}

async function check(name, fn) {
  try {
    await fn();
    out(`ok ${name}`);
  } catch (error) {
    err(`not ok ${name}`);
    err(formatErr(error));
    process.exitCode = 1;
  }
}

out(`-- runtime-smoke baseUrl=${baseUrl}`);

await check('config does not expose apiKey', async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if ('apiKey' in json) throw new Error('apiKey leaked from /api/config');
  if (typeof json.hasApiKey !== 'boolean') throw new Error('hasApiKey missing');
});

await check('db listSkills responds', async () => {
  const response = await fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'listSkills', args: [] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.result)) throw new Error('listSkills did not return an array');
});

await check('sse endpoint opens', async () => {
  out('-- sse: waiting up to 1.5s for event-stream response headers');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${baseUrl}/api/db/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
});

if (process.exitCode) process.exit(process.exitCode);
