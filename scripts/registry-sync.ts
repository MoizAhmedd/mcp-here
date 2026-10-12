// Keeps a copy of the MCP registry between index builds. A full read of the registry
// (40k+ servers, 100 per page) stopped finishing in October 2026, when pages started
// taking 15 s to 3 min each. So each build fetches only what changed since the last
// one, and a pass that runs out of time resumes where it stopped on the next build.
import type { RegistryEntry } from '../src/lib/registry.ts';

export interface RegistrySnapshot {
  /** Every registry change up to this time is in `entries`. Absent until a first full pass completes. */
  syncedAt?: string;
  /** A pass that didn't finish: what it was fetching and how far it got. */
  pending?: { since?: string; startedAt: string; cursor?: string };
  entries: RegistryEntry[];
}

export interface RegistryPage {
  servers: RegistryEntry[];
  metadata?: { nextCursor?: string };
}

export interface SyncResult {
  snapshot: RegistrySnapshot;
  fetched: number;
  /** Why the pass stopped early, if it did. */
  error?: unknown;
}

const STATUS = 'io.modelcontextprotocol.registry/official';

/** Only the fields buildIndex and fromServerJson read, so the snapshot stays small. */
function trim(entry: RegistryEntry): RegistryEntry {
  const { name, title, description, websiteUrl, repository, remotes, packages } = entry.server ?? {};
  const status = entry._meta?.[STATUS]?.status;
  return {
    server: { name, title, description, websiteUrl, repository, remotes, packages },
    ...(status ? { _meta: { [STATUS]: { status } } } : {}),
  };
}

export async function syncRegistry(
  snapshot: RegistrySnapshot,
  fetchPage: (params: URLSearchParams) => Promise<RegistryPage>,
  options: { now?: Date; deadline?: number } = {},
): Promise<SyncResult> {
  const pass = snapshot.pending ?? { since: snapshot.syncedAt, startedAt: (options.now ?? new Date()).toISOString() };
  const byName = new Map(snapshot.entries.map((entry) => [entry.server?.name, entry]));
  let cursor = pass.cursor;
  let fetched = 0;
  try {
    do {
      if (options.deadline && Date.now() > options.deadline) throw new Error('ran out of time');
      const params = new URLSearchParams({ limit: '100', version: 'latest' });
      if (pass.since) params.set('updated_since', pass.since);
      if (cursor) params.set('cursor', cursor);
      const page = await fetchPage(params);
      for (const entry of page.servers) {
        if (typeof entry.server?.name === 'string') byName.set(entry.server.name, trim(entry));
      }
      fetched += page.servers.length;
      cursor = page.metadata?.nextCursor;
    } while (cursor);
  } catch (error) {
    const entries = [...byName.values()];
    return { snapshot: { syncedAt: snapshot.syncedAt, pending: { ...pass, cursor }, entries }, fetched, error };
  }
  // Changes made while this pass ran are picked up by the next one, which starts from startedAt.
  return { snapshot: { syncedAt: pass.startedAt, entries: [...byName.values()] }, fetched };
}
