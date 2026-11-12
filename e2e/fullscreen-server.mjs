import { createRequire } from 'node:module';
import { readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
const require = createRequire(import.meta.url);
const appRequire = createRequire(resolve('apps/web/package.json'));
const { build } = await import(createRequire(require.resolve('vitest')).resolve('vite'));
const outDir = '/tmp/synvello-fullscreen-harness';
await build({ root: 'e2e/fullscreen-harness', oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: [
    { find: /^react$/, replacement: appRequire.resolve('react') },
    { find: /^react\/jsx-runtime$/, replacement: appRequire.resolve('react/jsx-runtime') },
    { find: /^react-dom\/client$/, replacement: appRequire.resolve('react-dom/client') },
  ] }, build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
const cssDir = 'apps/web/.next/static/chunks';
const styles = await Promise.all((await readdir(cssDir)).filter(name => name.endsWith('.css')).map(name => readFile(join(cssDir, name), 'utf8')));
await writeFile(join(outDir, 'app.css'), styles.join('\n'));
await copyFile('apps/web/test/fixtures/playable.mp4', join(outDir, 'movie.mp4'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4' };
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  try {
    if (path.includes('..')) throw new Error('Invalid path');
    const bytes = await readFile(join(outDir, path === '/' ? 'index.html' : path));
    response.setHeader('Content-Type', types[extname(path)] ?? 'text/html');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; object-src 'none'");
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
}).listen(3198, '127.0.0.1');
