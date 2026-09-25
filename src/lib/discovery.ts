import { fromServerJson, remoteUrl } from './servers.ts';
import type { McpServer } from './types.ts';

/**
 * Where sites publish MCP metadata today. None of these are final yet
 * (SEP-1649/2127 server cards, SEP-1960 `/.well-known/mcp`, AI Catalog),
 * so we check all of them.
 */
export const DISCOVERY_PATHS = [
  '/.well-known/mcp/server-card.json',
  '/.well-known/mcp/server-cards.json',
  '/.well-known/mcp-server-card',
  '/.well-known/mcp.json',
  '/.well-known/mcp',
  '/.well-known/ai-catalog.json',
];

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;

export interface ParsedDoc {
  servers: McpServer[];
  /** Server card URLs referenced by an AI Catalog, to fetch next. */
  cardUrls: string[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Cards that only carry an endpoint (`{name, url}` or `{name, endpoint}`), e.g. Sentry's. */
function fromEndpointCard(doc: Json, id: string): McpServer | undefined {
  const url = remoteUrl(doc.endpoint) ?? remoteUrl(doc.url);
  const title = str(doc.title) ?? str(doc.name);
  if (!url || !title) return undefined;
  return {
    id,
    title,
    description: str(doc.description)?.slice(0, 200),
    source: 'site',
    install: { kind: 'remote', transport: 'http', url, headers: [] },
  };
}

function fromCard(doc: unknown, id: string): McpServer | undefined {
  if (!isObject(doc)) return undefined;
  // Registry API responses wrap each server as `{ server, _meta }`.
  if (isObject(doc.server)) return fromCard(doc.server, id);
  return fromServerJson(doc, 'site', id) ?? fromEndpointCard(doc, id);
}

function parseCatalog(doc: Json, id: string): ParsedDoc {
  const host = isObject(doc.host) ? str(doc.host.displayName) : undefined;
  const servers: McpServer[] = [];
  const cardUrls: string[] = [];
  for (const entry of Array.isArray(doc.entries) ? doc.entries.filter(isObject) : []) {
    const type = str(entry.type) ?? '';
    const url = remoteUrl(entry.url);
    if (!url) continue;
    if (type.includes('mcp-server-card')) {
      cardUrls.push(url);
      continue;
    }
    // Entries that point straight at an MCP endpoint (Supabase does this).
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const identifier = str(entry.identifier) ?? '';
    const isEndpoint = /:mcp:(server|endpoint)$/.test(identifier) || (tags.includes('mcp') && tags.includes('server'));
    if (isEndpoint && !url.endsWith('.json')) {
      servers.push({
        id: `${id}#${identifier || url}`,
        title: host ?? str(entry.displayName) ?? new URL(url).hostname,
        description: str(entry.description)?.slice(0, 200),
        source: 'site',
        install: { kind: 'remote', transport: 'http', url, headers: [] },
      });
    }
  }
  return { servers, cardUrls };
}

/** Parse any discovery document we know about. Unknown shapes yield nothing. */
export function parseDiscoveryDoc(doc: unknown, id: string): ParsedDoc {
  const empty: ParsedDoc = { servers: [], cardUrls: [] };
  if (Array.isArray(doc)) return merge(doc.map((item, i) => parseDiscoveryDoc(item, `${id}#${i}`)));
  if (!isObject(doc)) return empty;
  if (Array.isArray(doc.entries)) return parseCatalog(doc, id);
  for (const key of ['servers', 'cards', 'serverCards']) {
    if (Array.isArray(doc[key])) return parseDiscoveryDoc(doc[key], id);
  }
  // SEP-1960 style: a named manifest listing bare endpoints.
  if (Array.isArray(doc.endpoints)) {
    const endpoints = doc.endpoints.filter(isObject).map((endpoint) => ({ name: doc.name, ...endpoint }));
    return parseDiscoveryDoc(endpoints, id);
  }
  const server = fromCard(doc, id);
  return server ? { servers: [server], cardUrls: [] } : empty;
}

function merge(parts: ParsedDoc[]): ParsedDoc {
  return { servers: parts.flatMap((p) => p.servers), cardUrls: parts.flatMap((p) => p.cardUrls) };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function fetchJson(fetcher: Fetcher, url: string): Promise<unknown> {
  try {
    const res = await fetcher(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Some servers only answer their exact media type (GitHub 406s on plain application/json).
      headers: { accept: 'application/json, application/*+json, */*;q=0.8' },
    });
    if (!res.ok) return undefined;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return undefined;
    const text = await res.text();
    if (text.length > MAX_BYTES) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fetch every discovery path on a domain, following AI Catalog links one level. */
export async function discoverSite(domain: string, fetcher: Fetcher = fetch): Promise<McpServer[]> {
  const base = `https://${domain}`;
  const docs = await Promise.all(
    DISCOVERY_PATHS.map(async (path) => parseDiscoveryDoc(await fetchJson(fetcher, base + path), base + path)),
  );
  const found = merge(docs);
  const cards = await Promise.all(
    [...new Set(found.cardUrls)].slice(0, 5).map(async (url) => parseDiscoveryDoc(await fetchJson(fetcher, url), url)),
  );
  return [...found.servers, ...merge(cards).servers];
}
