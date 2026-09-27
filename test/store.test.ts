import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSiteServers } from '../src/lib/registry.ts';
import { barMode, combine, mergeLevels, needsCheck, RECHECK_MS, siteKey } from '../src/lib/store.ts';
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
  assert.equal(barMode(undefined, true), 'collapsed');
  assert.equal(barMode({ dismissed: true }, true), 'hidden');
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

test('official servers come before unofficial ones', () => {
  const unofficial = { ...server('fan', 'registry'), unofficial: true as const };
  assert.deepEqual(combine([unofficial, server('official', 'registry')], undefined).map((s) => s.id), ['official', 'fan']);
});

test("a page with its own entry doesn't inherit the whole domain's unofficial matches", () => {
  const fan = (id: string) => ({ ...server(id, 'registry'), unofficial: true as const });
  const gmail = [server('gmail', 'curated'), fan('gmail-fan')];
  const google = [server('google-official', 'registry'), fan('patent-search')];
  assert.deepEqual(mergeLevels([gmail, google]).map((s) => s.id), ['gmail', 'google-official', 'gmail-fan']);
  assert.deepEqual(mergeLevels([[], google]).map((s) => s.id), ['google-official', 'patent-search']);
});
