import { discoverSite } from './lib/discovery.ts';
import { siteDomain } from './lib/domain.ts';
import { onlyUnofficial } from './lib/labels.ts';
import type { Request, SiteInfo, UpdateMessage } from './lib/messages.ts';
import { isRegistryIndex, pageKeys, type RegistryIndex } from './lib/registry.ts';
import { installKey, nameServers } from './lib/servers.ts';
import { barMode, combine, mergeLevels, needsCheck, RECHECK_MS, siteKey, type BarState, type SiteCheck } from './lib/store.ts';
import type { McpServer } from './lib/types.ts';

// Rebuilt weekly by a GitHub Action (registry + crawl of popular sites) and served from GitHub Pages.
const REMOTE_INDEX_URL = 'https://moizahmedd.github.io/mcp-here/data/index.json';
const REFRESH_ALARM = 'refresh-index';
const REFRESH_MINUTES = 7 * 24 * 60;
const INDEX_META = 'index:meta';

// Storage layout (chrome.storage.local):
//   index:meta        { generatedAt, domains } for the installed store
//   s:<key>           the store's servers for a domain, host or host/path (public data, so plain keys)
//   c:<hash>          this browser's own check of a site (SiteCheck)
//   b:<hash>          corner bar state for a site (BarState)

interface IndexMeta {
  generatedAt: string;
  domains: string[];
}

/** Save the store one key per domain, so a lookup reads one small entry instead of the whole index. */
async function installIndex(index: RegistryIndex): Promise<void> {
  const { [INDEX_META]: meta } = (await chrome.storage.local.get(INDEX_META)) as { [INDEX_META]?: IndexMeta };
  if (meta && meta.generatedAt >= index.generatedAt) return;
  const entries = Object.fromEntries(Object.entries(index.domains).map(([domain, servers]) => [`s:${domain}`, servers]));
  await chrome.storage.local.set({ ...entries, [INDEX_META]: { generatedAt: index.generatedAt, domains: Object.keys(index.domains) } });
  const stale = (meta?.domains ?? []).filter((domain) => !(domain in index.domains)).map((domain) => `s:${domain}`);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function fetchIndex(url: string): Promise<RegistryIndex | undefined> {
  const res = await fetch(url, { cache: 'no-cache' });
  const index: unknown = res.ok ? await res.json() : undefined;
  return isRegistryIndex(index) ? index : undefined;
}

async function refresh(): Promise<void> {
  const index = await fetchIndex(REMOTE_INDEX_URL).catch(() => undefined);
  if (index) await installIndex(index);
  await pruneChecks();
}

/** Drop site checks old enough that they'd be redone anyway. */
async function pruneChecks(): Promise<void> {
  const keys = (await chrome.storage.local.getKeys()).filter((key) => key.startsWith('c:'));
  const checks = (await chrome.storage.local.get(keys)) as Record<string, SiteCheck>;
  const expired = Object.entries(checks).filter(([, check]) => Date.now() - check.checkedAt >= RECHECK_MS);
  if (expired.length) await chrome.storage.local.remove(expired.map(([key]) => key));
}

async function storedServers(keys: string[]): Promise<McpServer[]> {
  const storageKeys = keys.map((key) => `s:${key}`);
  const found = (await chrome.storage.local.get(storageKeys)) as Record<string, McpServer[]>;
  return mergeLevels(storageKeys.map((key) => found[key] ?? []));
}

async function getSiteData(domain: string): Promise<{ check?: SiteCheck; bar?: BarState }> {
  const [checkKey, barKey] = await Promise.all([siteKey('c', domain), siteKey('b', domain)]);
  const found = await chrome.storage.local.get([checkKey, barKey]);
  return { check: found[checkKey] as SiteCheck | undefined, bar: found[barKey] as BarState | undefined };
}

const inFlight = new Map<string, Promise<SiteCheck>>();

/** Check a site's own /.well-known files and remember the result for this browser. */
function checkSite(domain: string): Promise<SiteCheck> {
  let pending = inFlight.get(domain);
  if (!pending) {
    pending = (async () => {
      const check: SiteCheck = { servers: await discoverSite(domain), checkedAt: Date.now() };
      await chrome.storage.local.set({ [await siteKey('c', domain)]: check });
      return check;
    })();
    pending.finally(() => inFlight.delete(domain));
    inFlight.set(domain, pending);
  }
  return pending;
}

const sameServers = (a: McpServer[], b: McpServer[]) =>
  a.map((s) => installKey(s.install)).join('|') === b.map((s) => installKey(s.install)).join('|');

async function setBadge(tabId: number, info: SiteInfo): Promise<void> {
  const count = info.servers.length;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: onlyUnofficial(info.servers) ? '#d97706' : '#16a34a' });
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  await chrome.action.setTitle({
    tabId,
    title: count ? `${info.domain} has ${count === 1 ? 'an MCP server' : `${count} MCP servers`}` : 'MCP Here',
  });
}

