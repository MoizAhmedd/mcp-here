// Screenshots scene.html at a few times, to check beats before rendering the whole video.
//   node stills.mjs 1.5 4 6.2      → stills/t-1.5.png, stills/t-4.png, stills/t-6.2.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'stills');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'scene.html')).href + '?capture' + (process.env.CUT ? '&' + process.env.CUT : ''));
await page.evaluate(() => document.fonts.ready);
for (const t of process.argv.slice(2)) {
  await page.evaluate((t) => window.render(t), Number(t));
  const path = join(out, `t-${t}.png`);
  await page.screenshot({ path });
  console.log(path);
}
await browser.close();
