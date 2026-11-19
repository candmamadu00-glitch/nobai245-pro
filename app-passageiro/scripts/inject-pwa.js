const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');
const assetsDir = path.resolve(__dirname, '..', 'assets');
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html nao encontrado.');
  process.exit(1);
}

for (const iconName of ['icon.png', 'favicon.png']) {
  const src = path.join(assetsDir, iconName);
  const dst = path.join(distDir, iconName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

const manifest = {
  name: 'Nô Bai 245',
  short_name: 'Nô Bai 245',
  description: 'Mobilidade urbana e entregas na Guiné-Bissau.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0E243C',
  theme_color: '#0E243C',
  icons: [
    { src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
};
fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const swContent = `const CACHE_NAME = 'nobai245-pwa-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET' || url.includes('/api/') || url.includes('/socket.io/')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
`;
fs.writeFileSync(path.join(distDir, 'sw.js'), swContent);

let html = fs.readFileSync(indexPath, 'utf8');

html = html.replace(
  /<meta name="viewport"[^>]*>/i,
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'
);

const pwaTags = `
  <link rel="manifest" href="/manifest.json" />
  <link rel="apple-touch-icon" href="/icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Nô Bai 245" />
  <meta name="theme-color" content="#0E243C" />
  <style>
    html, body, #root { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; background-color: #0E243C; overscroll-behavior: none; }
    input, textarea, select { font-size: 16px !important; }
  </style>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').catch(function() {});
      });
    }
  </script>
</head>`;

html = html.replace('</head>', pwaTags);
fs.writeFileSync(indexPath, html, 'utf8');
console.log('PWA manifest, apple-touch-icon e service worker injetados com sucesso!');
