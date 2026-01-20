import index from './index.html';

Bun.serve({
  port: 5173,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    '/': index,
  },
});

console.log('Bun dev server running at http://localhost:5173');
