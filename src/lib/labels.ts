import type { McpServer } from './types.ts';

export type Trust = 'official' | 'setup' | 'unofficial';

export const TRUST_LABELS: Record<Trust, string> = {
  official: 'Official',
  setup: 'Official · needs setup',
  unofficial: 'Unofficial',
};

export function trustOf(server: McpServer): Trust {
  if (server.unofficial) return 'unofficial';
  return server.setupUrl ? 'setup' : 'official';
}

/** Who publishes a server: `railway.com`, `mintmcp.com`, `github.com/someone`, or a hand-listed name. */
export function publisherOf(server: McpServer, domain: string): string {
  if (server.publisher) return server.publisher;
  // Official means verified as the site's own, whatever account published it.
  if (server.source === 'site' || !server.unofficial) return domain;
  const namespace = server.id.split('/')[0] ?? server.id;
  if (namespace.startsWith('io.github.')) return `github.com/${namespace.slice('io.github.'.length)}`;
  // Reverse-DNS namespace → domain (`com.mintmcp` → `mintmcp.com`). Done by hand rather than with
  // tldts so the page script, which loads on every site, stays small.
  return namespace.split('.').reverse().join('.');
}

/** Sites with only third-party servers get a quieter bar: amber, and never opened automatically. */
export function onlyUnofficial(servers: McpServer[]): boolean {
  return servers.length > 0 && servers.every((server) => server.unofficial);
}

/** A server's name without a trailing "MCP" or "MCP Server" ("PostHog MCP Server" → "PostHog"). */
export function displayName(server: McpServer): string {
  return server.title.replace(/[\s:_-]+(mcp(\s+server)?|server)$/i, '').trim() || server.title;
}

/** "an MCP server", "3 unofficial MCP servers". Every variant starts with a vowel sound, so "an" always fits. */
function describe(count: number, kind: '' | 'official' | 'unofficial'): string {
  const adjective = kind ? `${kind} ` : '';
  return count === 1 ? `an ${adjective}MCP server` : `${count} ${adjective}MCP servers`;
}

/** The bar's summary: who has what (`Railway` + ` has an MCP server`). */
export function summary(servers: McpServer[], domain: string): { name: string; rest: string } {
  const official = servers.filter((server) => !server.unofficial);
  if (!official.length) return { name: domain, rest: ` has ${describe(servers.length, 'unofficial')}` };
  // Say "official" only when there are unofficial ones to tell it apart from.
  const kind = official.length < servers.length ? 'official' : '';
  const name = official.length === 1 ? displayName(official[0]!) : domain;
  return { name, rest: ` has ${describe(official.length, kind)}` };
}
