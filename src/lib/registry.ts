import { lookupDomains, namespaceDomain } from './domain.ts';
import { fromServerJson } from './servers.ts';
import type { McpServer } from './types.ts';

/** Official MCP registry servers grouped by the website domain that owns them. */
export interface RegistryIndex {
  generatedAt: string;
  domains: Record<string, McpServer[]>;
}

const MAX_PER_DOMAIN = 30;

export function lookup(index: RegistryIndex, domain: string): McpServer[] {
  return lookupDomains(domain).flatMap((d) => index.domains[d] ?? []);
}

/** Add servers found by crawling sites' own `/.well-known` files, ahead of registry entries. */
export function mergeSiteServers(index: RegistryIndex, found: Record<string, McpServer[]>): RegistryIndex {
  const domains = { ...index.domains };
  for (const [domain, servers] of Object.entries(found)) domains[domain] = [...servers, ...(domains[domain] ?? [])];
  return { ...index, domains };
}

export function isRegistryIndex(value: unknown): value is RegistryIndex {
  const index = value as RegistryIndex;
  return typeof index?.generatedAt === 'string' && typeof index.domains === 'object' && index.domains !== null;
}

export type RegistryEntry = { server?: { name?: unknown; [key: string]: unknown }; _meta?: Record<string, { status?: string }> };

/** Build the index from registry API entries (`{ server, _meta }`). */
export function buildIndex(entries: RegistryEntry[], generatedAt: string): RegistryIndex {
  const domains: Record<string, McpServer[]> = {};
  for (const entry of entries) {
    const name = entry.server?.name;
    const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status;
    if (typeof name !== 'string' || (status && status !== 'active')) continue;
    const domain = namespaceDomain(name);
    const server = domain && fromServerJson(entry.server, 'registry', name);
    if (!domain || !server) continue;
    (domains[domain] ??= []).push(server);
  }
  for (const [domain, servers] of Object.entries(domains)) {
    // Remote servers first (no local setup), then shorter names, which tend to be the flagship server.
    servers.sort(
      (a, b) =>
        Number(b.install.kind === 'remote') - Number(a.install.kind === 'remote') ||
        a.id.length - b.id.length ||
        a.id.localeCompare(b.id),
    );
    domains[domain] = servers.slice(0, MAX_PER_DOMAIN);
  }
  return { generatedAt, domains };
}
