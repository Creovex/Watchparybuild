import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve('vitest')).resolve('vite'));
const outDir = '/tmp/synvello-mkv-harness';
await build({ root: 'e2e/mkv-harness', build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const bytes = await readFile(join(outDir, path === '/' ? 'index.html' : path));
    const extension = path.slice(path.lastIndexOf('.'));
    res.setHeader('Content-Type', mime[extension] ?? 'text/html');
    // Exercise the production restriction on JavaScript evaluation, allowing only WASM compilation.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'");
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
}).listen(3197, '127.0.0.1');
