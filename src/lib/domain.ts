import { parse } from 'tldts';

// Sites whose product domain differs from the domain they publish under.
const ALIASES: Record<string, string> = {
  'notion.so': 'notion.com',
};

/** Registrable domain for a hostname (`dashboard.stripe.com` → `stripe.com`), or null for IPs, localhost, etc. */
export function siteDomain(hostname: string): string | null {
  const parsed = parse(hostname, { allowPrivateDomains: true });
  const knownSuffix = parsed.isIcann || parsed.isPrivate;
  if (parsed.isIp || !parsed.domain || !knownSuffix) return null;
  return parsed.domain;
}

/** Domains to look up in the registry index for a site. */
export function lookupDomains(domain: string): string[] {
  const alias = ALIASES[domain];
  return alias ? [domain, alias] : [domain];
}

/**
 * Domain that owns a registry name. Registry namespaces are reverse-DNS and
 * verified against the domain (`com.stripe/mcp` → `stripe.com`). `io.github.*`
 * names are verified against a GitHub account instead, so they have no site.
 */
export function namespaceDomain(registryName: string): string | null {
  const namespace = registryName.split('/')[0];
  if (!namespace || namespace.startsWith('io.github.')) return null;
  return siteDomain(namespace.split('.').reverse().join('.'));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-(mcp|mcp-server|server)$/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}
