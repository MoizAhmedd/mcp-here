// Toolbar popup: the same app list as the corner bar, for when you'd rather click the icon.
import { harnessById, type Harness } from './lib/harnesses.ts';
import { publisherOf } from './lib/labels.ts';
import type { Request, SiteInfo } from './lib/messages.ts';
import type { NamedServer } from './lib/types.ts';
import { copyText, primaryApp, renderAppList, renderToast, trustTag } from './ui/apps.ts';
import { APPS_CSS } from './ui/styles.ts';

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const send = <T>(message: Request) => chrome.runtime.sendMessage(message) as Promise<T>;

let tabId: number;
let preferred: Harness;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

async function pick(server: NamedServer, harness: Harness): Promise<void> {
  const action = harness.build(server);
  if (!action) return;
  preferred = harness;
  await chrome.storage.sync.set({ harness: harness.id });
  const clip = action.type === 'copy' ? action.text : action.copy;
  if (clip) await copyText(clip);
  if (action.type === 'open') await send({ type: 'open', url: action.url, tabId });
  $('#toast').replaceChildren(renderToast(harness, action));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').replaceChildren(), 4000);
}

function renderServer(server: NamedServer, domain: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'server';
  const head = document.createElement('div');
  head.className = 'server-head';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = server.title;
  head.append(title, trustTag(server));
  const by = document.createElement('p');
  by.className = 'source';
  by.textContent = `by ${publisherOf(server, domain)}`;
  section.append(head, by);
  if (server.description) {
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = server.description;
    section.append(description);
  }
  if (server.setupUrl) {
    const note = document.createElement('div');
    note.className = 'note setup';
    note.textContent = `${server.setupNote ?? 'Needs setup before it works.'} `;
    const guide = document.createElement('button');
    guide.type = 'button';
    guide.textContent = 'Setup guide ↗';
    guide.addEventListener('click', () => send({ type: 'open', url: server.setupUrl!, tabId }));
    note.append(guide);
    section.append(note);
  } else if (server.unofficial) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = `Not made by ${domain}. Check the publisher before connecting your account.`;
    section.append(note);
  }
  section.append(renderAppList({ server, selected: primaryApp(server, preferred), onPick: (h) => pick(server, h) }));
  return section;
}

function renderFooter(info: SiteInfo): void {
  if (!info.domain || !info.servers.length || info.bar !== 'hidden') return;
  const footer = $('#footer');
  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = 'Show the corner button on this site again';
  show.addEventListener('click', async () => {
    await send({ type: 'bar', domain: info.domain!, dismissed: false });
    footer.textContent = 'It will be back next time you load the page.';
  });
  footer.append(show);
  footer.hidden = false;
}

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = APPS_CSS;
  document.head.append(style);

  const [[tab], stored] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.sync.get('harness'),
  ]);
  tabId = tab!.id!;
  preferred = harnessById(stored.harness as string | undefined);
  const info = await send<SiteInfo>({ type: 'lookup', url: tab?.url ?? '', tabId });

  $('#domain').textContent = info.domain ?? 'MCP Here';
  $('#summary').textContent = info.servers.length
    ? `${info.servers.length} MCP server${info.servers.length === 1 ? '' : 's'}`
    : info.domain
      ? 'No MCP server found'
      : '';
  const list = $('#servers');
  if (!info.servers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = info.domain
      ? "Checked the site's /.well-known files and the official MCP registry."
      : 'Open a website to check it for an MCP server.';
    list.append(empty);
  }
  for (const server of info.servers) list.append(renderServer(server, info.domain!));
  renderFooter(info);
}

main();
