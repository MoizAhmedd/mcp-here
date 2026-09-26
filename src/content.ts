// The corner bar. Runs on every https page but only builds UI when the site has a server.
import { harnessById, type Harness } from './lib/harnesses.ts';
import type { Request, SiteInfo, UpdateMessage } from './lib/messages.ts';
import type { NamedServer } from './lib/types.ts';
import { actionLabel, appIcon, copyText, primaryApp, renderAppList, renderToast } from './ui/apps.ts';
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
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  const name = document.createElement('b');
  const many = info.servers.length > 1;
  name.textContent = many ? info.domain! : server.title;
  label.append(name, many ? ` has ${info.servers.length} MCP servers` : ' has an MCP server');
  lead.append(dot, label);

  const app = primaryApp(server, preferred);
  const split = document.createElement('div');
  split.className = 'split';
  const main = button('main', '', actionLabel(app), () => run(app));
  main.append(appIcon(app), actionLabel(app));
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

function renderMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'menu';
  const head = document.createElement('div');
  head.className = 'menu-head';
  head.textContent = `Add ${server.title} MCP to…`;
  menu.append(head);
  if (info.servers.length > 1) {
    const chooser = document.createElement('div');
    chooser.className = 'servers';
    for (const option of info.servers) {
      const chip = button('', '', option.title, () => {
        server = option;
        show('menu');
      });
      chip.textContent = option.title;
      chip.setAttribute('aria-pressed', String(option === server));
      chooser.append(chip);
    }
    menu.append(chooser);
  }
  menu.append(renderAppList({ server, selected: primaryApp(server, preferred), onPick: pick }));
  return menu;
}

function show(next: View): void {
  view = next;
  wrap.replaceChildren();
  if (view === 'tab') {
    const tab = button('tab', GLYPHS.plug, `${info.domain} has an MCP server`, () => {
      show('bar');
      scheduleCollapse();
    });
    const dot = document.createElement('span');
    dot.className = 'dot';
    tab.append(dot);
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
