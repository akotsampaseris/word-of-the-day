/** "2026-09-25" → "Friday 25 September 2026" */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "2026-09-25" → "25 Sep 2026" */
export function formatShortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function permalinkPath(slug: string): string {
  return `/word/${slug}/`;
}

/**
 * Image URLs are absolute (object storage) or site-relative (mock images).
 * Social cards and feeds need absolute URLs, so resolve against the site.
 */
export function absoluteUrl(urlOrPath: string, site: URL): string {
  return new URL(urlOrPath, site).href;
}

/** "https://en.wiktionary.org/wiki/gongoozler#English" → "en.wiktionary.org/wiki/gongoozler" */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(`${parsed.hostname}${parsed.pathname}`).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Splits text into paragraphs on blank lines. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
