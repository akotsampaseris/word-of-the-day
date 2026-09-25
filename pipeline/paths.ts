/**
 * Absolute paths, resolved from this file's location so the CLI works no
 * matter which directory it is run from.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONTENT_DIR = path.join(REPO_ROOT, 'content');
export const WORDS_FILE = 'words.json';
export const MOCK_IMAGES_DIR = path.join(REPO_ROOT, 'public', 'mock-images');
export const ENV_FILE = path.join(REPO_ROOT, '.env');
