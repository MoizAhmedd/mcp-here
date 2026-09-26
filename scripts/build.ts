// Bundles the extension into dist/. Pass --watch to rebuild on change.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const dist = `${root}dist`;
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(`${root}static`, dist, { recursive: true });
cpSync(`${root}manifest.json`, `${dist}/manifest.json`);
cpSync(`${root}data/index.json`, `${dist}/index.json`);

const context = await esbuild.context({
  entryPoints: [`${root}src/background.ts`, `${root}src/popup.ts`, `${root}src/content.ts`],
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: !watch,
  logLevel: 'info',
});

if (watch) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
