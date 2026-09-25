import type { InstallSpec, NamedServer } from './types.ts';

/** What clicking a harness does: copy text, or open a deeplink that installs directly. */
export type Action =
  | { type: 'copy'; text: string }
  | { type: 'open'; url: string; preview: string; copy?: string };

export interface Harness {
  id: string;
  label: string;
  /** Where the copied text goes, or what happens after the link opens. */
  hint: string;
  build(server: NamedServer): Action | undefined;
}

const PLACEHOLDER = '<value>';

/** Quote a token for POSIX shells unless it is obviously safe. */
export function shq(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}

const cmd = (tokens: string[]) => tokens.map(shq).join(' ');

function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

const headerFlags = (flag: string, spec: InstallSpec) =>
  spec.kind === 'remote' ? spec.headers.flatMap((name) => [flag, `${name}: ${PLACEHOLDER}`]) : [];

const envFlags = (flag: string, spec: InstallSpec) =>
  spec.kind === 'stdio' ? spec.env.flatMap((name) => [flag, `${name}=${PLACEHOLDER}`]) : [];

function placeholders(names: string[]): Record<string, string> | undefined {
  return names.length ? Object.fromEntries(names.map((name) => [name, PLACEHOLDER])) : undefined;
}

/** The `{url}` / `{command, args}` object most JSON configs use for one server. */
function serverConfig(spec: InstallSpec, remoteUrlKey = 'url') {
  return spec.kind === 'remote'
    ? { [remoteUrlKey]: spec.url, headers: placeholders(spec.headers) }
    : { command: spec.command, args: spec.args, env: placeholders(spec.env) };
}

export const HARNESSES: Harness[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    hint: 'Run in your terminal. Adds it for all projects.',
    build: ({ slug, install }) => ({
      type: 'copy',
      text:
        install.kind === 'remote'
          ? cmd(['claude', 'mcp', 'add', '--scope', 'user', '--transport', install.transport, slug, install.url, ...headerFlags('--header', install)])
          : cmd(['claude', 'mcp', 'add', '--scope', 'user', slug, ...envFlags('--env', install), '--', install.command, ...install.args]),
    }),
  },
  {
    id: 'claude',
    label: 'Claude app',
    hint: 'URL copied. In Claude, click "Add custom connector" and paste it.',
    build: ({ install }) =>
      install.kind === 'remote' && !install.headers.length
        ? { type: 'open', url: 'https://claude.ai/customize/connectors', preview: install.url, copy: install.url }
        : undefined,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Opens Cursor to confirm the install.',
    build: ({ slug, install }) => {
      const config = serverConfig(install);
      const url = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(slug)}&config=${encodeURIComponent(base64(JSON.stringify(config)))}`;
      return { type: 'open', url, preview: json({ [slug]: config }) };
    },
  },
  {
    id: 'vscode',
    label: 'VS Code',
    hint: 'Opens VS Code to confirm the install.',
    build: ({ slug, install }) => {
      const config =
        install.kind === 'remote'
          ? { name: slug, type: install.transport, url: install.url, headers: placeholders(install.headers) }
          : { name: slug, type: 'stdio', command: install.command, args: install.args, env: placeholders(install.env) };
      return { type: 'open', url: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`, preview: json(config) };
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    hint: 'Run in your terminal.',
    build: ({ slug, install }) => ({
      type: 'copy',
      text:
        install.kind === 'remote'
          ? cmd(['codex', 'mcp', 'add', slug, '--url', install.url])
          : cmd(['codex', 'mcp', 'add', slug, ...envFlags('--env', install), '--', install.command, ...install.args]),
    }),
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    hint: 'Run in your terminal. Adds it for all projects.',
    build: ({ slug, install }) => ({
      type: 'copy',
      text:
        install.kind === 'remote'
          ? cmd(['gemini', 'mcp', 'add', '--scope', 'user', '--transport', install.transport, ...headerFlags('--header', install), slug, install.url])
          : cmd(['gemini', 'mcp', 'add', '--scope', 'user', ...envFlags('-e', install), slug, install.command, '--', ...install.args]),
    }),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    hint: 'Merge into ~/.codeium/windsurf/mcp_config.json.',
    build: ({ slug, install }) => ({ type: 'copy', text: json({ mcpServers: { [slug]: serverConfig(install, 'serverUrl') } }) }),
  },
  {
    id: 'goose',
    label: 'Goose',
    hint: 'Opens Goose to confirm the install.',
    build: ({ slug, title, description, install }) => {
      const params = new URLSearchParams({ id: slug, name: title, description: description ?? title });
      if (install.kind === 'remote') {
        params.set('url', install.url);
        params.set('type', install.transport === 'sse' ? 'sse' : 'streamable_http');
      } else {
        params.set('cmd', install.command);
        for (const arg of install.args) params.append('arg', arg);
        for (const name of install.env) params.append('env', `${name}=${name}`);
      }
      return { type: 'open', url: `goose://extension?${params}`, preview: json({ [slug]: serverConfig(install) }) };
    },
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    hint: 'Opens LM Studio to confirm the install.',
    build: ({ slug, install }) => {
      const config = serverConfig(install);
      const url = `lmstudio://add_mcp?name=${encodeURIComponent(slug)}&config=${encodeURIComponent(base64(JSON.stringify(config)))}`;
      return { type: 'open', url, preview: json({ [slug]: config }) };
    },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    hint: 'Merge into opencode.json.',
    build: ({ slug, install }) => ({
      type: 'copy',
      text: json({
        mcp: {
          [slug]:
            install.kind === 'remote'
              ? { type: 'remote', url: install.url, headers: placeholders(install.headers) }
              : { type: 'local', command: [install.command, ...install.args], environment: placeholders(install.env) },
        },
      }),
    }),
  },
  {
    id: 'json',
    label: 'JSON config',
    hint: 'Standard mcpServers entry for any other client.',
    build: ({ slug, install }) => ({
      type: 'copy',
      text: json({
        mcpServers: {
          [slug]: install.kind === 'remote' ? { type: install.transport, ...serverConfig(install) } : serverConfig(install),
        },
      }),
    }),
  },
  {
    id: 'url',
    label: 'Server URL',
    hint: 'Paste into any client that takes a URL, like ChatGPT.',
    build: ({ install }) => (install.kind === 'remote' ? { type: 'copy', text: install.url } : undefined),
  },
];

export const DEFAULT_HARNESS = 'claude-code';

export function harnessById(id: string | undefined): Harness {
  return HARNESSES.find((h) => h.id === id) ?? HARNESSES.find((h) => h.id === DEFAULT_HARNESS)!;
}
