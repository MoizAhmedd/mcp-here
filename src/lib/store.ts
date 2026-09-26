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
 * publishes; registry entries always stay.
 */
export function combine(stored: McpServer[], check: SiteCheck | undefined): McpServer[] {
  if (!check) return stored;
  return [...check.servers, ...stored.filter((server) => server.source === 'registry')];
}

/** Whether the corner bar has been seen or dismissed on a site. */
export interface BarState {
  seen?: boolean;
  dismissed?: boolean;
}

export type BarMode = 'open' | 'collapsed' | 'hidden';

/** Open on the first visit to a site, a collapsed tab after that, gone once dismissed. */
export function barMode(state: BarState | undefined): BarMode {
  if (state?.dismissed) return 'hidden';
  return state?.seen ? 'collapsed' : 'open';
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
