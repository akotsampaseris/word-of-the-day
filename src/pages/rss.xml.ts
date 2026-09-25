import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import type { Entry } from '../../pipeline/schema';
import { getPublishedEntries } from '../lib/entries';
import { absoluteUrl, escapeHtml, paragraphs, permalinkPath } from '../lib/format';
import { SITE_DESCRIPTION, SITE_NAME } from '../lib/site';

const FEED_LENGTH = 30;

export function GET(context: APIContext) {
  const site = context.site ?? new URL('http://localhost:4321');
  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site,
    items: getPublishedEntries()
      .slice(0, FEED_LENGTH)
      .map((entry) => ({
        title: entry.word,
        link: permalinkPath(entry.slug),
        pubDate: new Date(`${entry.date}T00:00:00Z`),
        description: entry.definition,
        content: feedContent(entry, site),
      })),
    customData: '<language>en</language>',
  });
}

/** The full entry as HTML for feed readers. Every text field is escaped. */
function feedContent(entry: Entry, site: URL): string {
  const image = `<p><img src="${escapeHtml(absoluteUrl(entry.image.url, site))}" alt="${escapeHtml(entry.image.alt)}" width="1024" height="1024"></p>`;
  const meta = `<p><em>${escapeHtml(entry.pronunciation)}</em>, ${escapeHtml(entry.partOfSpeech)}</p>`;
  const definition = `<p><strong>${escapeHtml(entry.definition)}</strong></p>`;
  const etymology = `<h3>Etymology</h3><p>${escapeHtml(entry.etymology)}</p>`;
  const story = `<h3>A very short story</h3>${paragraphs(entry.story)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('')}`;
  return image + meta + definition + etymology + story;
}
