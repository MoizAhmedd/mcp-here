import { FEATURED, HARNESSES, type Action, type Harness } from '../lib/harnesses.ts';
import { TRUST_LABELS, trustOf } from '../lib/labels.ts';
import type { McpServer, NamedServer } from '../lib/types.ts';
import { APP_ICONS, GLYPHS } from './icons.ts';

/** Build an element from trusted markup (our own icons). Never pass site data here. */
function html(tag: string, className: string, markup = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = markup;
  return node;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

export function trustTag(server: McpServer): HTMLElement {
  const trust = trustOf(server);
  return text('span', `tag ${trust}`, TRUST_LABELS[trust]);
}

export function appIcon(harness: Harness): HTMLElement {
  return html('span', 'app-icon', APP_ICONS[harness.id] ?? GLYPHS.plug);
}

/** Apps that can install this server, featured ones first. */
export function appsFor(server: NamedServer): { featured: Harness[]; more: Harness[] } {
  const usable = HARNESSES.filter((h) => h.build(server));
  return {
    featured: usable.filter((h) => FEATURED.includes(h.id)).sort((x, y) => FEATURED.indexOf(x.id) - FEATURED.indexOf(y.id)),
    more: usable.filter((h) => !FEATURED.includes(h.id)),
  };
}

/** The harness the main button runs: the user's pick, or the first app that supports this server. */
export function primaryApp(server: NamedServer, preferred: Harness): Harness {
  return preferred.build(server) ? preferred : appsFor(server).featured[0] ?? appsFor(server).more[0] ?? preferred;
}

/** Main button text. "Add to" even for copy actions; the toast says what happened. */
export function actionLabel(harness: Harness): string {
  if (harness.id === 'url') return 'Copy server URL';
  if (harness.id === 'json') return 'Copy JSON config';
  return `Add to ${harness.label}`;
}

export interface AppListOptions {
  server: NamedServer;
  selected: Harness;
  onPick: (harness: Harness) => void;
}

/** One-column list of apps: icon, name, and whether it copies or opens the app. */
export function renderAppList({ server, selected, onPick }: AppListOptions): HTMLElement {
  const list = html('div', 'apps');
  list.setAttribute('role', 'menu');
  const { featured, more } = appsFor(server);

  const row = (harness: Harness) => {
    const action = harness.build(server)!;
    const button = html('button', `app${harness.id === selected.id ? ' selected' : ''}`) as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const opens = action.type === 'open' && !action.copy;
    button.title = opens ? `Opens ${harness.label}` : 'Copies to your clipboard';
    button.append(appIcon(harness), text('span', 'app-name', harness.label), html('span', 'app-kind', opens ? GLYPHS.open : GLYPHS.copy));
    button.addEventListener('click', () => onPick(harness));
    return button;
  };

  list.append(...featured.map(row));
  if (more.length) {
    const toggle = html('button', 'app more', GLYPHS.plus) as HTMLButtonElement;
    toggle.type = 'button';
    toggle.append(text('span', 'app-name', 'More apps'), text('span', 'app-note', more.map((h) => h.label).slice(0, 3).join(', ') + '…'));
    toggle.addEventListener('click', () => {
      toggle.replaceWith(...more.map(row));
    });
    list.append(html('div', 'divider'), toggle);
  }
  return list;
}

/** The confirmation shown after an action: what happened, what to do next, and the copied text if it's one line. */
export function renderToast(harness: Harness, action: Action): HTMLElement {
  const toast = html('div', 'toast');
  toast.setAttribute('role', 'status');
  const copied = action.type === 'copy' ? action.text : action.copy;
  const title = action.type === 'open' && !action.copy ? `Opening ${harness.label}…` : 'Copied.';
  const body = html('div', 'toast-body');
  body.append(text('div', 'toast-title', `${title} ${harness.hint}`));
  if (copied && !copied.includes('\n')) body.append(text('code', 'toast-code', copied));
  toast.append(html('span', 'toast-check', GLYPHS.check), body);
  return toast;
}

/** Copy text, falling back to execCommand where the async clipboard API is blocked (e.g. by a site's permissions policy). */
export async function copyText(value: string, root: Node = document.body): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    root.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Clipboard unavailable');
  }
}