/**
 * What we know about a site: the store plus this browser's own check. If the
 * check is missing or over a week old, re-check the site. The popup waits for
 * that; the page gets an answer now and an update if the check changes it.
 */
async function lookup(url: string | undefined, tabId: number | undefined, wait: boolean): Promise<SiteInfo> {
  const page = url?.startsWith('https://') ? new URL(url) : undefined;
  const domain = page ? siteDomain(page.hostname) : null;
  if (!page || !domain) return { domain: null, servers: [], bar: 'hidden' };
  const [stored, { check, bar }] = await Promise.all([storedServers(pageKeys(page, domain)), getSiteData(domain)]);
  const info = (latest: SiteCheck | undefined): SiteInfo => {
    const servers = nameServers(combine(stored, latest), domain);
    return { domain, servers, bar: barMode(bar, onlyUnofficial(servers)) };
  };

  if (needsCheck(check, Date.now())) {
    const pending = checkSite(domain);
    if (wait) return info(await pending);
    pending
      .then(async (fresh) => {
        if (tabId === undefined || sameServers(combine(stored, check), combine(stored, fresh))) return;
        const tab = await chrome.tabs.get(tabId).catch(() => undefined);
        if (!tab?.url || siteDomain(new URL(tab.url).hostname) !== domain) return;
        const update: UpdateMessage = { type: 'update', ...info(fresh) };
        await setBadge(tabId, update);
        await chrome.tabs.sendMessage(tabId, update).catch(() => {});
      })
      .catch(() => {});
  }
  return info(check);
}

async function setBar(domain: string, change: BarState): Promise<void> {
  const key = await siteKey('b', domain);
  const current = ((await chrome.storage.local.get(key))[key] ?? {}) as BarState;
  await chrome.storage.local.set({ [key]: { ...current, ...change } });
}

async function handle(message: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'page': {
      const tabId = sender.tab?.id;
      const info = await lookup(sender.tab?.url, tabId, false);
      if (tabId !== undefined) await setBadge(tabId, info);
      return info;
    }
    case 'lookup': {
      const info = await lookup(message.url, message.tabId, true);
      await setBadge(message.tabId, info);
      return info;
    }
    case 'open': {
      const tabId = message.tabId ?? sender.tab?.id;
      // Custom schemes (cursor://, vscode:) hand off to the app without leaving the page.
      if (message.url.startsWith('https://')) await chrome.tabs.create({ url: message.url });
      else if (tabId !== undefined) await chrome.tabs.update(tabId, { url: message.url });
      return true;
    }
    case 'bar':
      await setBar(message.domain, { seen: message.seen, dismissed: message.dismissed });
      return true;
  }
}

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  handle(message, sender).then(sendResponse, () => sendResponse(undefined));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES, delayInMinutes: 1 });
  const bundled = await fetchIndex(chrome.runtime.getURL('index.json'));
  if (bundled) await installIndex(bundled);
});

// Alarms aren't guaranteed to survive a browser restart.
chrome.runtime.onStartup.addListener(async () => {
  if (!(await chrome.alarms.get(REFRESH_ALARM))) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES, delayInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refresh().catch(() => {});
});
