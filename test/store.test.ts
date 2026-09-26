import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSiteServers } from '../src/lib/registry.ts';
import { barMode, combine, needsCheck, RECHECK_MS, siteKey } from '../src/lib/store.ts';
import type { McpServer, Source } from '../src/lib/types.ts';

const server = (id: string, source: Source): McpServer => ({
  id,
  title: id,
  source,
  install: { kind: 'remote', transport: 'http', url: `https://${id}.example.com/mcp`, headers: [] },
});

test('a site is re-checked when never checked or checked over a week ago', () => {
  const now = Date.now();
  assert.equal(needsCheck(undefined, now), true);
  assert.equal(needsCheck({ servers: [], checkedAt: now - RECHECK_MS + 1000 }, now), false);
  assert.equal(needsCheck({ servers: [], checkedAt: now - RECHECK_MS }, now), true);
});

test("this browser's check replaces what the store says the site publishes, keeping registry entries", () => {
  const stored = [server('crawled', 'site'), server('registry', 'registry')];
  assert.deepEqual(combine(stored, undefined), stored);
  // The site removed its card since the crawl.
  assert.deepEqual(combine(stored, { servers: [], checkedAt: 0 }).map((s) => s.id), ['registry']);
  // A site the store never knew about.
  assert.deepEqual(combine([], { servers: [server('fresh', 'site')], checkedAt: 0 }).map((s) => s.id), ['fresh']);
});

test('the corner bar opens on the first visit, then collapses, and stays gone once dismissed', () => {
  assert.equal(barMode(undefined), 'open');
  assert.equal(barMode({ seen: true }), 'collapsed');
  assert.equal(barMode({ seen: true, dismissed: true }), 'hidden');
  assert.equal(barMode({ seen: true, dismissed: false }), 'collapsed');
});

test('per-site storage keys are hashed and stable', async () => {
  const key = await siteKey('c', 'railway.com');
  assert.match(key, /^c:[0-9a-f]{24}$/);
  assert.ok(!key.includes('railway'));
  assert.equal(key, await siteKey('c', 'railway.com'));
  assert.notEqual(key, await siteKey('c', 'stripe.com'));
});

test('crawled servers go ahead of registry entries in the index', () => {
  const index = { generatedAt: 'now', domains: { 'railway.com': [server('registry', 'registry')] } };
  const merged = mergeSiteServers(index, { 'railway.com': [server('card', 'site')], 'new.dev': [server('new', 'site')] });
  assert.deepEqual(merged.domains['railway.com']!.map((s) => s.id), ['card', 'registry']);
  assert.deepEqual(merged.domains['new.dev']!.map((s) => s.id), ['new']);
  assert.deepEqual(index.domains['railway.com']!.map((s) => s.id), ['registry']);
});
