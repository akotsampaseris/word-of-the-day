/**
 * Mock image provider: draws a 1024×1024 SVG placeholder showing the word.
 * Deterministic (the seed picks the colours), no network.
 *
 * Note: social networks do not render SVG in link previews, so OG images only
 * really work once a real image provider is configured.
 */
import { pick } from '../seed';
import type { GeneratedImage, ImageProvider, ImageRequest } from './types';

const PALETTES = [
  { background: '#1f3a3d', ink: '#f2e8d5', accent: '#e07a5f' },
  { background: '#f2e8d5', ink: '#2b2d42', accent: '#3d8b8b' },
  { background: '#3b2f4a', ink: '#f4f1de', accent: '#f2cc8f' },
  { background: '#e9dcc9', ink: '#5a2e2e', accent: '#81b29a' },
  { background: '#253238', ink: '#e8e3d9', accent: '#d9a441' },
];

export function createMockImageProvider(): ImageProvider {
  return {
    name: 'mock',
    model: 'mock-svg-v1',
    supportsReferenceImages: false,
    async generate(request: ImageRequest): Promise<GeneratedImage> {
      const svg = renderMockSvg(request.word, request.seed, request.width, request.height);
      return { bytes: new TextEncoder().encode(svg), contentType: 'image/svg+xml', extension: 'svg' };
    },
  };
}

export function renderMockSvg(word: string, seed: number, width = 1024, height = 1024): string {
  const { background, ink, accent } = pick(PALETTES, seed);
  // Shrink the text for long words so it always fits on one line.
  const fontSize = Math.min(150, Math.floor((width * 1.6) / Math.max(word.length, 1)));
  const circleX = 200 + (seed % 600);
  const circleY = 180 + ((seed >>> 8) % 200);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${background}"/>
  <circle cx="${circleX}" cy="${circleY}" r="150" fill="${accent}" opacity="0.35"/>
  <line x1="160" y1="${height - 300}" x2="${width - 160}" y2="${height - 300}" stroke="${accent}" stroke-width="4"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="${ink}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-style="italic">${escapeXml(word)}</text>
  <text x="50%" y="${height - 240}" text-anchor="middle" fill="${ink}" opacity="0.7" font-family="Georgia, serif" font-size="32" letter-spacing="6">MOCK IMAGE</text>
</svg>
`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
