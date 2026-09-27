export type Transport = 'http' | 'sse';

/** How a harness should launch or connect to a server. One per server. */
export type InstallSpec =
  | { kind: 'remote'; transport: Transport; url: string; headers: string[] }
  | { kind: 'stdio'; command: string; args: string[]; env: string[] };

/** Where we learned about a server: the site's own files, the MCP registry, or our hand-maintained list. */
export type Source = 'site' | 'registry' | 'curated';

export interface McpServer {
  /** Registry name (`com.railway/mcp`) or the card URL for site-published servers. */
  id: string;
  title: string;
  description?: string;
  docsUrl?: string;
  source: Source;
  install: InstallSpec;
  /** A third-party server for this site, not made by the site's owner. */
  unofficial?: true;
  /** The server needs account setup first (e.g. a Google Cloud project); link to the guide. */
  setupUrl?: string;
  /** What that setup involves, in one line. */
  setupNote?: string;
  /** Who publishes it, when the id doesn't say (hand-listed servers). */
  publisher?: string;
}

/** A server plus the short name used in install commands (`railway`). */
export interface NamedServer extends McpServer {
  slug: string;
}
