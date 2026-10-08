// Writes site/index.html from scripts/landing.template.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { FEATURED, HARNESSES } from '../src/lib/harnesses.ts';
import { APP_ICONS } from '../src/ui/icons.ts';

const STORE_URL = process.env.STORE_URL ?? 'https://chromewebstore.google.com/detail/mcp-here/jmndkfieljmfdnajhabaejnncnghnnhd';
const template = readFileSync(new URL('./landing.template.html', import.meta.url), 'utf8');

// The ten named apps, featured first; skip the generic JSON and URL options.
const apps = [...FEATURED, ...HARNESSES.map((h) => h.id).filter((id) => !FEATURED.includes(id))]
  .map((id) => HARNESSES.find((h) => h.id === id)!)
  .filter((h) => h.id !== 'json' && h.id !== 'url')
  .map((h) => `<div class="app">${APP_ICONS[h.id]}<span>${h.label}</span></div>`)
  .join('\n          ');

const html = template.replaceAll('{{STORE_URL}}', STORE_URL).replace('{{APPS}}', apps);
writeFileSync(new URL('../site/index.html', import.meta.url), html);
console.log(`site/index.html written (store link: ${STORE_URL})`);
