import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncRegistry, type RegistryPage } from '../scripts/registry-sync.ts';

const entry = (name: string, url = `https://${name}.dev/mcp`) => ({
  server: { name, icons: [{ src: 'x.png' }], remotes: [{ type: 'streamable-http', url }] },
});

/** Serves pages in order and records the query each request sent. */
function pages(...list: (RegistryPage | Error)[]) {
  const calls: Record<string, string>[] = [];
  const fetchPage = async (params: URLSearchParams) => {
    calls.push(Object.fromEntries(params));
    const page = list.shift();
    if (!page || page instanceof Error) throw page ?? new Error('no more pages');
    return page;
  };
  return { calls, fetchPage };
}

test('a first pass reads the whole registry and keeps only the fields the index uses', async () => {
  const { calls, fetchPage } = pages(
    { servers: [entry('a')], metadata: { nextCursor: 'a:1' } },
    { servers: [entry('b')] },
  );
  const now = new Date('2026-10-12T00:00:00Z');
  const { snapshot, error } = await syncRegistry({ entries: [] }, fetchPage, { now });
  assert.equal(error, undefined);
  assert.deepEqual(calls, [{ limit: '100', version: 'latest' }, { limit: '100', version: 'latest', cursor: 'a:1' }]);
  assert.equal(snapshot.syncedAt, now.toISOString());
  assert.equal(snapshot.pending, undefined);
  assert.deepEqual(snapshot.entries.map((e) => e.server?.name), ['a', 'b']);
  assert.equal('icons' in snapshot.entries[0]!.server!, false);
});

test('later passes fetch only changes and replace servers by name', async () => {
  const deleted = { ...entry('b'), _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } } };
  const { calls, fetchPage } = pages({ servers: [entry('a', 'https://new.dev/mcp'), deleted, entry('c')] });
  const { snapshot } = await syncRegistry(
    { syncedAt: '2026-10-05T00:00:00Z', entries: [entry('a'), entry('b')] },
    fetchPage,
    { now: new Date('2026-10-12T00:00:00Z') },
  );
  assert.equal(calls[0]!.updated_since, '2026-10-05T00:00:00Z');
  assert.equal(snapshot.syncedAt, '2026-10-12T00:00:00.000Z');
  assert.deepEqual(snapshot.entries.map((e) => e.server?.name), ['a', 'b', 'c']);
  assert.deepEqual(snapshot.entries[0]!.server!.remotes, [{ type: 'streamable-http', url: 'https://new.dev/mcp' }]);
  assert.equal(snapshot.entries[1]!._meta!['io.modelcontextprotocol.registry/official']!.status, 'deleted');
});

test('a pass that fails keeps what it fetched and resumes from the same cursor', async () => {
  const first = pages({ servers: [entry('a')], metadata: { nextCursor: 'a:1' } }, new Error('504'));
  const stopped = await syncRegistry({ syncedAt: '2026-10-05T00:00:00Z', entries: [] }, first.fetchPage, {
    now: new Date('2026-10-12T00:00:00Z'),
  });
  assert.match(String(stopped.error), /504/);
  assert.equal(stopped.snapshot.syncedAt, '2026-10-05T00:00:00Z');
  assert.deepEqual(stopped.snapshot.pending, { since: '2026-10-05T00:00:00Z', startedAt: '2026-10-12T00:00:00.000Z', cursor: 'a:1' });

  const second = pages({ servers: [entry('b')] });
  const { snapshot } = await syncRegistry(stopped.snapshot, second.fetchPage, { now: new Date('2026-10-19T00:00:00Z') });
  assert.deepEqual(second.calls, [{ limit: '100', version: 'latest', updated_since: '2026-10-05T00:00:00Z', cursor: 'a:1' }]);
  // Done as of when the interrupted pass started, so nothing changed in between is skipped.
  assert.equal(snapshot.syncedAt, '2026-10-12T00:00:00.000Z');
  assert.deepEqual(snapshot.entries.map((e) => e.server?.name), ['a', 'b']);
});

test('stops at the deadline before asking for another page', async () => {
  const { calls, fetchPage } = pages({ servers: [entry('a')] });
  const { error, snapshot } = await syncRegistry({ entries: [] }, fetchPage, { deadline: Date.now() - 1 });
  assert.match(String(error), /out of time/);
  assert.equal(calls.length, 0);
  assert.equal(snapshot.syncedAt, undefined);
});
