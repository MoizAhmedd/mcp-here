import { lookupDomains, namespaceDomain, siteDomain } from './domain.ts';
import { fromServerJson, remoteUrl } from './servers.ts';
import type { McpServer } from './types.ts';

/**
 * Servers grouped by where they show up. Keys are usually a registrable domain
 * (`stripe.com`), but can be a host (`mail.google.com`) or a host plus first
 * path segment (`docs.google.com/spreadsheets`) for sites that host many products.
 */
export interface RegistryIndex {
  generatedAt: string;
  domains: Record<string, McpServer[]>;
}

const MAX_OFFICIAL = 30;
const MAX_UNOFFICIAL = 5;

/** Index keys for a page, most specific first. */
export function pageKeys(url: URL, domain: string): string[] {
  const host = url.hostname.replace(/^www\./, '');
  const segment = url.pathname.split('/')[1];
  const keys = [segment ? `${host}/${segment}` : '', host, ...lookupDomains(domain)];
  return [...new Set(keys.filter(Boolean))];
}

export function lookup(index: RegistryIndex, keys: string[]): McpServer[] {
  return keys.flatMap((key) => index.domains[key] ?? []);
}

/** Hand-maintained official servers the registry and crawl can't find (see data/curated.json). */
export interface CuratedEntry {
  keys: string[];
  keywords: string[];
  server: Omit<McpServer, 'source'>;
}

export function curatedServers(entries: CuratedEntry[]): Record<string, McpServer[]> {
  const byKey: Record<string, McpServer[]> = {};
  for (const entry of entries) for (const key of entry.keys) (byKey[key] ??= []).push({ ...entry.server, source: 'curated' });
  return byKey;
}

/** Put servers ahead of what's already listed under each key (site cards, hand-listed servers). */
export function mergeSiteServers(index: RegistryIndex, found: Record<string, McpServer[]>): RegistryIndex {
  const domains = { ...index.domains };
  for (const [key, servers] of Object.entries(found)) domains[key] = [...servers, ...(domains[key] ?? [])];
  return { ...index, domains };
}

export function isRegistryIndex(value: unknown): value is RegistryIndex {
  const index = value as RegistryIndex;
  return typeof index?.generatedAt === 'string' && typeof index.domains === 'object' && index.domains !== null;
}

export type RegistryEntry = { server?: { name?: unknown; [key: string]: unknown }; _meta?: Record<string, { status?: string }> };

const brandOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * `io.github.PostHog/mcp` is verified against PostHog's GitHub account, not a
 * domain. Count it as posthog.com's only if the server itself runs there: anyone
 * can point a website field at posthog.com, but only PostHog can host on it.
 */
function githubOwnerDomain(name: string, server: Record<string, unknown>): string | undefined {
  const namespace = name.split('/')[0] ?? '';
  if (!namespace.startsWith('io.github.')) return undefined;
  const owner = brandOf(namespace.slice('io.github.'.length));
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  for (const remote of remotes) {
    const url = remoteUrl((remote as { url?: unknown })?.url);
    const domain = url && siteDomain(new URL(url).hostname);
    if (domain && brandOf(domain.split('.')[0]!) === owner) return domain;
  }
  return undefined;
}

// Hosts that say nothing about which site a server is for.
const GENERIC_HOSTS = new Set([
  'github.com', 'github.io', 'gitlab.com', 'npmjs.com', 'pypi.org', 'smithery.ai', 'glama.ai', 'mcp.so',
  'pulsemcp.com', 'mcpservers.org', 'vercel.app', 'netlify.app', 'railway.app', 'onrender.com', 'medium.com',
]);

// Brand names that are also everyday words, which would match unrelated servers.
const GENERIC_BRANDS = new Set([
  'google', 'mail', 'docs', 'news', 'cloud', 'search', 'maps', 'drive', 'chat', 'open', 'home', 'data', 'code',
  'shop', 'store', 'live', 'time', 'play', 'music', 'video', 'photo', 'photos', 'bank', 'blog', 'wiki', 'help',
  'info', 'online', 'digital', 'media', 'world', 'global', 'group', 'health', 'email', 'site', 'link', 'file',
  'files', 'share', 'tools', 'server', 'agent', 'agents', 'weather', 'games', 'sports', 'books', 'jobs', 'travel',
  'finance', 'market', 'trade', 'crypto', 'image', 'images', 'translate', 'calendar', 'sheets', 'forms', 'notes',
  'tasks', 'memory', 'browser', 'events', 'python', 'java', 'linux', 'fetch', 'test',
]);

