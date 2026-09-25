import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupDomains, namespaceDomain, siteDomain, slugify } from '../src/lib/domain.ts';

test('siteDomain reduces hostnames to the registrable domain', () => {
  assert.equal(siteDomain('railway.com'), 'railway.com');
  assert.equal(siteDomain('dashboard.stripe.com'), 'stripe.com');
  assert.equal(siteDomain('myorg.sentry.io'), 'sentry.io');
  assert.equal(siteDomain('shop.example.co.uk'), 'example.co.uk');
  // Hosting platforms are on the private suffix list, so each app is its own site.
  assert.equal(siteDomain('my-app.vercel.app'), 'my-app.vercel.app');
});

test('siteDomain ignores hosts that are not public websites', () => {
  assert.equal(siteDomain('localhost'), null);
  assert.equal(siteDomain('127.0.0.1'), null);
  assert.equal(siteDomain('printer.internal'), null);
});

test('namespaceDomain maps verified registry namespaces to sites', () => {
  assert.equal(namespaceDomain('com.stripe/mcp'), 'stripe.com');
  assert.equal(namespaceDomain('app.linear/linear'), 'linear.app');
  assert.equal(namespaceDomain('com.figma.mcp/mcp'), 'figma.com');
  assert.equal(namespaceDomain('app.vercel.checkout/server'), 'checkout.vercel.app');
  assert.equal(namespaceDomain('io.github.someone/tool'), null);
});

test('lookupDomains adds known aliases', () => {
  assert.deepEqual(lookupDomains('notion.so'), ['notion.so', 'notion.com']);
  assert.deepEqual(lookupDomains('railway.com'), ['railway.com']);
});

test('slugify makes short command-friendly names', () => {
  assert.equal(slugify('Railway'), 'railway');
  assert.equal(slugify('Supabase MCP server'), 'supabase');
  assert.equal(slugify('Microsoft Learn MCP'), 'microsoft-learn');
  assert.equal(slugify('!!!'), '');
});
