// Builds data/index.json: the official MCP registry plus a crawl of popular sites'
// /.well-known files, grouped by domain. A GitHub Action runs it weekly and
// publishes the result to GitHub Pages, where installed extensions fetch it.
//
//   npm run index                      registry + crawl of the top 10,000 sites
//   npm run index -- --top=500         smaller crawl, for trying it locally
//   npm run index -- --no-crawl        registry only
//
// The registry comes from a snapshot the last build published next to the index
// (data/registry.json), plus whatever changed since; see registry-sync.ts.
//
// `npm run index` sets UV_THREADPOOL_SIZE=64. Node resolves DNS on that pool (4 threads by
// default); with hundreds of requests in flight on a GitHub runner, lookups queued past the
// request timeout and almost every site failed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { discoverSite, type Fetcher } from '../src/lib/discovery.ts';
import {
  brandsFromDomains,
  buildIndex,
  curatedServers,
  mergeSiteServers,
  type CuratedEntry,
  type RegistryIndex,
} from '../src/lib/registry.ts';
import type { McpServer } from '../src/lib/types.ts';
import { syncRegistry, type RegistryPage, type RegistrySnapshot } from './registry-sync.ts';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const TRANCO = 'https://tranco-list.eu/api/lists/date/latest';
const OUT = new URL('../data/index.json', import.meta.url);
const SNAPSHOT = new URL('../data/registry.json', import.meta.url);
const PUBLISHED = 'https://moizahmedd.github.io/mcp-here/data';
const CURATED = new URL('../data/curated.json', import.meta.url);
/** Popular sites used to match third-party servers by brand name, independent of how many we crawl. */
const BRAND_SITES = 10_000;
const USER_AGENT = 'MCPHereBot/1.0 (+https://github.com/MoizAhmedd/mcp-here)';
const CONCURRENCY = 48;
/** How long to spend on the registry before moving on; an unfinished pass resumes next build. */
const REGISTRY_BUDGET_MS = Number(process.env.REGISTRY_MINUTES ?? 120) * 60_000;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const top = Number(arg('top')?.split('=')[1] ?? 10_000);
const crawl = !arg('no-crawl');

async function fetchWithRetry(url: string, attempts = 6, timeoutMs = 30_000): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      await res.body?.cancel();
      if (attempt >= attempts || res.status < 500) throw new Error(`${res.status} from ${url}`);
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    // 2s, 4s, 8s, 16s, 32s: rides out short registry outages.
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}

/** A file the last build published, or undefined if it hasn't published one. Other failures throw. */
async function fetchPublished<T>(file: string): Promise<T | undefined> {
  const res = await fetchWithRetry(`${PUBLISHED}/${file}`).catch((error: Error) => {
    if (error.message.startsWith('404 ')) return undefined;
    throw error;
  });
  return res && ((await res.json()) as T);
}

/**
 * The local snapshot if there is one (local runs), else the published one, else none yet.
 * Starting over just because the download failed would publish a partial snapshot over the
 * good one, so only a missing snapshot (404) starts a first full pass.
 */
async function loadSnapshot(): Promise<RegistrySnapshot> {
  if (existsSync(SNAPSHOT)) return JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as RegistrySnapshot;
  return (await fetchPublished<RegistrySnapshot>('registry.json')) ?? { entries: [] };
}

// Registry pages can take minutes; its gateway gives up at 3.
const fetchPage = async (params: URLSearchParams) =>
  (await (await fetchWithRetry(`${REGISTRY}?${params}`, 3, 200_000)).json()) as RegistryPage;

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
function refuseIfBroken(foundCount: number, published: RegistryIndex | undefined): void {
  if (!published) return;
  const before = Object.values(published.domains).filter((list) => list.some((server) => server.source === 'site')).length;
  if (foundCount < before / 2) {
    throw new Error(`Crawl found ${foundCount} sites with servers, but the live index has ${before}. Not publishing.`);
  }
}

const curated = (JSON.parse(readFileSync(CURATED, 'utf8')) as { entries: CuratedEntry[] }).entries;
const [sync, popular, published] = await Promise.all([
  loadSnapshot().then((snapshot) => syncRegistry(snapshot, fetchPage, { deadline: Date.now() + REGISTRY_BUDGET_MS })),
  topSites(Math.max(top, BRAND_SITES)),
  fetchPublished<RegistryIndex>('index.json'),
]);
writeFileSync(SNAPSHOT, JSON.stringify(sync.snapshot));
const { entries } = sync.snapshot;
console.log(`registry: fetched ${sync.fetched} changed entries, ${entries.length} in the snapshot`);
if (sync.error) {
  // GitHub shows this as an annotation on the run. The next build resumes the pass.
  console.log(`::warning::Registry pass stopped early (${sync.error}); the next build carries on from there.`);
}
if (!sync.snapshot.syncedAt && published) {
  // Until a first full pass completes, the snapshot is missing servers. Republish the live
  // index unchanged, with the partial snapshot, so the next build can carry on.
  writeFileSync(OUT, JSON.stringify(published));
  console.log('registry snapshot incomplete: republished the live index unchanged');
  process.exit(0);
}
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
  refuseIfBroken(Object.keys(found).length, published);
  index = mergeSiteServers(index, found);
}

writeFileSync(OUT, JSON.stringify(index));
const servers = Object.values(index.domains).reduce((n, list) => n + list.length, 0);
console.log(`wrote ${servers} servers on ${Object.keys(index.domains).length} domains`);
