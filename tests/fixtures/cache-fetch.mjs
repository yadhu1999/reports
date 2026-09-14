import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).includes('.esper.cloud')) return original(url, options);
  appendFileSync(
    process.env.CACHE_TEST_CALLS,
    JSON.stringify({ method: options.method || 'GET' }) + '\n',
  );
  await new Promise((r) => setTimeout(r, 100));
  return new Response(
    JSON.stringify({
      content: { id: 'upstream-job', status: 'SUCCEEDED', result: { data_array: [['device-a']] } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
