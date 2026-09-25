// Downloads the official MCP registry and writes data/registry-index.json.
// Run with `npm run index`. A GitHub Action runs it daily and publishes the result
// as a release asset, which installed extensions fetch.
import { writeFileSync } from 'node:fs';
import { buildIndex, type RegistryEntry } from '../src/lib/registry.ts';

const API = 'https://registry.modelcontextprotocol.io/v0/servers';
const OUT = new URL('../data/registry-index.json', import.meta.url);

const entries: RegistryEntry[] = [];
let cursor: string | undefined;
do {
  const params = new URLSearchParams({ limit: '100', version: 'latest' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Registry returned ${res.status} for ${params}`);
  const page = (await res.json()) as { servers: RegistryEntry[]; metadata?: { nextCursor?: string } };
  entries.push(...page.servers);
  cursor = page.metadata?.nextCursor;
} while (cursor);

const index = buildIndex(entries, new Date().toISOString());
writeFileSync(OUT, JSON.stringify(index));
const servers = Object.values(index.domains).reduce((n, list) => n + list.length, 0);
console.log(`${entries.length} registry entries → ${servers} servers on ${Object.keys(index.domains).length} domains`);
