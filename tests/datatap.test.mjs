import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDataTap } from '../server/datatap.mjs';
import { baseQuery } from '../server/demo.mjs';
const connection = { baseUrl: 'https://datatap.example.test/api', apiKey: 'test-secret' };
const response = (data) => ({ ok: true, json: async () => data });
const q = {
  ...baseQuery(),
  group_by: ['os_version'],
  metrics: [
    { field: 'device_id', aggregation: 'count_distinct', alias: 'devices', label: 'Devices' },
  ],
};
test('DataTap submit, poll, and normalization use the declared contract', async () => {
  const calls = [];
  const replies = [
    { id: 'query/1', status: 'PENDING' },
    { status: 'RUNNING' },
    { status: 'SUCCEEDED', content: { result: { data_array: [['Android 14', '42']] } } },
  ];
  const r = await executeDataTap(q, connection, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(replies.shift());
    },
    sleep: async () => {},
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://datatap.example.test/api/queries/');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.equal(JSON.parse(calls[0].options.body).latest_data, true);
  assert.equal(calls[1].url, 'https://datatap.example.test/api/queries/query%2F1');
  assert.deepEqual(r.rows, [['Android 14', 42]]);
  assert.equal(r.columns[1].type, 'number');
  assert.equal(r.datatap_query_id, 'query/1');
  assert.equal(r.metadata.mode, 'live');
});
test('snapshot requests turn latest_data off', async () => {
  await executeDataTap({ ...q, data_scope: { type: 'SNAPSHOT', date: '2026-09-09' } }, connection, {
    fetchImpl: async (url, options) => {
      const b = JSON.parse(options.body);
      assert.equal(b.latest_data, false);
      assert.match(b.query, /2026-09-09/);
      return response({ id: 'q1', status: 'SUCCEEDED', content: { result: { data_array: [] } } });
    },
  });
});
test('failed DataTap jobs produce safe application errors', async () => {
  await assert.rejects(
    () =>
      executeDataTap(q, connection, {
        fetchImpl: async () =>
          response({ id: 'q1', status: 'FAILED', error: 'sensitive upstream details' }),
        sleep: async () => {},
      }),
    /unable to complete/,
  );
});
test('polling times out with a bounded deadline', async () => {
  let time = 0;
  await assert.rejects(
    () =>
      executeDataTap(q, connection, {
        now: () => time,
        timeout: 20,
        sleep: async (ms) => {
          time += ms;
        },
        fetchImpl: async () => response({ id: 'q1', status: 'PENDING' }),
      }),
    (e) => e.statusCode === 'TIMED_OUT',
  );
});
test('unexpected result shapes and nonnumeric measures are rejected', async () => {
  for (const rows of [[['Android 14']], [['Android 14', 'bad']]])
    await assert.rejects(
      () =>
        executeDataTap(q, connection, {
          fetchImpl: async () =>
            response({ id: 'q1', status: 'SUCCEEDED', content: { result: { data_array: rows } } }),
        }),
      /DataTap returned/,
    );
});
test('network failures do not expose transport details or credentials', async () => {
  await assert.rejects(
    () =>
      executeDataTap(q, connection, {
        fetchImpl: async () => {
          throw Error('secret transport test-secret');
        },
      }),
    (e) => e.message === 'Unable to reach DataTap. Please try again.',
  );
});

test('nested DataTap content envelopes support submission, polling and results', async () => {
  const replies = [
    { content: { id: 'nested-query', status: 'PENDING', result: null } },
    { content: { id: 'nested-query', status: 'RUNNING', result: null } },
    {
      content: {
        id: 'nested-query',
        status: 'SUCCEEDED',
        result: { data_array: [['Android 14', '42']] },
      },
    },
  ];
  const calls = [];
  const result = await executeDataTap(q, connection, {
    fetchImpl: async (url) => {
      calls.push(url);
      return response(replies.shift());
    },
    sleep: async () => {},
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1], 'https://datatap.example.test/api/queries/nested-query');
  assert.deepEqual(result.rows, [['Android 14', 42]]);
  assert.equal(result.datatap_query_id, 'nested-query');
});

test('nested terminal failure is handled without exposing upstream details', async () => {
  await assert.rejects(
    () =>
      executeDataTap(q, connection, {
        fetchImpl: async () =>
          response({ content: { id: 'failed-query', status: 'FAILED', error: 'private details' } }),
      }),
    /unable to complete/,
  );
});

test('upstream truncation and exact row limits remain visible in metadata', async () => {
  const result = await executeDataTap({ ...q, limit: 1 }, connection, {
    fetchImpl: async () =>
      response({
        content: {
          id: 'q',
          status: 'SUCCEEDED',
          result: { data_array: [['Android 14', '42']], truncated: true },
        },
      }),
  });
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.metadata.limit_reached, true);
});

test('successful explicit null results are empty, while missing results remain errors', async () => {
  for (const nested of [true, false]) {
    const payload = { id: 'empty', status: 'SUCCEEDED', result: null };
    const result = await executeDataTap(q, connection, {
      fetchImpl: async () => response(nested ? { content: payload } : payload),
    });
    assert.deepEqual(result.rows, []);
    assert.equal(result.metadata.row_count, 0);
  }
  await assert.rejects(
    executeDataTap(q, connection, {
      fetchImpl: async () => response({ content: { id: 'bad', status: 'SUCCEEDED' } }),
    }),
    /unexpected result/,
  );
});

test('tenant quotas are reported safely without retrying submission or polling', async () => {
  for (const phase of ['submit', 'poll']) {
    let calls = 0;
    await assert.rejects(
      executeDataTap(q, connection, {
        sleep: async () => {},
        fetchImpl: async () => {
          calls++;
          if (phase === 'poll' && calls === 1) return response({ id: 'q', status: 'PENDING' });
          return {
            status: 429,
            ok: false,
            json: async () => ({
              message: 'Tenant rate limit exceeded: 25 requests per hour',
              error: 'secret',
            }),
            headers: { get: () => null },
          };
        },
      }),
      (error) =>
        error.statusCode === 'RATE_LIMITED' &&
        error.message.includes('25 requests per hour') &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, phase === 'submit' ? 1 : 2);
  }
});
test('rate limits preserve numeric retry guidance without exposing upstream text', async () => {
  await assert.rejects(
    executeDataTap(q, connection, {
      fetchImpl: async () => ({
        status: 429,
        ok: false,
        json: async () => ({ message: 'private secret' }),
        headers: { get: () => '60' },
      }),
    }),
    (error) =>
      error.statusCode === 'RATE_LIMITED' &&
      error.message.includes('after 60 seconds') &&
      !error.message.includes('private secret'),
  );
});

test('resuming a known upstream query polls its ID without posting a duplicate', async () => {
  const methods = [];
  const ids = [];
  const result = await executeDataTap(q, connection, {
    resumeQueryId: 'known/query',
    onQueryId: (id) => ids.push(id),
    fetchImpl: async (url, options) => {
      methods.push(options.method || 'GET');
      assert.ok(url.endsWith('/queries/known%2Fquery'));
      return response({
        content: {
          id: 'known/query',
          status: 'SUCCEEDED',
          result: { data_array: [['Android', '7']] },
        },
      });
    },
  });
  assert.deepEqual(methods, ['GET']);
  assert.deepEqual(ids, ['known/query']);
  assert.equal(result.rows[0][1], 7);
});
