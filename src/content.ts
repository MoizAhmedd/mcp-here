// The corner bar. Runs on every https page but only builds UI when the site has a server.
import { harnessById, type Harness } from './lib/harnesses.ts';
import { displayName, onlyUnofficial, publisherOf, summary } from './lib/labels.ts';
import type { Request, SiteInfo, UpdateMessage } from './lib/messages.ts';
import type { NamedServer } from './lib/types.ts';
import { actionLabel, appIcon, copyText, primaryApp, renderAppList, renderToast, trustTag } from './ui/apps.ts';
import { GLYPHS } from './ui/icons.ts';
import { BAR_CSS } from './ui/styles.ts';

const AUTO_COLLAPSE_MS = 6000;
const TOAST_MS = 4000;

type View = 'bar' | 'menu' | 'toast' | 'tab';

let info: SiteInfo;
let preferred: Harness = harnessById(undefined);
let server: NamedServer;
let view: View = 'bar';
let toast: HTMLElement | undefined;
let hovering = false;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
/** Whether the bar should be on the page; the page itself may remove our element. */
let mounted = false;

const host = document.createElement('div');
const root = host.attachShadow({ mode: 'open' });
const wrap = document.createElement('div');
wrap.className = 'wrap';

const send = <T>(message: Request) => chrome.runtime.sendMessage(message) as Promise<T>;

function button(className: string, markup: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.innerHTML = markup;
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

function scheduleCollapse(): void {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (view === 'bar' && !hovering) show('tab');
  }, AUTO_COLLAPSE_MS);
}

async function run(harness: Harness): Promise<void> {
  const action = harness.build(server);
  if (!action) return;
  const clip = action.type === 'copy' ? action.text : action.copy;
  if (clip) await copyText(clip, root);
  if (action.type === 'open') await send({ type: 'open', url: action.url });
  toast = renderToast(harness, action);
  show('toast');
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => show('tab'), TOAST_MS);
}

function openSetup(): void {
  if (server.setupUrl) send({ type: 'open', url: server.setupUrl });
}

function dot(): HTMLElement {
  const node = document.createElement('span');
  node.className = onlyUnofficial(info.servers) ? 'dot amber' : 'dot';
  return node;
}

async function pick(harness: Harness): Promise<void> {
  preferred = harness;
  await chrome.storage.sync.set({ harness: harness.id });
  await run(harness);
}

function renderBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bar';

  const lead = document.createElement('span');
  lead.className = 'lead';
  const label = document.createElement('span');
  const name = document.createElement('b');
  const { name: who, rest } = summary(info.servers, info.domain!);
  name.textContent = who;
  label.append(name, rest);
  lead.append(dot(), label);

  const split = document.createElement('div');
  split.className = 'split';
  let main: HTMLButtonElement;
  if (server.setupUrl) {
    // The URL alone won't work until the provider's setup is done, so lead with the guide.
    const setupLabel = `Set up ${displayName(server)} MCP`;
    main = button('main', GLYPHS.open, setupLabel, openSetup);
    main.append(setupLabel);
  } else {
    const app = primaryApp(server, preferred);
    main = button('main', '', actionLabel(app), () => run(app));
    main.append(appIcon(app), actionLabel(app));
  }
  const caret = button('caret', GLYPHS.caret, 'Choose app', () => show(view === 'menu' ? 'bar' : 'menu'));
  caret.setAttribute('aria-expanded', String(view === 'menu'));
  split.append(main, caret);

  const close = button('close', GLYPHS.close, `Hide on ${info.domain}`, () => {
    send({ type: 'bar', domain: info.domain!, dismissed: true });
    unmount();
  });
  bar.append(lead, split, close);
  return bar;
}

function div(className: string, value = ''): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = value;
  return node;
}

function renderServerList(): HTMLElement[] {
  const rows = info.servers.map((option) => {
    const row = button('pick', '', displayName(option), () => {
      server = option;
      show('menu');
    });
    row.setAttribute('aria-pressed', String(option === server));
    const name = document.createElement('span');
    name.className = 'pick-name';
    const by = document.createElement('span');
    by.className = 'pick-by';
    by.textContent = ` by ${publisherOf(option, info.domain!)}`;
    name.append(displayName(option), by);
    row.append(name, trustTag(option));
    return row;
  });
  return [div('section', 'Servers'), ...rows, div('divider')];
}

