/**
 * /sitemap.xml, written by hand: the site has exactly three kinds of page,
 * and this keeps the filename exactly sitemap.xml.
 */
import type { APIContext } from 'astro';
import { getPublishedEntries } from '../lib/entries';
import { escapeHtml, permalinkPath } from '../lib/format';

export function GET(context: APIContext) {
  const site = context.site ?? new URL('http://localhost:4321');
  const entries = getPublishedEntries();
  const latest = entries[0]?.date;

  const urls = [
    { path: '/', lastmod: latest },
    { path: '/archive/', lastmod: latest },
    ...entries.map((entry) => ({ path: permalinkPath(entry.slug), lastmod: entry.date })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ path, lastmod }) => {
      const loc = `<loc>${escapeHtml(new URL(path, site).href)}</loc>`;
      return `  <url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
    }),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
