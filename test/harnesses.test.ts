import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HARNESSES, harnessById, shq, type Action } from '../src/lib/harnesses.ts';
import type { NamedServer } from '../src/lib/types.ts';

const railway: NamedServer = {
  id: 'com.railway/railway',
  slug: 'railway',
  title: 'Railway',
  description: 'Deploy apps',
  source: 'site',
  install: { kind: 'remote', transport: 'http', url: 'https://mcp.railway.com/', headers: [] },
};

const local: NamedServer = {
  id: 'com.acme/mcp',
  slug: 'acme',
  title: 'Acme',
  source: 'registry',
  install: { kind: 'stdio', command: 'npx', args: ['-y', '@acme/mcp'], env: ['ACME_KEY'] },
};

const build = (id: string, server: NamedServer): Action | undefined => harnessById(id).build(server);
const text = (action: Action | undefined) => (action?.type === 'copy' ? action.text : undefined);
const decodeConfig = (url: string) =>
  JSON.parse(Buffer.from(new URL(url).searchParams.get('config')!, 'base64').toString('utf8'));

test('CLI harnesses produce the documented commands', () => {
  assert.equal(text(build('claude-code', railway)), 'claude mcp add --scope user --transport http railway https://mcp.railway.com/');
  assert.equal(
    text(build('claude-code', local)),
    "claude mcp add --scope user acme --env 'ACME_KEY=<value>' -- npx -y @acme/mcp",
  );
  assert.equal(text(build('codex', railway)), 'codex mcp add railway --url https://mcp.railway.com/');
  assert.equal(text(build('gemini', railway)), 'gemini mcp add --scope user --transport http railway https://mcp.railway.com/');
  // Gemini needs `--` before arguments that look like flags.
  assert.equal(text(build('gemini', local)), "gemini mcp add --scope user -e 'ACME_KEY=<value>' acme npx -- -y @acme/mcp");
});

test('deeplink harnesses encode the server config', () => {
  const cursor = build('cursor', railway);
  assert.equal(cursor?.type, 'open');
  assert.ok(cursor.url.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=railway&config='));
  assert.deepEqual(decodeConfig(cursor.url), { url: 'https://mcp.railway.com/' });

  const vscode = build('vscode', local);
  assert.equal(vscode?.type, 'open');
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode.url.slice('vscode:mcp/install?'.length))), {
    name: 'acme',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@acme/mcp'],
    env: { ACME_KEY: '<value>' },
  });

  const goose = build('goose', railway);
  assert.equal(goose?.type, 'open');
  const params = new URL(goose.url).searchParams;
  assert.equal(params.get('url'), 'https://mcp.railway.com/');
  assert.equal(params.get('type'), 'streamable_http');

  const lmstudio = build('lmstudio', local);
  assert.equal(lmstudio?.type, 'open');
  assert.deepEqual(decodeConfig(lmstudio.url).args, ['-y', '@acme/mcp']);
});

test('Claude app opens connector settings and copies the URL', () => {
  assert.deepEqual(build('claude', railway), {
    type: 'open',
    url: 'https://claude.ai/customize/connectors',
    preview: 'https://mcp.railway.com/',
    copy: 'https://mcp.railway.com/',
  });
  assert.equal(build('claude', local), undefined);
  assert.equal(build('url', local), undefined);
});

test('shell commands quote anything unusual', () => {
  assert.equal(shq('https://mcp.example.com/mcp'), 'https://mcp.example.com/mcp');
  assert.equal(shq('https://x.dev/mcp?a=1&b=2'), "'https://x.dev/mcp?a=1&b=2'");
  assert.equal(shq("it's"), "'it'\\''s'");
  const tricky: NamedServer = { ...railway, install: { ...railway.install, url: 'https://x.dev/$(whoami)' } as NamedServer['install'] };
  assert.equal(text(build('claude-code', tricky)), "claude mcp add --scope user --transport http railway 'https://x.dev/$(whoami)'");
});

test('every harness handles remote servers', () => {
  for (const harness of HARNESSES) assert.ok(harness.build(railway), harness.id);
  assert.equal(harnessById('nope').id, 'claude-code');
});