function renderMenu(): HTMLElement {
  const menu = div('menu');
  if (info.servers.length > 1) menu.append(...renderServerList());
  const publisher = publisherOf(server, info.domain!);
  if (server.setupUrl) {
    const note = div('note setup', `${server.setupNote ?? 'Needs setup before it works.'} `);
    const guide = button('', '', 'Setup guide', openSetup);
    guide.textContent = 'Setup guide ↗';
    note.append(guide);
    menu.append(note, div('menu-head', 'Then add it to…'));
  } else if (server.unofficial) {
    menu.append(
      div('note', `Not made by ${info.domain}. Check the publisher before connecting your account.`),
      div('menu-head', `Add ${displayName(server)} (${publisher}) to…`),
    );
  } else {
    menu.append(div('menu-head', `Add ${displayName(server)} MCP to…`));
  }
  menu.append(renderAppList({ server, selected: primaryApp(server, preferred), onPick: pick }));
  return menu;
}

function show(next: View): void {
  view = next;
  wrap.replaceChildren();
  if (view === 'tab') {
    const { name, rest } = summary(info.servers, info.domain!);
    const tab = button('tab', GLYPHS.plug, name + rest, () => {
      show('bar');
      scheduleCollapse();
    });
    tab.append(dot());
    wrap.append(tab);
  } else if (view === 'toast' && toast) {
    wrap.append(toast);
  } else {
    if (view === 'menu') wrap.append(renderMenu());
    wrap.append(renderBar());
  }
}

// The end of <body> is the one place React tolerates extra elements while hydrating;
// adding to <html> makes hydration fail and the page re-render (railway.com does this).
function attach(): void {
  (document.body ?? document.documentElement).append(host);
}

function unmount(): void {
  mounted = false;
  host.remove();
}

function render(next: SiteInfo): void {
  info = next;
  if (!info.domain || !info.servers.length || info.bar === 'hidden') {
    unmount();
    return;
  }
  server = info.servers.find((s) => s.id === server?.id) ?? info.servers[0]!;
  if (!mounted) {
    mounted = true;
    attach();
    if (info.bar === 'open') {
      send({ type: 'bar', domain: info.domain, seen: true });
      show('bar');
      scheduleCollapse();
    } else show('tab');
  } else show(view);
}

/** Resolves once the page has loaded and gone idle, so the bar doesn't compete with the page's own startup. */
function pageSettled(): Promise<void> {
  return new Promise((resolve) => {
    const idle = () => requestIdleCallback(() => resolve(), { timeout: 2000 });
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
  });
}

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  root.append(style, wrap);
  wrap.addEventListener('mouseenter', () => (hovering = true));
  wrap.addEventListener('mouseleave', () => {
    hovering = false;
    if (view === 'bar') scheduleCollapse();
  });
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && view === 'menu') show('bar');
  });
  document.addEventListener('click', (event) => {
    if (view === 'menu' && !event.composedPath().includes(host)) show('bar');
  });
  // Single-page apps sometimes replace <body> or clear its children; put the bar back.
  let reattached = 0;
  const keepAttached = new MutationObserver(() => {
    if (mounted && !host.isConnected && reattached++ < 20) attach();
    if (document.body) keepAttached.observe(document.body, { childList: true });
  });
  keepAttached.observe(document.documentElement, { childList: true });
  if (document.body) keepAttached.observe(document.body, { childList: true });
  chrome.runtime.onMessage.addListener((message: UpdateMessage) => {
    if (message?.type === 'update') render(message);
  });

  const [stored, first] = await Promise.all([
    chrome.storage.sync.get('harness'),
    send<SiteInfo>({ type: 'page' }),
    pageSettled(),
  ]);
  preferred = harnessById(stored.harness as string | undefined);
  if (first) render(first);
}

main();
