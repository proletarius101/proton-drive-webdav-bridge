import { join } from 'path';
import { file, spawn } from 'bun';

const port = parseInt(
  process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || '5173',
);

// Start Bun bundler in watch mode
spawn({
  cmd: [
    'bun',
    'build',
    'src/gui/index.html',
    '--outdir',
    'dist/gui',
    '--target',
    'browser',
    '--watch',
    '--hot',
  ],
  cwd: join(import.meta.dir, '../..'),
  stdout: 'inherit',
  stderr: 'inherit',
});

console.log('Starting Bun bundler in watch mode...');

Bun.serve({
  port,
  development: true,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve built files from dist/gui
    const filePath = join(import.meta.dir, '../../dist/gui', url.pathname);
    const staticFile = file(filePath);

    if (await staticFile.exists()) {
      const contentType = filePath.endsWith('.js')
        ? 'application/javascript'
        : filePath.endsWith('.css')
          ? 'text/css'
          : filePath.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream';
      return new Response(staticFile, {
        headers: { 'Content-Type': contentType },
      });
    }

    // Fallback to index.html for SPA
    const indexPath = join(import.meta.dir, '../../dist/gui/index.html');
    const indexFile = file(indexPath);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Bun dev server running at http://localhost:${port}`);
