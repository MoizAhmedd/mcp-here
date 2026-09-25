import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildIndex, lookup } from '../src/lib/registry.ts';
import { installSpec, nameServers } from '../src/lib/servers.ts';
import type { McpServer } from '../src/lib/types.ts';

const entries = JSON.parse(readFileSync(new URL('./fixtures/registry-entries.json', import.meta.url), 'utf8'));

test('indexes registry servers under the domain that owns them', () => {
  const index = buildIndex(
    [
      ...entries,
      { server: { name: 'io.github.someone/stripe-clone', remotes: [{ type: 'streamable-http', url: 'https://x.dev/mcp' }] } },
      {
        server: { name: 'com.stripe/old', remotes: [{ type: 'sse', url: 'https://old.stripe.com/sse' }] },
        _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deprecated' } },
      },
    ],
    '2026-09-24T00:00:00Z',
  );
  assert.deepEqual(Object.keys(index.domains).sort(), ['stripe.com', 'supabase.com']);
  assert.deepEqual(lookup(index, 'stripe.com').map((s) => s.id), ['com.stripe/mcp']);
  assert.equal(lookup(index, 'supabase.com')[0]!.install.kind, 'remote');
  assert.deepEqual(lookup(index, 'example.com'), []);
});

test('installSpec prefers streamable HTTP, then SSE, then packages', () => {
  assert.deepEqual(
    installSpec({
      remotes: [
        { type: 'sse', url: 'https://a.dev/sse' },
        { type: 'streamable-http', url: 'https://a.dev/mcp', headers: [{ name: 'X-Api-Key', isRequired: true }] },
      ],
    }),
    { kind: 'remote', transport: 'http', url: 'https://a.dev/mcp', headers: ['X-Api-Key'] },
  );
  assert.deepEqual(
    installSpec({
      packages: [
        { registryType: 'cargo', identifier: 'thing' },
        {
          registryType: 'npm',
          identifier: '@acme/mcp',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'ACME_KEY', isRequired: true }, { name: 'OPTIONAL' }],
        },
      ],
    }),
    { kind: 'stdio', command: 'npx', args: ['-y', '@acme/mcp'], env: ['ACME_KEY'] },
  );
  assert.equal(installSpec({ packages: [{ registryType: 'npm', identifier: 'pkg; rm -rf ~' }] }), undefined);
});

test('nameServers dedupes by endpoint and gives unique slugs', () => {
  const remote = (id: string, title: string, url: string): McpServer => ({
    id,
    title,
    source: 'registry',
    install: { kind: 'remote', transport: 'http', url, headers: [] },
  });
  const named = nameServers(
    [
      remote('site', 'Railway', 'https://mcp.railway.com/'),
      remote('com.railway/mcp', 'Railway MCP', 'https://mcp.railway.com'),
      remote('com.railway/docs', 'Railway', 'https://docs.railway.com/mcp'),
      remote('com.railway/x', '???', 'https://x.railway.com/mcp'),
    ],
    'railway.com',
  );
  assert.deepEqual(
    named.map((s) => [s.id, s.slug]),
    [
      ['site', 'railway'],
      ['com.railway/docs', 'railway-2'],
      ['com.railway/x', 'railway-3'],
    ],
  );
});

test('untitled registry servers get a readable title', () => {
  const index = buildIndex(
    [
      { server: { name: 'com.stripe/mcp', remotes: [{ type: 'streamable-http', url: 'https://mcp.stripe.com' }] } },
      { server: { name: 'com.vercel/vercel-mcp', remotes: [{ type: 'streamable-http', url: 'https://mcp.vercel.com' }] } },
    ],
    'now',
  );
  assert.equal(lookup(index, 'stripe.com')[0]!.title, 'Stripe');
  assert.equal(lookup(index, 'vercel.com')[0]!.title, 'Vercel');
});
