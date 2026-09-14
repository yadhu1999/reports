// Test-only transport. Imported explicitly by the integration-test child process.
globalThis.fetch = async (url, options) => {
  if (!/^https:\/\/(acme|other)-api\.esper\.cloud\/api\/data-tap\/v0\/queries\/$/.test(url))
    throw Error('Unexpected test endpoint');
  if (options.redirect !== 'error') throw Error('Redirect protection missing');
  if (options.headers.Authorization !== 'Bearer mock-valid-key')
    return new Response('{}', { status: 403 });
  const query = JSON.parse(options.body).query;
  return new Response(
    JSON.stringify({
      content: {
        id: 'query_1',
        status: 'SUCCEEDED',
        result: { data_array: query.includes('COUNT(') ? [[7]] : [['real-device']] },
      },
    }),
    { status: 201 },
  );
};
