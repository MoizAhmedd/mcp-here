import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DISCOVERY_PATHS, discoverSite, parseDiscoveryDoc } from '../src/lib/discovery.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('parses a registry-style server card (Railway)', () => {
  const { servers } = parseDiscoveryDoc(fixture('railway-server-card.json'), 'card');
  assert.equal(servers.length, 1);
  assert.equal(servers[0]!.title, 'Railway');
  assert.equal(servers[0]!.source, 'site');
  assert.deepEqual(servers[0]!.install, { kind: 'remote', transport: 'http', url: 'https://mcp.railway.com/', headers: [] });
});

test('parses endpoint-only cards (Sentry)', () => {
  for (const name of ['sentry-server-card.json', 'sentry-mcp.json']) {
    const { servers } = parseDiscoveryDoc(fixture(name), name);
    assert.equal(servers[0]?.title, 'Sentry');
    assert.equal(servers[0]?.install.kind === 'remote' && servers[0].install.url, 'https://mcp.sentry.dev/mcp');
  }
});

test('reads MCP endpoints listed directly in an AI Catalog (Supabase)', () => {
  const { servers, cardUrls } = parseDiscoveryDoc(fixture('supabase-ai-catalog.json'), 'catalog');
  assert.deepEqual(cardUrls, []);
  assert.equal(servers.length, 1);
  assert.equal(servers[0]!.title, 'Supabase');
  assert.equal(servers[0]!.install.kind === 'remote' && servers[0]!.install.url, 'https://mcp.supabase.com/mcp');
});

test('follows server card links in an AI Catalog (GitHub)', async () => {
  const { cardUrls } = parseDiscoveryDoc(fixture('github-ai-catalog.json'), 'catalog');
  assert.deepEqual(cardUrls, ['https://api.githubcopilot.com/mcp/server-card']);

  const responses: Record<string, unknown> = {
    'https://github.com/.well-known/ai-catalog.json': fixture('github-ai-catalog.json'),
    'https://api.githubcopilot.com/mcp/server-card': fixture('github-server-card.json'),
  };
  const requested: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    requested.push(url);
    // Like GitHub, refuse clients that only accept plain JSON.
    if (!String(new Headers(init.headers).get('accept')).includes('+json')) return new Response('', { status: 406 });
    const body = responses[url];
    return body ? new Response(JSON.stringify(body)) : new Response('Not found', { status: 404 });
  };
  const servers = await discoverSite('github.com', fetcher);
  assert.equal(requested.length, DISCOVERY_PATHS.length + 1);
  assert.equal(servers.length, 1);
  assert.equal(servers[0]!.title, 'GitHub');
  assert.equal(servers[0]!.install.kind === 'remote' && servers[0]!.install.url, 'https://api.githubcopilot.com/mcp/');
});

test('ignores HTML, junk and unsafe endpoints', async () => {
  assert.deepEqual(parseDiscoveryDoc({ name: 'Evil', url: 'http://plain-http.example/mcp' }, 'x').servers, []);
  assert.deepEqual(parseDiscoveryDoc({ name: 'Templated', url: 'https://{tenant}.example.com/mcp' }, 'x').servers, []);
  assert.deepEqual(parseDiscoveryDoc('just a string', 'x').servers, []);

  const html = async () => new Response('<html>soft 404</html>', { status: 200 });
  assert.deepEqual(await discoverSite('example.com', html), []);
  const offline = async () => {
    throw new TypeError('network down');
  };
  assert.deepEqual(await discoverSite('example.com', offline), []);
});

test('handles SEP-1960 style endpoint manifests', () => {
  const { servers } = parseDiscoveryDoc({ name: 'Acme', endpoints: [{ url: 'https://mcp.acme.dev/mcp', transport: 'http' }] }, 'x');
  assert.equal(servers[0]?.title, 'Acme');
});
