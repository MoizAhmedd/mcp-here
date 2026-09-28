// Builds data/index.json: the official MCP registry plus a crawl of popular sites'
// /.well-known files, grouped by domain. A GitHub Action runs it weekly and
// publishes the result to GitHub Pages, where installed extensions fetch it.
//
//   npm run index                      registry + crawl of the top 10,000 sites
//   npm run index -- --top=500         smaller crawl, for trying it locally
//   npm run index -- --no-crawl        registry only
//
// `npm run index` sets UV_THREADPOOL_SIZE=64. Node resolves DNS on that pool (4 threads by
// default); with hundreds of requests in flight on a GitHub runner, lookups queued past the
// request timeout and almost every site failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { discoverSite, type Fetcher } from '../src/lib/discovery.ts';
import {
  brandsFromDomains,
  buildIndex,
  curatedServers,
  mergeSiteServers,
  type CuratedEntry,
  type RegistryEntry,
} from '../src/lib/registry.ts';
import type { McpServer } from '../src/lib/types.ts';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const TRANCO = 'https://tranco-list.eu/api/lists/date/latest';
const OUT = new URL('../data/index.json', import.meta.url);
const PUBLISHED = 'https://moizahmedd.github.io/mcp-here/data/index.json';
const CURATED = new URL('../data/curated.json', import.meta.url);
/** Popular sites used to match third-party servers by brand name, independent of how many we crawl. */
const BRAND_SITES = 10_000;
const USER_AGENT = 'MCPHereBot/1.0 (+https://github.com/MoizAhmedd/mcp-here)';
const CONCURRENCY = 48;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const top = Number(arg('top')?.split('=')[1] ?? 10_000);
const crawl = !arg('no-crawl');

async function fetchWithRetry(url: string, attempts = 6): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      if (attempt >= attempts || res.status < 500) throw new Error(`${res.status} from ${url}`);
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    // 2s, 4s, 8s, 16s, 32s: rides out short registry outages.
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}

async function registryEntries(): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: '100', version: 'latest' });
    if (cursor) params.set('cursor', cursor);
    const page = (await (await fetchWithRetry(`${REGISTRY}?${params}`)).json()) as {
      servers: RegistryEntry[];
      metadata?: { nextCursor?: string };
    };
    entries.push(...page.servers);
    cursor = page.metadata?.nextCursor;
  } while (cursor);
  return entries;
}

async function topSites(count: number): Promise<string[]> {
  const { list_id } = (await (await fetchWithRetry(TRANCO)).json()) as { list_id: string };
  const csv = await (await fetchWithRetry(`https://tranco-list.eu/download/${list_id}/${count}`)).text();
  return csv
    .split('\n')
    .map((line) => line.split(',')[1]?.trim())
    .filter((domain): domain is string => !!domain);
}

async function crawlSites(domains: string[]): Promise<Record<string, McpServer[]>> {
  const fetcher: Fetcher = (url, init) => fetch(url, { ...init, headers: { ...init.headers, 'user-agent': USER_AGENT } });
  const found: Record<string, McpServer[]> = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < domains.length) {
      const domain = domains[next++]!;
      const servers = await discoverSite(domain, fetcher);
      if (servers.length) found[domain] = servers;
      if (++done % 1000 === 0) console.log(`  crawled ${done}/${domains.length}, ${Object.keys(found).length} with servers`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return found;
}

/**
 * A crawl that finds far fewer sites than the live index is broken (network trouble on the
 * runner), not the web changing overnight. Fail instead of publishing it over the good one.
 */
async function refuseIfBroken(foundCount: number): Promise<void> {
  const published = await fetch(PUBLISHED).then((res) => (res.ok ? res.json() : undefined)).catch(() => undefined);
  if (!published?.domains) return;
  const before = Object.values(published.domains as Record<string, McpServer[]>).filter((list) =>
    list.some((server) => server.source === 'site'),
  ).length;
  if (foundCount < before / 2) {
    throw new Error(`Crawl found ${foundCount} sites with servers, but the live index has ${before}. Not publishing.`);
  }
}

const curated = (JSON.parse(readFileSync(CURATED, 'utf8')) as { entries: CuratedEntry[] }).entries;
const [entries, popular] = await Promise.all([registryEntries(), topSites(Math.max(top, BRAND_SITES))]);
const brands = brandsFromDomains(popular);
// Hand-listed keywords win over brands derived from domain names.
for (const entry of curated) for (const keyword of entry.keywords) brands.set(keyword, entry.keys[0]!);
let index = mergeSiteServers(buildIndex(entries, new Date().toISOString(), { brands }), curatedServers(curated));
console.log(`registry: ${entries.length} entries on ${Object.keys(index.domains).length} keys`);

if (crawl) {
  const registrable = Object.keys(index.domains).filter((key) => !key.includes('/'));
  const domains = [...new Set([...popular.slice(0, top), ...registrable])];
  console.log(`crawling ${domains.length} sites`);
  const found = await crawlSites(domains);
  console.log(`crawl: ${Object.keys(found).length} sites publish their own server: ${Object.keys(found).slice(0, 20).join(', ')}`);
  await refuseIfBroken(Object.keys(found).length);
  index = mergeSiteServers(index, found);
}

writeFileSync(OUT, JSON.stringify(index));
const servers = Object.values(index.domains).reduce((n, list) => n + list.length, 0);
console.log(`wrote ${servers} servers on ${Object.keys(index.domains).length} domains`);
