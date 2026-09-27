import type { McpServer } from './types.ts';

/** How long this browser trusts its own check of a site before checking again. */
export const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** This browser's own check of a site's `/.well-known` files. */
export interface SiteCheck {
  servers: McpServer[];
  checkedAt: number;
}

export function needsCheck(check: SiteCheck | undefined, now: number): boolean {
  return !check || now - check.checkedAt >= RECHECK_MS;
}

/**
 * Combine the shared store with this browser's own check. The check is newer
 * than the store's weekly crawl, so it replaces what the store says the site
 * publishes; registry and hand-listed entries always stay.
 */
export function combine(stored: McpServer[], check: SiteCheck | undefined): McpServer[] {
  const servers = check ? [...check.servers, ...stored.filter((server) => server.source !== 'site')] : stored;
  // Official servers first, whichever index key they came from.
  return [...servers.filter((s) => !s.unofficial), ...servers.filter((s) => s.unofficial)];
}

/**
 * Merge the store's entries for a page, given most specific key first
 * (mail.google.com before google.com). Official servers come from every level;
 * unofficial ones only from the most specific level that has any servers, so
 * Gmail doesn't inherit google.com's loose matches.
 */
export function mergeLevels(levels: McpServer[][]): McpServer[] {
  const nearest = levels.find((servers) => servers.length) ?? [];
  return [...levels.flatMap((servers) => servers.filter((s) => !s.unofficial)), ...nearest.filter((s) => s.unofficial)];
}

/** Whether the corner bar has been seen or dismissed on a site. */
export interface BarState {
  seen?: boolean;
  dismissed?: boolean;
}

export type BarMode = 'open' | 'collapsed' | 'hidden';

/**
 * Open on the first visit to a site, a collapsed tab after that, gone once dismissed.
 * Sites with only unofficial servers never open on their own.
 */
export function barMode(state: BarState | undefined, unofficialOnly = false): BarMode {
  if (state?.dismissed) return 'hidden';
  return state?.seen || unofficialOnly ? 'collapsed' : 'open';
}

/**
 * Storage key for per-site data. Hashed, so what's saved about the sites you
 * visit doesn't read as a browsing history.
 */
export async function siteKey(prefix: string, domain: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(domain));
  const hex = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex}`;
}
