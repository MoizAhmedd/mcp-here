import { namespaceDomain, slugify } from './domain.ts';
import type { InstallSpec, McpServer, NamedServer, Source } from './types.ts';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// Identifiers end up in shell commands, so only accept plain package names.
const PACKAGE_ID = /^[A-Za-z0-9@][A-Za-z0-9@/._:+-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;

/** An https endpoint without registry-style `{placeholders}`. */
export function remoteUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw || raw.includes('{')) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function requiredNames(items: unknown, pattern: RegExp): string[] {
  return list(items)
    .filter(isObject)
    .filter((item) => item.isRequired === true && item.value === undefined)
    .map((item) => str(item.name))
    .filter((name): name is string => !!name && pattern.test(name));
}

function remoteSpec(remote: Json): InstallSpec | undefined {
  const url = remoteUrl(remote.url);
  if (!url) return undefined;
  return {
    kind: 'remote',
    transport: remote.type === 'sse' ? 'sse' : 'http',
    url,
    headers: requiredNames(remote.headers, HEADER_NAME),
  };
}

const RUNNERS: Record<string, (id: string, version?: string) => { command: string; args: string[] }> = {
  npm: (id) => ({ command: 'npx', args: ['-y', id] }),
  pypi: (id) => ({ command: 'uvx', args: [id] }),
  oci: (id, version) => ({
    command: 'docker',
    args: ['run', '-i', '--rm', version && !id.includes(':') ? `${id}:${version}` : id],
  }),
};

function packageSpec(pkg: Json): InstallSpec | undefined {
  const registry = str(pkg.registryType);
  const id = str(pkg.identifier);
  const transport = isObject(pkg.transport) ? pkg.transport.type : 'stdio';
  const runner = registry ? RUNNERS[registry] : undefined;
  if (!runner || !id || !PACKAGE_ID.test(id) || transport !== 'stdio') return undefined;
  return { kind: 'stdio', ...runner(id, str(pkg.version)), env: requiredNames(pkg.environmentVariables, ENV_NAME) };
}

/** Best install option: streamable HTTP, then SSE, then a local package. */
export function installSpec(doc: Json): InstallSpec | undefined {
  const remotes = list(doc.remotes).filter(isObject).map(remoteSpec).filter((spec) => spec !== undefined);
  const http = remotes.find((spec) => spec.kind === 'remote' && spec.transport === 'http');
  if (http) return http;
  if (remotes[0]) return remotes[0];

  const serverUrl = remoteUrl(doc.serverUrl);
  if (serverUrl) return { kind: 'remote', transport: 'http', url: serverUrl, headers: [] };

  for (const pkg of list(doc.packages).filter(isObject)) {
    const spec = packageSpec(pkg);
    if (spec) return spec;
  }
  return undefined;
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** `com.acme/billing-mcp` → "Billing"; generic names like `com.stripe/mcp` fall back to the brand, "Stripe". */
function titleFromName(name: string): string {
  const words = (name.split('/').pop() ?? '').split(/[-_\s]+/).filter((w) => w && !/^(mcp|server|remote)$/i.test(w));
  if (words.length) return words.map(capitalize).join(' ');
  const brand = namespaceDomain(name)?.split('.')[0];
  return brand ? capitalize(brand) : name;
}

/** Normalize a registry `server.json` (or a server card, which is a subset of it). */
export function fromServerJson(doc: unknown, source: Source, fallbackId: string): McpServer | undefined {
  if (!isObject(doc)) return undefined;
  const install = installSpec(doc);
  if (!install) return undefined;
  const id = str(doc.name) ?? fallbackId;
  return {
    id,
    title: str(doc.title) ?? titleFromName(id),
    description: str(doc.description)?.slice(0, 200),
    docsUrl: remoteUrl(doc.websiteUrl) ?? remoteUrl(isObject(doc.repository) ? doc.repository.url : undefined),
    source,
    install,
  };
}

/** Key used to drop the same server found through two sources. */
export function installKey(spec: InstallSpec): string {
  return spec.kind === 'remote' ? spec.url.replace(/\/+$/, '').toLowerCase() : [spec.command, ...spec.args].join(' ');
}

/** Merge and dedupe servers, then give each a unique short name for commands. */
export function nameServers(servers: McpServer[], domain: string): NamedServer[] {
  const seen = new Set<string>();
  const used = new Set<string>();
  const fallback = slugify(domain.split('.')[0] ?? '') || 'mcp';
  const named: NamedServer[] = [];
  for (const server of servers) {
    const key = installKey(server.install);
    if (seen.has(key)) continue;
    seen.add(key);
    const base = slugify(server.title) || fallback;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    named.push({ ...server, slug });
  }
  return named;
}
