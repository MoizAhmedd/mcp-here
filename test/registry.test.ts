import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brandsFromDomains, buildIndex, curatedServers, lookup, pageKeys } from '../src/lib/registry.ts';
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
  assert.deepEqual(lookup(index, ['stripe.com']).map((s) => s.id), ['com.stripe/mcp']);
  assert.equal(lookup(index, ['supabase.com'])[0]!.install.kind, 'remote');
  assert.deepEqual(lookup(index, ['example.com']), []);
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
  assert.equal(lookup(index, ['stripe.com'])[0]!.title, 'Stripe');
  assert.equal(lookup(index, ['vercel.com'])[0]!.title, 'Vercel');
});

const remoteEntry = (name: string, url: string, extra: Record<string, unknown> = {}) => ({
  server: { name, remotes: [{ type: 'streamable-http', url }], ...extra },
});

test("GitHub-account servers count as the brand's own only when they run on its domain", () => {
  const index = buildIndex(
    [
      remoteEntry('io.github.PostHog/mcp', 'https://mcp.posthog.com/mcp'),
      // Website field alone proves nothing: anyone can set it.
      remoteEntry('io.github.posthog-fan/tools', 'https://fan.example.dev/mcp', { websiteUrl: 'https://posthog.com' }),
    ],
    'now',
  );
  const posthog = lookup(index, ['posthog.com']);
  assert.deepEqual(posthog.map((s) => [s.id, s.unofficial ?? false]), [
    ['io.github.PostHog/mcp', false],
    ['io.github.posthog-fan/tools', true],
  ]);
});

test('third-party servers are matched to sites by brand name and listed as unofficial', () => {
  const brands = brandsFromDomains(['posthog.com', 'google.com', 'news.com']);
  brands.set('gmail', 'mail.google.com');
  brands.set('googlesheets', 'docs.google.com/spreadsheets');
  const index = buildIndex(
    [
      remoteEntry('io.github.someone/posthog-analytics', 'https://a.dev/mcp'),
      remoteEntry('ai.waystation/gmail', 'https://waystation.ai/gmail/mcp'),
      remoteEntry('io.github.x/google-sheets-mcp', 'https://b.dev/mcp'),
      // "google" and "news" are too generic to match on.
      remoteEntry('io.github.y/google-news', 'https://c.dev/mcp'),
    ],
    'now',
    { brands },
  );
  assert.deepEqual(lookup(index, ['posthog.com']).map((s) => s.id), ['io.github.someone/posthog-analytics']);
  assert.deepEqual(lookup(index, ['mail.google.com']).map((s) => s.id), ['ai.waystation/gmail']);
  assert.deepEqual(lookup(index, ['docs.google.com/spreadsheets']).map((s) => s.id), ['io.github.x/google-sheets-mcp']);
  assert.deepEqual(lookup(index, ['google.com']), []);
  assert.ok(lookup(index, ['posthog.com']).every((s) => s.unofficial));
});

test('page keys go from most to least specific', () => {
  assert.deepEqual(pageKeys(new URL('https://docs.google.com/spreadsheets/d/abc'), 'google.com'), [
    'docs.google.com/spreadsheets',
    'docs.google.com',
    'google.com',
  ]);
  assert.deepEqual(pageKeys(new URL('https://www.notion.so/'), 'notion.so'), ['notion.so', 'notion.com']);
});

test('hand-listed servers are official and keep their setup link', () => {
  const byKey = curatedServers([
    {
      keys: ['mail.google.com'],
      keywords: ['gmail'],
      server: {
        id: 'google/gmail',
        title: 'Gmail',
        setupUrl: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
        install: { kind: 'remote', transport: 'http', url: 'https://gmailmcp.googleapis.com/mcp/v1', headers: [] },
      },
    },
  ]);
  assert.equal(byKey['mail.google.com']![0]!.source, 'curated');
  assert.ok(byKey['mail.google.com']![0]!.setupUrl);
  assert.equal(byKey['mail.google.com']![0]!.unofficial, undefined);
});

test('unofficial matches favor servers named after the brand, one per publisher', () => {
  const brands = brandsFromDomains(['stripe.com']);
  const index = buildIndex(
    [
      remoteEntry('app.bulk/uk-payments', 'https://bulk.app/uk', { title: 'United Kingdom Payments (Stripe checkout)' }),
      remoteEntry('app.bulk/it-payments', 'https://bulk.app/it', { title: 'Italy Payments (Stripe checkout)' }),
      remoteEntry('io.github.a/stripe', 'https://a.dev/mcp', { title: 'Stripe' }),
      remoteEntry('io.github.b/stripe-billing-tools', 'https://b.dev/mcp'),
    ],
    'now',
    { brands },
  );
  const ids = lookup(index, ['stripe.com']).map((s) => s.id);
  assert.deepEqual(ids.slice(0, 2), ['io.github.a/stripe', 'io.github.b/stripe-billing-tools']);
  assert.equal(ids.filter((id) => id.startsWith('app.bulk/')).length, 1);
});
