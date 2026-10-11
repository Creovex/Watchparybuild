import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// The extension reads the same NEXT_PUBLIC_ variables as the web app, from `.env` files at the
// repository root and in apps/extension. Values in apps/extension win over the root's, and variables
// already set in the shell win over both. Only the NEXT_PUBLIC_ prefix is ever read.

export const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(EXTENSION_DIR, '../..');
export const ENV_PREFIX = 'NEXT_PUBLIC_';

export function extensionEnv(mode: string): Record<string, string> {
  return { ...loadEnv(mode, REPO_ROOT, ENV_PREFIX), ...loadEnv(mode, EXTENSION_DIR, ENV_PREFIX) };
}

/** Puts the merged values in process.env so Vite's own loading (from the root) sees them too. */
export function applyExtensionEnv(mode: string): Record<string, string> {
  const env = extensionEnv(mode);
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return env;
}
