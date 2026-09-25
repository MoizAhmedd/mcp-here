import { discoverSite } from './lib/discovery.ts';
import { siteDomain } from './lib/domain.ts';
import { isRegistryIndex, lookup, type RegistryIndex } from './lib/registry.ts';
import { nameServers } from './lib/servers.ts';
import type { McpServer, NamedServer } from './lib/types.ts';

export interface LookupRequest {
  type: 'lookup';
  url: string;
}

export interface LookupResponse {
  domain: string | null;
  servers: NamedServer[];
}

// Rebuilt daily by a GitHub Action and published as a release asset, so new registry
// servers show up without an extension update.
const REMOTE_INDEX_URL = 'https://github.com/MoizAhmedd/mcp-here/releases/download/registry-index/registry-index.json';
const INDEX_CACHE = 'registry-index';
const REFRESH_ALARM = 'refresh-index';
const SITE_TTL_MS = 12 * 60 * 60 * 1000;

let indexPromise: Promise<RegistryIndex> | undefined;

function loadIndex(): Promise<RegistryIndex> {
  indexPromise ??= (async () => {
    const cached = await (await caches.open(INDEX_CACHE)).match(REMOTE_INDEX_URL);
    const index: unknown = await (cached ?? (await fetch(chrome.runtime.getURL('registry-index.json')))).json();
    if (!isRegistryIndex(index)) throw new Error('Invalid registry index');
    return index;
  })();
  indexPromise.catch(() => (indexPromise = undefined));
  return indexPromise;
}

async function refreshIndex(): Promise<void> {
  const res = await fetch(REMOTE_INDEX_URL, { cache: 'no-cache' });
  if (!res.ok || !isRegistryIndex(await res.clone().json())) return;
  await (await caches.open(INDEX_CACHE)).put(REMOTE_INDEX_URL, res);
  indexPromise = undefined;
}

const inFlight = new Map<string, Promise<McpServer[]>>();

/** Servers the site publishes itself. Cached per browser session so each domain is checked about once. */
async function siteServers(domain: string): Promise<McpServer[]> {
  const key = `site:${domain}`;
  const cached = (await chrome.storage.session.get(key))[key] as { servers: McpServer[]; checkedAt: number } | undefined;
  if (cached && Date.now() - cached.checkedAt < SITE_TTL_MS) return cached.servers;

  let pending = inFlight.get(domain);
  if (!pending) {
    pending = discoverSite(domain).then(async (servers) => {
      await chrome.storage.session.set({ [key]: { servers, checkedAt: Date.now() } });
      return servers;
    });
    pending.finally(() => inFlight.delete(domain));
    inFlight.set(domain, pending);
  }
  return pending;
}

async function lookupUrl(url: string | undefined): Promise<LookupResponse> {
  const domain = url?.startsWith('https://') ? siteDomain(new URL(url).hostname) : null;
  if (!domain) return { domain: null, servers: [] };
  const [site, index] = await Promise.all([siteServers(domain), loadIndex().catch(() => undefined)]);
  return { domain, servers: nameServers([...site, ...(index ? lookup(index, domain) : [])], domain) };
}

async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
  const { domain, servers } = await lookupUrl(url);
  // The tab may have navigated elsewhere while we were fetching.
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || tab.url !== url) return;
  const count = servers.length;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  await chrome.action.setTitle({
    tabId,
    title: count ? `${domain} has ${count === 1 ? 'an MCP server' : `${count} MCP servers`}` : 'MCP Here',
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Drop an index cached by an older version; the bundled one may be newer.
  await caches.delete(INDEX_CACHE);
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 1 });
});

// Alarms aren't guaranteed to survive a browser restart.
chrome.runtime.onStartup.addListener(async () => {
  if (!(await chrome.alarms.get(REFRESH_ALARM))) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshIndex().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'complete') updateBadge(tabId, tab.url).catch(() => {});
});

chrome.runtime.onMessage.addListener((message: LookupRequest, _sender, sendResponse) => {
  if (message?.type !== 'lookup') return false;
  lookupUrl(message.url).then(sendResponse, () => sendResponse({ domain: null, servers: [] }));
  return true;
});
