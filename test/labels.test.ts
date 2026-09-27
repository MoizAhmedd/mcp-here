import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayName, onlyUnofficial, publisherOf, summary, trustOf } from '../src/lib/labels.ts';
import type { McpServer } from '../src/lib/types.ts';

const base = (id: string, extra: Partial<McpServer> = {}): McpServer => ({
  id,
  title: id,
  source: 'registry',
  install: { kind: 'remote', transport: 'http', url: `https://${id}.dev/mcp`, headers: [] },
  ...extra,
});

test('publishers come from the server id, the site, or the hand-listed name', () => {
  assert.equal(publisherOf(base('com.mintmcp/gmail', { unofficial: true }), 'google.com'), 'mintmcp.com');
  assert.equal(publisherOf(base('io.github.pipeworx-io/gmail', { unofficial: true }), 'google.com'), 'github.com/pipeworx-io');
  assert.equal(publisherOf(base('io.github.PostHog/mcp'), 'posthog.com'), 'posthog.com');
  assert.equal(publisherOf(base('card', { source: 'site' }), 'railway.com'), 'railway.com');
  assert.equal(publisherOf(base('google/gmail', { source: 'curated', publisher: 'Google' }), 'google.com'), 'Google');
});

test('trust levels', () => {
  assert.equal(trustOf(base('a')), 'official');
  assert.equal(trustOf(base('a', { setupUrl: 'https://x.dev' })), 'setup');
  assert.equal(trustOf(base('a', { unofficial: true })), 'unofficial');
  assert.equal(onlyUnofficial([base('a', { unofficial: true })]), true);
  assert.equal(onlyUnofficial([base('a'), base('b', { unofficial: true })]), false);
  assert.equal(onlyUnofficial([]), false);
});

test('the bar summary names the official server and flags unofficial-only sites', () => {
  const railway = base('railway', { title: 'Railway' });
  const fan = base('fan', { unofficial: true });
  assert.deepEqual(summary([railway], 'railway.com'), { name: 'Railway', rest: ' has an MCP server' });
  assert.deepEqual(summary([railway, fan], 'railway.com'), { name: 'Railway', rest: ' has an official MCP server' });
  assert.deepEqual(summary([railway, base('b')], 'railway.com'), { name: 'railway.com', rest: ' has 2 MCP servers' });
  assert.deepEqual(summary([fan, fan, fan], 'youtube.com'), { name: 'youtube.com', rest: ' has 3 unofficial MCP servers' });
  assert.deepEqual(summary([fan], 'youtube.com'), { name: 'youtube.com', rest: ' has an unofficial MCP server' });
});

test('display names drop a trailing MCP or MCP Server', () => {
  assert.equal(displayName(base('a', { title: 'PostHog MCP Server' })), 'PostHog');
  assert.equal(displayName(base('a', { title: 'Figma MCP' })), 'Figma');
  assert.equal(displayName(base('a', { title: 'figma-mcp' })), 'figma');
  assert.equal(displayName(base('a', { title: 'MCP' })), 'MCP');
  assert.equal(displayName(base('a', { title: 'Railway' })), 'Railway');
});
