# Chrome Web Store submission

Everything to paste into the [developer dashboard](https://chrome.google.com/webstore/devconsole). Upload `mcp-here.zip` (run `npm run zip`).

## Package

- **Upload:** `mcp-here.zip` (version 1.0.0)

## Store listing tab

**Name:** MCP Here

**Summary** (from the manifest, 113 of 132 characters):

> See when the site you're on has an MCP server, then add it to Claude Code, Cursor, VS Code and more in one click.

**Description:**

> Stumble onto MCP servers while you browse.
>
> When the site you're on has an MCP server, a small bar appears in the corner. One click adds it to your agent. No searching docs for the right command.
>
> Works with Claude Code, Claude, Cursor, VS Code, Codex, Gemini CLI, Windsurf, Goose, LM Studio and OpenCode. Cursor, VS Code, Goose and LM Studio install in one click. For the rest, the exact command is copied, ready to paste.
>
> Every server says who made it:
> • Official: published by the site itself
> • Official, needs setup: links to the provider's setup guide (for example Gmail)
> • Unofficial: third-party servers, clearly marked
>
> Where servers come from:
> • The site's own /.well-known discovery files
> • The official MCP registry
> • A hand-checked list for sites like Google Workspace
>
> Private by default. Nothing leaves your browser, there's no account, and the code is open source: github.com/MoizAhmedd/mcp-here

**Category:** Developer Tools
**Language:** English

**Graphics:**
- Icon: included in the package (128×128)
- Screenshots, 1280×800, in this order:
  1. `screenshot-railway-bar.png`
  2. `screenshot-railway-menu.png`
  3. `screenshot-posthog-menu.png`
  4. `screenshot-youtube-menu.png`
- Small promo tile, 440×280: `promo-tile-440x280.png`

**Official URL / homepage:** https://moizahmedd.github.io/mcp-here/
**Support URL:** https://github.com/MoizAhmedd/mcp-here/issues

## Privacy practices tab

**Single purpose:**

> Shows when the website you're on has an MCP (Model Context Protocol) server and helps you add it to your AI coding agent.

**Permission justifications:**

- **storage:** Saves the public list of MCP servers, the result of checking each site (under a hashed key), whether the user has hidden the corner button on a site, and the user's preferred app.
- **unlimitedStorage:** The public server list is about 4 MB and grows as more servers are published, which can exceed the default storage quota.
- **alarms:** Refreshes the public server list once a week and clears out old per-site results.
- **clipboardWrite:** Copies the install command for the chosen app when the user clicks the button.
- **Host permission (https://\*/\*):** Needed to read the current page's address to match it against the server list, to request that site's public /.well-known MCP discovery files (at most once a week per site, without cookies), and to show the corner button on pages that have a server. Any site can publish an MCP server, so the extension can't list the sites ahead of time.
- **Content script on https pages:** Draws the corner button on pages that have an MCP server. It doesn't read page content.

**Remote code:** No, I am not using remote code. The extension downloads a JSON data file (the server list), not code.

**Data usage:** Leave every data type unchecked. The extension doesn't collect or send user data; the page address is used only inside the browser.

Check all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://moizahmedd.github.io/mcp-here/privacy.html

## After approval

Put the store URL in the landing page's buttons:

```sh
STORE_URL=https://chromewebstore.google.com/detail/<id> npm run site
```

Then commit and push `site/index.html`. The Pages workflow redeploys when `site/` changes on main.
