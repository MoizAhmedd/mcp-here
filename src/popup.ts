import type { LookupRequest, LookupResponse } from './background.ts';
import { HARNESSES, harnessById, type Action, type Harness } from './lib/harnesses.ts';
import type { NamedServer } from './lib/types.ts';

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

let harness: Harness = harnessById(undefined);
let tabId: number | undefined;
const redraws: (() => void)[] = [];

function primaryLabel(h: Harness, action: Action | undefined): string {
  if (!action) return `Not available for ${h.label}`;
  return action.type === 'open' ? `Add to ${h.label}` : `Copy for ${h.label}`;
}

async function run(action: Action, button: HTMLButtonElement, h: Harness): Promise<void> {
  const clip = action.type === 'copy' ? action.text : action.copy;
  if (clip) await navigator.clipboard.writeText(clip);
  if (action.type === 'open') {
    // Custom schemes (cursor://, vscode:) hand off to the app without leaving the page.
    if (action.url.startsWith('https://')) await chrome.tabs.create({ url: action.url });
    else if (tabId !== undefined) await chrome.tabs.update(tabId, { url: action.url });
  }
  button.textContent = action.type === 'copy' ? 'Copied' : `Opening ${h.label}…`;
  button.classList.add('done');
  setTimeout(() => {
    button.classList.remove('done');
    redraws.forEach((redraw) => redraw());
  }, 1600);
}

function renderServer(server: NamedServer, domain: string): HTMLElement {
  const node = ($<HTMLTemplateElement>('#server-template').content.cloneNode(true) as DocumentFragment)
    .firstElementChild as HTMLElement;
  $('.title', node).textContent = server.title;
  $('.source', node).textContent = server.source === 'site' ? `Published by ${domain}` : 'MCP Registry';
  $('.description', node).textContent = server.description ?? '';

  const primary = $<HTMLButtonElement>('.primary', node);
  const toggle = $<HTMLButtonElement>('.toggle', node);
  const menu = $<HTMLDivElement>('.menu', node);
  const preview = $<HTMLPreElement>('.preview', node);
  const hint = $<HTMLParagraphElement>('.hint', node);

  const setMenuOpen = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  for (const h of HARNESSES) {
    const action = h.build(server);
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.disabled = !action;
    const label = document.createElement('span');
    label.textContent = h.label;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = !action ? 'n/a' : action.type === 'copy' ? 'copy' : action.copy ? 'copy + open' : 'one-click';
    item.append(label, kind);
    item.addEventListener('click', async () => {
      setMenuOpen(false);
      harness = h;
      await chrome.storage.sync.set({ harness: h.id });
      redraws.forEach((redraw) => redraw());
      if (action) await run(action, primary, h);
    });
    menu.append(item);
  }

  const redraw = () => {
    const action = harness.build(server);
    primary.textContent = primaryLabel(harness, action);
    primary.disabled = !action;
    preview.textContent = !action ? '' : action.type === 'copy' ? action.text : action.preview;
    preview.hidden = !action;
    hint.textContent = action ? harness.hint : 'Pick another app from the menu.';
  };
  redraws.push(redraw);
  redraw();

  primary.addEventListener('click', () => {
    const action = harness.build(server);
    if (action) run(action, primary, harness);
  });
  const isMenuOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  toggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMenuOpen()) {
      setMenuOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!node.querySelector('.split')!.contains(event.target as Node)) setMenuOpen(false);
  });
  return node;
}

function renderEmpty(domain: string | null): HTMLElement {
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = domain
    ? "Checked the site's /.well-known files and the official MCP registry."
    : 'Open a website to check it for an MCP server.';
  return box;
}

async function main(): Promise<void> {
  const [[tab], stored] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.sync.get('harness'),
  ]);
  tabId = tab?.id;
  harness = harnessById(stored.harness as string | undefined);

  const request: LookupRequest = { type: 'lookup', url: tab?.url ?? '' };
  const { domain, servers }: LookupResponse = await chrome.runtime.sendMessage(request);

  $('#domain').textContent = domain ?? 'MCP Here';
  $('#summary').textContent = servers.length
    ? `${servers.length} MCP server${servers.length === 1 ? '' : 's'}`
    : domain
      ? 'No MCP server found'
      : '';
  const list = $('#servers');
  if (!servers.length) list.append(renderEmpty(domain));
  for (const server of servers) list.append(renderServer(server, domain!));
}

main();
