import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { applyExtensionEnv, ENV_PREFIX, REPO_ROOT } from './env.config.ts';
import manifest, { PANEL_PAGE } from './manifest.config.ts';

export default defineConfig(({ mode }) => {
  const env = applyExtensionEnv(mode);
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set, so the panel cannot reach Supabase. Put it in apps/extension/.env.local (see .env.example).');
  }
  return {
    envDir: REPO_ROOT,
    envPrefix: ENV_PREFIX,
    plugins: [react(), tailwindcss(), crx({ manifest })],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'chrome116',
      // Extension files load from disk, so the voice library's size does not cost a download.
      chunkSizeWarningLimit: 1200,
      // The panel page is listed only in web_accessible_resources, which the plugin copies as is,
      // so it is added here to be built.
      rolldownOptions: { input: { panel: PANEL_PAGE } },
    },
    server: { port: 5174, strictPort: true, hmr: { port: 5174 } },
  };
});
