import type { BarMode } from './store.ts';
import type { NamedServer } from './types.ts';

/** What the extension knows about a tab's site. */
export interface SiteInfo {
  domain: string | null;
  servers: NamedServer[];
  bar: BarMode;
}

export type Request =
  /** From the page script on load. */
  | { type: 'page' }
  /** From the popup, which waits for a live check if one is due. */
  | { type: 'lookup'; url: string; tabId: number }
  /** Open an install deeplink or web page. */
  | { type: 'open'; url: string; tabId?: number }
  | { type: 'bar'; domain: string; seen?: boolean; dismissed?: boolean };

/** Pushed to the page script when a background check changes what we know. */
export interface UpdateMessage extends SiteInfo {
  type: 'update';
}
