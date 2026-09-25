export type Transport = 'http' | 'sse';

/** How a harness should launch or connect to a server. One per server. */
export type InstallSpec =
  | { kind: 'remote'; transport: Transport; url: string; headers: string[] }
  | { kind: 'stdio'; command: string; args: string[]; env: string[] };

export type Source = 'site' | 'registry';

export interface McpServer {
  /** Registry name (`com.railway/mcp`) or the card URL for site-published servers. */
  id: string;
  title: string;
  description?: string;
  docsUrl?: string;
  source: Source;
  install: InstallSpec;
}

/** A server plus the short name used in install commands (`railway`). */
export interface NamedServer extends McpServer {
  slug: string;
}
