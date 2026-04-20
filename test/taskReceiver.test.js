const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function withFetchMock(mock, fn) {
  const original = global.fetch;
  global.fetch = mock;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  };
}

delete require.cache[require.resolve('../src/gep/taskReceiver')];
delete require.cache[require.resolve('../src/gep/a2aProtocol')];

const { fetchTasks } = require('../src/gep/taskReceiver');

describe('taskReceiver', () => {
  describe('fetchTasks HTTP integration', () => {
    it('returns empty tasks when nodeId is missing', async () => {
      const { getNodeId } = require('../src/gep/a2aProtocol');
      require('../src/gep/a2aProtocol').getNodeId = () => null;
      const result = await fetchTasks();
      require('../src/gep/a2aProtocol').getNodeId = getNodeId;
      assert.deepEqual(result, { tasks: [] });
    });

    it('returns empty tasks when fetch throws', async () => {
      await withFetchMock(async () => { throw new Error('network error'); }, async () => {
        const result = await fetchTasks();
        assert.deepEqual(result.tasks, []);
      });
    });

    it('returns empty tasks when response is not ok', async () => {
      await withFetchMock(async () => jsonResponse({}, 500), async () => {
        const result = await fetchTasks();
        assert.deepEqual(result.tasks, []);
      });
    });

    it('parses tasks from valid response', async () => {
      await withFetchMock(async () => jsonResponse({
        tasks: [{ id: 't1', title: 'Test' }, { id: 't2', title: 'Test2' }]
      }), async () => {
        const result = await fetchTasks();
        assert.equal(result.tasks.length, 2);
        assert.equal(result.tasks[0].id, 't1');
      });
    });

    it('includes questions_created in response when present', async () => {
      await withFetchMock(async () => jsonResponse({
        tasks: [{ id: 't1' }],
        questions_created: [{ id: 'q1', amount: 100 }]
      }), async () => {
        const result = await fetchTasks();
        assert.ok(result.questions_created);
        assert.equal(result.questions_created.length, 1);
      });
    });
  });
});