export interface BuildOptions {
  /**
   * Brand name → index key, for matching third-party servers to sites by name
   * (`posthog` → `posthog.com`, `gmail` → `mail.google.com`).
   */
  brands?: Map<string, string>;
}

/** Brand map from a list of popular domains: the first label of each (`posthog.com` → `posthog`). */
export function brandsFromDomains(domains: string[]): Map<string, string> {
  const brands = new Map<string, string>();
  for (const domain of domains) {
    const brand = brandOf(domain.split('.')[0] ?? '');
    if (brand.length >= 4 && !GENERIC_BRANDS.has(brand) && !brands.has(brand)) brands.set(brand, domain);
  }
  return brands;
}

/**
 * Sites an unofficial server is probably for, with how clearly it's about each:
 * 3 = its website is on the site, or it's named just the brand ("Linear", "Figma MCP");
 * 2 = its name starts with the brand; 1 = it only mentions the brand.
 */
function unofficialKeys(name: string, server: Record<string, unknown>, brands: Map<string, string>): Map<string, number> {
  const keys = new Map<string, number>();
  const note = (key: string, score: number) => keys.set(key, Math.max(score, keys.get(key) ?? 0));
  const website = remoteUrl(server.websiteUrl);
  const websiteDomain = website && siteDomain(new URL(website).hostname);
  if (websiteDomain && !GENERIC_HOSTS.has(websiteDomain)) note(websiteDomain, 3);

  const names = [name.split('/').pop() ?? '', typeof server.title === 'string' ? server.title : ''];
  for (const text of names) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const core = brandOf(words.filter((w) => !/^(mcp|server|api)$/.test(w)).join(''));
    // Adjacent pairs too, so `google-sheets` matches the brand `googlesheets`.
    const pairs = words.slice(1).map((word, i) => words[i] + word);
    for (const word of [...words, ...pairs]) {
      const key = brands.get(word);
      if (key) note(key, core === word ? 3 : core.startsWith(word) ? 2 : 1);
    }
  }
  return keys;
}

// Remote servers first (no local setup), then shorter names, which tend to be the flagship server.
const byPreference = (a: McpServer, b: McpServer) =>
  Number(b.install.kind === 'remote') - Number(a.install.kind === 'remote') || a.id.length - b.id.length || a.id.localeCompare(b.id);

/** The clearest matches first, one per publisher, so bulk publishers can't fill a site's list. */
function bestUnofficial(candidates: { server: McpServer; score: number }[]): McpServer[] {
  const publishers = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score || byPreference(a.server, b.server))
    .filter(({ server }) => {
      const publisher = server.id.split('/')[0]!;
      if (publishers.has(publisher)) return false;
      publishers.add(publisher);
      return true;
    })
    .slice(0, MAX_UNOFFICIAL)
    .map(({ server }) => server);
}

/** Build the index from registry API entries (`{ server, _meta }`). */
export function buildIndex(entries: RegistryEntry[], generatedAt: string, options: BuildOptions = {}): RegistryIndex {
  const official: Record<string, McpServer[]> = {};
  const unofficial: Record<string, { server: McpServer; score: number }[]> = {};
  for (const entry of entries) {
    const name = entry.server?.name;
    const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status;
    if (typeof name !== 'string' || !entry.server || (status && status !== 'active')) continue;
    const server = fromServerJson(entry.server, 'registry', name);
    if (!server) continue;
    const owner = namespaceDomain(name) ?? githubOwnerDomain(name, entry.server);
    if (owner) (official[owner] ??= []).push(server);
    // Also list it, as unofficial, on the other sites it's for (waystation.ai's Gmail server on Gmail).
    for (const [key, score] of unofficialKeys(name, entry.server, options.brands ?? new Map())) {
      if (key !== owner) (unofficial[key] ??= []).push({ server: { ...server, unofficial: true }, score });
    }
  }
  const domains: Record<string, McpServer[]> = {};
  for (const key of new Set([...Object.keys(official), ...Object.keys(unofficial)])) {
    domains[key] = [...(official[key] ?? []).sort(byPreference).slice(0, MAX_OFFICIAL), ...bestUnofficial(unofficial[key] ?? [])];
  }
  return { generatedAt, domains };
}
