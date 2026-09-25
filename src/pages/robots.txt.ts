import type { APIContext } from 'astro';

export function GET(context: APIContext) {
  const site = context.site ?? new URL('http://localhost:4321');
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
