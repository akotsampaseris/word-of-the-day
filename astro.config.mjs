// @ts-check
import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';

// Load .env so SITE_URL and SITE_TIMEZONE are available while building.
// Real environment variables (e.g. set by your host) take precedence.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  output: 'static',
  // Absolute URLs (canonical links, OG images, RSS, sitemap) are built from this.
  site: process.env.SITE_URL || 'http://localhost:4321',
});
